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
    expect(await run($, 'ms-new', '性能问题')).toBe('已记下 #1 性能问题')
    expect(w.text(1)).toContain('status: idea')
    expect(await run($, 'ms-new', '子问题 --under #1')).toBe('已记下 #2 子问题')
    expect(w.text(2)).toContain('parent: 1')
    expect(w.text(1)).toContain('split: goals')
  })

  test('/ms-plan marks planning and asks Claude for a proposal', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '导出')
    await run($, 'ms-plan', '#1')
    expect(w.text(1)).toContain('status: planning')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] 找方案 #1\n/)
  })

  test('a full pass: plan, focus, run each task, done', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    expect(w.text(1)).toContain('status: active')
    expect(await run($, 'ms-next')).toBe('开始 #1 T1 字段')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] 执行 #1 T1\n/)
    for (const n of [1, 2, 3]) await doTask($, n)
    expect(w.text(1)).toContain('- [x] T3 | 编码 | 验收: 不乱码')
    expect(await run($, 'ms-done')).toBe('#1 CSV 导出 完成')
    expect(w.text(1)).toContain('status: done')
  })

  test('tools refuse what the rules forbid, with the reason', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    await call($, 'start_task', { id: 1, task: 1 })
    const second = await call($, 'start_task', { id: 1, task: 2 })
    expect(second.deny).toMatch(/T1 还在进行中/)
    const early = await run($, 'ms-done')
    expect(early).toMatch(/还有未结束的 task/)
  })

  test('/ms-skip marks the current task skipped', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    expect(await run($, 'ms-skip')).toBe('#1 T1 已跳过')
    expect(w.text(1)).toContain('- [-] T1')
  })

  test('/ms-add asks Claude to propose and changes nothing yet', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    const before = w.text(1)
    await run($, 'ms-add', '补测试')
    expect(w.prompts.at(-1)).toMatch(/^\[milestone\] 追加 task #1：补测试/)
    expect(w.text(1)).toBe(before)
    await call($, 'add_task', { id: 1, title: '补测试', acceptance: '测试通过' })
    expect(w.text(1)).toContain('- [ ] T4 | 补测试 | 验收: 测试通过')
  })

  test('/ms-status lists the tree', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    expect(await run($, 'ms-status')).toContain('#1 CSV 导出 · 执行中 · 0/3')
  })
})

describe('auto', () => {
  test('auto runs the next task after each finished one and stops at the count', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto', '2')
    expect(w.prompts.at(-1)).toMatch(/执行 #1 T1/)
    await doTask($, 1)
    await turnDone($)
    expect(w.prompts.at(-1)).toMatch(/执行 #1 T2/)
    await doTask($, 2)
    await turnDone($)
    expect(w.prompts.filter(p => p.includes('执行 #1 T3'))).toHaveLength(0)
    expect(w.toasts.at(-1)).toMatch(/次数用完/)
  })

  test('auto stops when the task did not finish', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto')
    await call($, 'start_task', { id: 1, task: 1 })
    await turnDone($)
    const asked = w.prompts.filter(p => p.startsWith('[milestone] 执行'))
    expect(asked).toHaveLength(1)
    expect(w.toasts.at(-1)).toMatch(/T1 没有完成/)
  })

  test('auto stops when the turn was interrupted', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto')
    await doTask($, 1)
    await turnDone($, 'aborted')
    expect(w.prompts.filter(p => p.startsWith('[milestone] 执行'))).toHaveLength(1)
    expect(w.toasts.at(-1)).toMatch(/中断/)
  })

  test('auto stops after the last task and asks for /ms-done', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-auto', 'all')
    for (const n of [1, 2, 3]) {
      await doTask($, n)
      await turnDone($)
    }
    expect(w.prompts.filter(p => p.startsWith('[milestone] 执行'))).toHaveLength(3)
    expect(w.toasts.at(-1)).toMatch(/\/ms-done/)
  })

  test('step mode never continues on its own', async ($, on) => {
    const w = world(on)
    await start($)
    await planned($)
    await run($, 'ms-next')
    await doTask($, 1)
    await turnDone($)
    expect(w.prompts.filter(p => p.startsWith('[milestone] 执行'))).toHaveLength(1)
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
    expect(await run($, 'ms-status')).toContain('#1 导出')
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
    expect(await run($, 'ms-plan', '')).toBe('请写目标编号，例如 /ms-plan 12')
    expect(await run($, 'ms-focus', '9')).toBe('没有目标 #9')
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
    expect(await run($, 'ms-status')).toContain('无法解析 3.md')
    expect(await run($, 'ms-focus', '3')).toMatch(/无法解析/)
    expect(w.text(3)).toBe('not a goal')
  })

  test('edits from another session show up after the poll', async ($, on) => {
    const w = world(on)
    await start($)
    await run($, 'ms-new', '甲')
    w.files.set(`${DIR}/1.md`, { text: w.text(1).replace('title: 甲', 'title: 乙'), mtimeMs: 999 })
    await w.clock.advance(5000)
    expect(await run($, 'ms-status')).toContain('#1 乙')
  })
})

describe('panel', () => {
  test('the panel shows the tree and the active goal on terminal and desktop', async ($, on) => {
    world(on)
    await start($)
    await planned($)
    await call($, 'start_task', { id: 1, task: 1 })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'milestone', surface, component: 'Pane', requestId: 'milestone', props: { title: 'milestone', isFocused: false, bodyColumns: 40, placement: 'dock' } } as any)
      expect(await ui.find({ type: 'Text', text: /▶ #1 CSV 导出/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /T1 字段/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^─{400}$/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
