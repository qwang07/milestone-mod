import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

let settle: () => Promise<void> = async () => {}

const ROOT = '/proj'
const DIR = `${ROOT}/.goals`

/** A project folder in memory, plus records of what the plugin asked the session to do. */
const world = (on: On, seed: Record<string, string> = {}, placed = true) => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  let tick = 1
  for (const [name, text] of Object.entries(seed)) files.set(`${DIR}/${name}`, { text, mtimeMs: tick++ })
  const prompts: string[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const touched: string[] = []
  const surfaces: ('terminal' | 'desktop' | 'mobile')[] = []
  const hasDir = () => [...files.keys()].some(k => k.startsWith(`${DIR}/`))

  const deny = { deny: 'ENOENT: no such file' }
  on('session.root', () => ({ value: ROOT }))
  on('fs.stat', ($, e) => {
    touched.push(e.path)
    const p = e.path.replace(/\/+$/, '')
    if (p === ROOT) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: ROOT } }
    if (p === DIR) {
      if (!hasDir()) return deny
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: DIR } }
    }
    const f = files.get(p)
    if (!f) return deny
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false, realPath: p } }
  })
  on('fs.list', ($, e) => {
    touched.push(e.path)
    return {
      value: [...files.entries()]
        .filter(([k]) => k.slice(0, k.lastIndexOf('/')) === e.path)
        .map(([k, f]) => ({ name: k.slice(k.lastIndexOf('/') + 1), kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })),
    }
  })
  on('fs.read', ($, e) => {
    touched.push(e.path)
    const f = files.get(e.path)
    return f ? { value: f.text } : deny
  })
  on('fs.write', ($, e) => {
    touched.push(e.path)
    files.set(e.path, { text: e.text, mtimeMs: tick++ })
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'narrow terminal' } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__milestone__${e.name}` } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: [...surfaces] }))
  on('session.attach', ($, e) => {
    surfaces.push(e.surface as 'desktop' | 'mobile')
    return { clientId: e.clientId }
  })
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 11, 12) })
  settle = () => clock.settle()

  const text = (id: number) => files.get(`${DIR}/${id}.md`)?.text ?? ''
  return { files, prompts, toasts, opened, touched, surfaces, clock, text }
}

/** Starts the session: under the REPL by default, or as a -p / SDK run that draws nowhere yet. */
const start = async ($: any, interactive = true) => {
  await $.session.start({ cwd: ROOT, surface: interactive ? 'terminal' : null, isInteractive: interactive })
  await settle()
}

const attach = async ($: any, surface: 'desktop' | 'mobile') => {
  await $.session.attach({ surface, clientId: `${surface}:default` })
  await settle()
}

const run = async ($: any, command: string, args = '') => {
  const out = (await $.command.run({ command, args })).text ?? ''
  await settle()
  return out
}

const call = async ($: any, name: string, input: Record<string, unknown>) => $.tool.call({ tool: `mcp__milestone__${name}`, ...input })

const turnDone = async ($: any, reason: 'answer' | 'aborted' | 'error' = 'answer') => {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason })
  await settle()
}

/** A project with one active goal #1 with three tasks. */
const planned = async ($: any) => {
  await run($, 'ms-new', 'CSV 导出')
  await call($, 'plan_goal', {
    id: 1,
    acceptance: '能导出',
    approach: '流式',
    split: 'tasks',
    tasks: [
      { title: '字段', acceptance: '字段确认' },
      { title: '写出', acceptance: '内存稳定' },
      { title: '编码', acceptance: '不乱码' },
    ],
  })
  await run($, 'ms-focus', '1')
}

const doTask = async ($: any, n: number) => {
  await call($, 'start_task', { id: 1, task: n })
  await call($, 'finish_task', { id: 1, task: n })
}

describe('commands and tools', () => {
  test('/ms-new writes .goals/1.md as an idea', async ($, on) => {
    const w = world(on)
    await start($)
    expect(await run($, 'ms-new', '性能问题')).toBe('Recorded #1 性能问题')
    expect(w.text(1)).toContain('status: idea')
    expect(await run($, 'ms-new', '子问题 --under #1')).toBe('Recorded #2 子问题')
    expect(w.text(2)).toContain('parent: 1')
    expect(w.text(1)).toContain('split: goals')
  })

  test('commands name a goal by part of its title', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', 'CSV export')
    await run($, 'ms-new', 'CSV import')
    expect(await run($, 'ms-new', 'header row --under csv export')).toBe('Recorded #3 header row')
    expect(w.text(3)).toContain('parent: 1')
    expect(await run($, 'ms-drop', 'csv')).toMatch(/^"csv" matches several goals[^]*CSV export \(#1\)\n  CSV import \(#2\)$/)
    expect(await run($, 'ms-drop', 'import')).toBe('#2 dropped')
    expect(await run($, 'ms-done', 'header')).toBe('#3 header row done\nAll sub-goals of CSV export have ended; /ms-done CSV export completes it')
    expect(await run($, 'ms-focus', 'nothing')).toBe('No goal matches "nothing"')
    expect(await run($, 'ms-new', 'x --under nothing')).toBe('No goal matches "nothing"')
  })

  test('move_goal reorders siblings in the files, and /ms-status follows', async ($, on) => {
    const w = world(on)
    await start($)
    for (const t of ['甲', '乙', '丙']) await run($, 'ms-new', t)
    expect((await call($, 'move_goal', { id: 3, before: 1 })).result).toBe('Moved #3 丙 before #1')
    expect([1, 2, 3].map(n => /order: (\d+)/.exec(w.text(n))?.[1])).toEqual(['2', '3', '1'])
    expect(await run($, 'ms-status')).toMatch(/^丙 · idea\n甲 · idea\n乙 · idea/)
    await run($, 'ms-new', '丁')
    expect(w.text(4)).toContain('order: 4')
    expect((await call($, 'move_goal', { id: 1, before: 9 })).deny).toBe('no goal #9')
    expect((await call($, 'move_goal', { id: 1, before: 'x' })).deny).toBe('before is not a valid goal number')
  })

  test('/ms-plan marks planning and asks Claude for a proposal', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '导出')
    await run($, 'ms-plan', '#1')
    expect(w.text(1)).toContain('status: planning')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] plan #1\n/)
  })

  test('a full pass: plan, focus, run each task; the last one completes the goal', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    expect(w.text(1)).toContain('status: active')
    expect(await run($, 'ms-next')).toBe('Starting #1 T1 字段')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] run #1 T1\n/)
    for (const n of [1, 2]) await doTask($, n)
    expect(w.text(1)).toContain('status: active')
    await call($, 'start_task', { id: 1, task: 3 })
    expect((await call($, 'finish_task', { id: 1, task: 3 })).result).toBe('#1 T3 done; all tasks ended, #1 CSV 导出 done')
    expect(w.text(1)).toContain('- [x] T3 | 编码 | acceptance: 不乱码')
    expect(w.text(1)).toContain('status: done')
    expect(await run($, 'ms-done', '1')).toBe('#1 is already done')
  })

  test('the last task ending completes a child and points to its parent', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '父')
    await call($, 'plan_goal', { id: 1, acceptance: '都做完', approach: '拆开', split: 'goals', goals: [{ title: '子' }] })
    await call($, 'plan_goal', { id: 2, acceptance: '能用', approach: '一步', split: 'tasks', tasks: [{ title: '做', acceptance: '做完' }] })
    await call($, 'focus_goal', { id: 2 })
    await call($, 'start_task', { id: 2, task: 1 })
    expect((await call($, 'finish_task', { id: 2, task: 1 })).result).toMatch(/#2 子 done\nAll sub-goals of 父 have ended; \/ms-done 父 completes it$/)
    expect(w.text(2)).toContain('status: done')
  })

  test('tools refuse what the rules forbid, with the reason', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    await call($, 'start_task', { id: 1, task: 1 })
    const second = await call($, 'start_task', { id: 1, task: 2 })
    expect(second.deny).toMatch(/T1 is still in progress/)
    const early = await run($, 'ms-done')
    expect(early).toMatch(/has tasks not ended/)
  })

  test('/ms-skip marks the current task skipped', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    expect(await run($, 'ms-skip')).toBe('#1 T1 skipped; 2 left')
    expect(w.text(1)).toContain('- [-] T1')
    await run($, 'ms-skip')
    expect(await run($, 'ms-skip')).toBe('#1 T3 skipped; all tasks ended, #1 CSV 导出 done')
    expect(w.text(1)).toContain('status: done')
  })

  test('/ms-add asks Claude to propose and changes nothing yet', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    const before = w.text(1)
    await run($, 'ms-add', '补测试')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] add task #1: 补测试/)
    expect(w.text(1)).toBe(before)
    await call($, 'add_task', { id: 1, title: '补测试', acceptance: '测试通过' })
    expect(w.text(1)).toContain('- [ ] T4 | 补测试 | acceptance: 测试通过')
  })

  test('/ms-status lists the tree', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    expect(await run($, 'ms-status')).toBe('CSV 导出 · 1/3\n\nActive: CSV 导出\n  [ ] T1 字段\n  [ ] T2 写出\n  [ ] T3 编码')
  })

  test('focus_goal makes a planned goal active, sends the old one back and stops auto', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-new', '导入')
    await call($, 'plan_goal', { id: 2, acceptance: '能导入', approach: '逐行', split: 'tasks', tasks: [{ title: '解析', acceptance: '能读' }] })
    await run($, 'ms-auto', 'all')
    const opened = w.opened.length
    const out = await call($, 'focus_goal', { id: 2 })
    await settle()
    expect(out.result).toBe('#2 导入 is now active')
    expect(w.text(2)).toContain('status: active')
    expect(w.text(1)).toContain('status: planned')
    expect(w.toasts.at(-1)).toMatch(/active goal changed/)
    expect(w.opened.length).toBe(opened + 1)
    await turnDone($)
    expect(w.prompts.filter(p => p.startsWith('[milestone] run'))).toHaveLength(1)
  })

  test('focus_goal refuses what /ms-focus refuses', async ($, on) => {
    const w = world(on, { '9.md': 'not a goal' })
    await start($)
    await run($, 'ms-new', '想法')
    await run($, 'ms-new', '大目标')
    await call($, 'plan_goal', { id: 2, acceptance: 'a', approach: 'b', split: 'goals', goals: [{ title: '小目标' }] })
    expect((await call($, 'focus_goal', { id: 1 })).deny).toMatch(/planned/)
    expect((await call($, 'focus_goal', { id: 2 })).deny).toMatch(/sub-goals/)
    expect((await call($, 'focus_goal', { id: 9 })).deny).toMatch(/cannot be read/)
    expect((await call($, 'focus_goal', { id: 7 })).deny).toBe('no goal #7')
    expect((await call($, 'focus_goal', { id: 0 })).deny).toBe('id is not a valid goal number')
    expect(w.text(1)).toContain('status: idea')
  })
})

describe('auto', () => {
  test('auto runs the next task after each finished one and stops at the count', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto', '2')
    expect(w.prompts.at(-1)).toMatch(/run #1 T1/)
    await doTask($, 1)
    await turnDone($)
    expect(w.prompts.at(-1)).toMatch(/run #1 T2/)
    await doTask($, 2)
    await turnDone($)
    expect(w.prompts.filter(p => p.includes('run #1 T3'))).toHaveLength(0)
    expect(w.toasts.at(-1)).toMatch(/no runs left/)
  })

  test('auto stops when the task did not finish', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto')
    await call($, 'start_task', { id: 1, task: 1 })
    await turnDone($)
    const asked = w.prompts.filter(p => p.startsWith('[milestone] run'))
    expect(asked).toHaveLength(1)
    expect(w.toasts.at(-1)).toMatch(/T1 was not finished/)
  })

  test('auto stops when the turn was interrupted', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto')
    await doTask($, 1)
    await turnDone($, 'aborted')
    expect(w.prompts.filter(p => p.startsWith('[milestone] run'))).toHaveLength(1)
    expect(w.toasts.at(-1)).toMatch(/interrupted/)
  })

  test('auto stops after the last task, the goal done', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto', 'all')
    for (const n of [1, 2, 3]) {
      await doTask($, n)
      await turnDone($)
    }
    expect(w.prompts.filter(p => p.startsWith('[milestone] run'))).toHaveLength(3)
    expect(w.toasts.at(-1)).toMatch(/the goal is done/)
    expect(w.toasts.filter(t => /#\d/.test(t))).toEqual([])
    expect(w.text(1)).toContain('status: done')
  })

  test('step mode never continues on its own', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-next')
    await doTask($, 1)
    await turnDone($)
    expect(w.prompts.filter(p => p.startsWith('[milestone] run'))).toHaveLength(1)
  })
})

describe('sessions and safety', () => {
  test('a new session with an active goal opens the panel and submits nothing', async ($, on) => {
    const seed = {
      '1.md': [
        '---', 'id: 1', 'title: 导出', 'status: active', 'parent: ', 'split: tasks', 'created: 2026-10-11', '---',
        '## 描述', '## 验收标准', '## 方案', '## 已定决策', '## Tasks', '- [x] T1 | a | 验收: b', '- [ ] T2 | c | 验收: d', '',
      ].join('\n'),
    }
    const w = world(on, seed)
    await start($)
    expect(w.opened).toHaveLength(1)
    expect(w.prompts).toHaveLength(0)
  })

  const ACTIVE = { '1.md': ['---', 'id: 1', 'title: 导出', 'status: active', 'parent: ', 'split: tasks', 'created: d', '---', '## Tasks', '- [ ] T1 | a | 验收: b', ''].join('\n') }

  test('a -p run with an active goal stays quiet', async ($, on) => {
    const w = world(on, ACTIVE)
    await start($, false)
    expect(await run($, 'ms-status')).toContain('导出 · 1/1')
    expect(w.prompts).toHaveLength(0)
    expect(w.opened).toHaveLength(0)
  })

  test('a session with no surface at start opens the panel once, when the first one attaches', async ($, on) => {
    const w = world(on, ACTIVE)
    await start($, false)
    expect(w.opened).toHaveLength(0)
    await attach($, 'desktop')
    expect(w.opened).toHaveLength(1)
    await attach($, 'mobile')
    expect(w.opened).toHaveLength(1)
    expect(w.prompts).toHaveLength(0)
  })

  test('a session already drawing at start opens the panel once, and not again on a later attach', async ($, on) => {
    const w = world(on, ACTIVE)
    w.surfaces.push('desktop')
    await start($, false)
    expect(w.opened).toHaveLength(1)
    await attach($, 'mobile')
    expect(w.opened).toHaveLength(1)
    expect(w.prompts).toHaveLength(0)
  })

  test('a panel that could not be placed at start points to /ms-panel', async ($, on) => {
    const seed = {
      '1.md': ['---', 'id: 1', 'title: 导出', 'status: active', 'parent: ', 'split: tasks', 'created: d', '---', '## Tasks', '- [ ] T1 | a | 验收: b', ''].join('\n'),
    }
    const w = world(on, seed, false)
    await start($)
    expect(w.toasts.at(-1)).toMatch(/\/ms-panel/)
  })

  test('command replies carry no plugin prefix of their own', async ($, on) => {
    world(on)
    await start($)
    expect(await run($, 'ms-plan', '')).toBe('Name a goal, e.g. /ms-plan 12 or /ms-plan part of its title')
    expect(await run($, 'ms-focus', '9')).toBe('no goal #9')
  })

  test('the plugin only touches the project root and .goals/<digits>.md', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await doTask($, 1)
    await run($, 'ms-status')
    for (const p of w.touched) expect(p === ROOT || p === DIR || /^\/proj\/\.goals\/[1-9][0-9]*\.md$/.test(p)).toBe(true)
  })

  test('a broken file is reported and left alone', async ($, on) => {
    const w = world(on, { '3.md': 'not a goal' })
    await start($)
    expect(await run($, 'ms-status')).toContain('Cannot read 3.md')
    expect(await run($, 'ms-focus', '3')).toMatch(/cannot be read/)
    expect(w.text(3)).toBe('not a goal')
  })

  test('edits from another session show up after the poll', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '甲')
    w.files.set(`${DIR}/1.md`, { text: w.text(1).replace('title: 甲', 'title: 乙'), mtimeMs: 999 })
    await w.clock.advance(5000)
    expect(await run($, 'ms-status')).toContain('乙 · idea')
  })
})

const PANE_PROPS = { title: 'milestone', isFocused: false, bodyColumns: 40, placement: 'dock' }
const mountPane = ($: any, surface: string) =>
  $.ui.mount({ plugin: 'milestone', surface, component: 'Pane', requestId: 'milestone', props: PANE_PROPS } as any)

/** The goal rows the tree's Client drew, top to bottom. */
const treeTexts = async (ui: any): Promise<string[]> =>
  (await ui.findAll({ type: 'Text', in: 'tree' })).map((x: any) => x.text).filter((t: string) => /[·?○▶✓]/.test(t))

describe('panel', () => {
  test('the panel shows the tree and the active goal on terminal and desktop', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    await call($, 'start_task', { id: 1, task: 1 })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await treeTexts(ui)).toEqual(['  ▶ CSV 导出'])
      expect(await ui.find({ type: 'Text', text: /^1\/3$/, in: 'tree' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /T1 字段/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^─{400}$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /#\d/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /#\d/, in: 'tree' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a surface with no Client draws the tree as plain rows', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    const ui = await mountPane($, 'mobile')
    expect(await ui.find({ type: 'Text', text: /^▶ CSV 导出$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the pointer on a row shows its handle; dragging moves it among its siblings', async ($, on) => {
    const w = world(on)
    await start($)
    for (const t of ['甲', '乙', '丙']) await run($, 'ms-new', t)
    const ui = await mountPane($, 'terminal')
    await ui.pointer({ type: 'move', x: 5, y: 1 })
    expect(await treeTexts(ui)).toEqual(['  · 甲', '⠿ · 乙', '  · 丙'])
    await ui.pointer({ type: 'down', x: 5, y: 2, button: 'left' })
    await ui.pointer({ type: 'move', x: 5, y: 0, button: 'left' })
    expect(await treeTexts(ui)).toEqual(['⠿ · 丙', '  · 甲', '  · 乙'])
    expect(w.text(3)).not.toContain('order:')
    await ui.pointer({ type: 'up', x: 5, y: 0, button: 'left' })
    expect([1, 2, 3].map(n => /order: (\d+)/.exec(w.text(n))?.[1])).toEqual(['2', '3', '1'])
    expect(await treeTexts(ui)).toEqual(['⠿ · 丙', '  · 甲', '  · 乙'])
    expect(await run($, 'ms-status')).toBe('丙 · idea\n甲 · idea\n乙 · idea')
    await ui.unmount()
  })

  test('a drag never leaves its sibling group, and a drop where it started changes nothing', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '父')
    for (const t of ['子一', '子二']) await run($, 'ms-new', `${t} --under 父`)
    await run($, 'ms-new', '叔')
    const ui = await mountPane($, 'terminal')
    expect(await treeTexts(ui)).toEqual(['  · 父', '    · 子一', '    · 子二', '  · 叔'])
    await ui.pointer({ type: 'down', x: 5, y: 2, button: 'left' })
    await ui.pointer({ type: 'move', x: 5, y: 3, button: 'left' })
    await ui.pointer({ type: 'move', x: 5, y: 0, button: 'left' })
    expect(await treeTexts(ui)).toEqual(['  · 父', '    · 子一', '⠿   · 子二', '  · 叔'])
    await ui.pointer({ type: 'move', x: 5, y: 1, button: 'left' })
    expect(await treeTexts(ui)).toEqual(['  · 父', '⠿   · 子二', '    · 子一', '  · 叔'])
    await ui.pointer({ type: 'move', x: 5, y: 2, button: 'left' })
    await ui.pointer({ type: 'up', x: 5, y: 2, button: 'left' })
    expect([1, 2, 3, 4].map(n => w.text(n).includes('order:'))).toEqual([false, false, false, false])
    await ui.pointer({ type: 'down', x: 5, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: 5, y: 3, button: 'left' })
    expect(await treeTexts(ui)).toEqual(['  · 叔', '⠿ · 父', '    · 子一', '    · 子二'])
    await ui.pointer({ type: 'up', x: 5, y: 3, button: 'left' })
    expect(await run($, 'ms-status')).toBe('叔 · idea\n父 · idea\n  子一 · idea\n  子二 · idea')
    await ui.unmount()
  })

  test('a post that is not a move is ignored', async ($, on) => {
    const w = world(on)
    await start($)
    for (const t of ['甲', '乙']) await run($, 'ms-new', t)
    const ui = await mountPane($, 'terminal')
    await ui.post({ move: 'x', before: 1 }, { in: 'tree' })
    await ui.post({ move: 2, before: 'y' }, { in: 'tree' })
    expect(w.text(1)).not.toContain('order:')
    await ui.post({ move: 2, before: 1 }, { in: 'tree' })
    expect(w.text(2)).toContain('order: 1')
    await ui.unmount()
  })
})
