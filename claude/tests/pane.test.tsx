import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const ROOT = '/work/demo'
const SERVER = 'plugin:milestone:milestone'
const FILE = `${ROOT}/.goals/project.json`

const goal = (id: number, title: string, status: string, tasks: { n: number; title: string; mark: string }[]) => ({
  id, title, status,
  sections: [{ heading: 'Acceptance', body: `${title} 的验收` }],
  tasks: tasks.map(t => ({ ...t, acceptance: `${t.title} 可验证` })),
})

const panel = (finished: boolean) => ({
  projectName: 'demo',
  project: ROOT,
  test: {
    goals: [
      goal(1, '发布 Claude Code 版', 'active', [
        { n: 1, title: '面板实时更新', mark: finished ? 'x' : '~' },
        { n: 2, title: '安装说明', mark: ' ' },
      ]),
      goal(2, '整理文档', 'planned', []),
      goal(3, '旧版迁移', 'done', []),
    ],
    drafts: {},
    errors: [],
  },
  run: null,
})

const RUN = {
  command: 'ms-panel', args: '',
  origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 },
} as const

const PANE = {
  plugin: 'milestone',
  component: 'Pane',
  requestId: 'milestone',
  props: {
    title: 'Milestone', isFocused: false, bodyColumns: 60, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
} as const

/** Stands for the engine and the Milestone MCP server; counts panel reads. */
function engine(on: On, state: { finished: boolean; reads: number; fail?: string | undefined }) {
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'ms-panel' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.connect', () => ({ value: { isConnected: true, server: SERVER } }))
  on('mcp.call', (_, e) => {
    if (e.server !== SERVER || e.tool !== 'read_panel' || (e.args as { project?: string })?.project !== ROOT) {
      return { value: { content: [{ type: 'text', text: 'unexpected call' }], isError: true } }
    }
    state.reads += 1
    if (state.fail) return { value: { content: [{ type: 'text', text: state.fail }], isError: true } }
    return { value: { content: [{ type: 'text', text: JSON.stringify(panel(state.finished)) }], isError: false } }
  })
  on('tool.call', () => ({ result: {} }))
}

test('the pane shows the current goal and its tasks on every surface', async ($, on) => {
  const state = { finished: false, reads: 0 }
  engine(on, state)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '发布 Claude Code 版' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '面板实时更新' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '其他目标' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '整理文档' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /已完成的目标\s+1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '实时同步' })).toBeDefined()
    await ui.unmount()
  }
})

test('session start asks the engine to watch the project file', async ($, on) => {
  engine(on, { finished: false, reads: 0 })
  const answered = await $.classic.SessionStart({ source: 'startup' })
  expect(answered.watchPaths).toContain(FILE)
})

test('a change to the project file redraws the pane; other files do not read', async ($, on) => {
  const state = { finished: false, reads: 0 }
  engine(on, state)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 / 2' })).toBeUndefined()

  const before = state.reads
  await $.classic.FileChanged({ file_path: `${ROOT}/README.md`, event: 'change' })
  expect(state.reads).toBe(before)

  state.finished = true
  await $.classic.FileChanged({ file_path: FILE, event: 'change' })
  expect(state.reads).toBe(before + 1)
  expect(await ui.find({ type: 'Text', text: '1 / 2' })).toBeDefined()
  await ui.unmount()
})

test('a Milestone tool call redraws once its result is in', async ($, on) => {
  const state = { finished: false, reads: 0 }
  engine(on, state)
  await $.command.run(RUN)
  const before = state.reads

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(state.reads).toBe(before)

  state.finished = true
  await $.tool.call({ tool: 'mcp__plugin_milestone_milestone__finish_task', id: 1, task: 1 })
  expect(state.reads).toBe(before + 1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 / 2' })).toBeDefined()
  await ui.unmount()
})

test('a task expands to show its acceptance', async ($, on) => {
  engine(on, { finished: false, reads: 0 })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '验收：面板实时更新 可验证' })).toBeUndefined()
  await $.ui.press({ plugin: 'milestone', key: 'toggle:task:1:1' })
  expect(await ui.find({ type: 'Text', text: '验收：面板实时更新 可验证' })).toBeDefined()
  await ui.unmount()
})

test('a failed read shows the reason and a refresh button', async ($, on) => {
  const state: { finished: boolean; reads: number; fail?: string | undefined } = { finished: false, reads: 0, fail: 'Project directory does not exist' }
  engine(on, state)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Project directory does not exist/ })).toBeDefined()

  state.fail = undefined
  await $.ui.press({ plugin: 'milestone', key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: '发布 Claude Code 版' })).toBeDefined()
  await ui.unmount()
})
