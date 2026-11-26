// Claude Code adapter: a pane that shows the same panel data as the Codex and
// Antigravity panels. It reads `read_panel` from the plugin's own MCP server and
// redraws on events only: the engine's file watch on .goals/project.json
// (classic SessionStart `watchPaths` + classic FileChanged) and the results of
// Milestone tool calls. No polling.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GoalView, PaneState, PanelView, TaskView } from '../types'
import { panelView } from './view.mjs'

type $ = EngineInterface

const PANE = 'milestone'
const TITLE = 'Milestone'
const SERVER_KEY = 'milestone'
const COMMAND = 'ms-panel'
const GOALS_DIR = '/.goals'
const PROJECT_FILE = `${GOALS_DIR}/project.json`
const MILESTONE_TOOL = /^mcp__.*milestone.*__(list_goals|manage_goal|start_task|report_task|finish_task|open_app|open_panel)$/
const OPEN_TOOL = /__(open_app|open_panel)$/

const EMPTY: PaneState = { view: null, sync: 'reading', message: '' }
const paneAtom = atom({ plugin: 'milestone', key: 'pane' } as const, EMPTY, { shape: 'pane-1' })
const expandedAtom = atom({ plugin: 'milestone', key: 'expanded' } as const, {}, { shape: 'expanded-1' })

const trimSlash = (path: string): string => path.replace(/\/+$/, '')

let root: string | undefined
let server: string | undefined
let reading = false
let again = false

async function projectRoot($: $): Promise<string> {
  root ??= trimSlash(await $.session.root())
  return root
}

async function serverName($: $): Promise<string> {
  if (server) return server
  const connected = await $.mcp.connect(SERVER_KEY)
  if (!connected.isConnected) throw new Error(connected.message || 'Milestone 服务未连接')
  server = connected.server
  return server
}

/** Reads the panel once; a request during a read runs one more read after it. */
async function refresh($: $): Promise<void> {
  if (reading) { again = true; return }
  reading = true
  try {
    do {
      again = false
      try {
        const project = await projectRoot($)
        // Reading creates .goals/ in a project that has none. Wait until the
        // conversation initializes Milestone; FileChanged then reports the folder.
        if (!(await $.fs.exists(`${project}${GOALS_DIR}`))) {
          await update($, paneAtom, () => ({ view: null, sync: 'idle' as const, message: '' }))
          continue
        }
        const result = await $.mcp.call(await serverName($), 'read_panel', { project })
        const text = result.content.find(block => block.type === 'text')
        const body = text && 'text' in text ? String(text.text) : ''
        if (result.isError) throw new Error(body || '读取失败')
        const view = panelView(JSON.parse(body)) as PanelView
        await update($, paneAtom, () => ({ view, sync: 'live' as const, message: '' }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await update($, paneAtom, state => ({ ...state, sync: 'error' as const, message }))
      }
    } while (again)
  } finally {
    reading = false
  }
}

async function openPane($: $) {
  return $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: COMMAND, description: '打开 Milestone 面板，查看项目目标和进度' }).catch(() => undefined)
    void openPane($)
    void refresh($)
    return started
  })

  // Ask the engine to watch .goals/; FileChanged below is the push channel. The
  // folder, not the file: the engine does not pick up a watched file that does
  // not exist yet, and a new project creates project.json mid-session.
  on('classic.SessionStart', async ($, e, next) => {
    const answered = await next(e)
    const folder = `${await projectRoot($)}${GOALS_DIR}`
    return { ...answered, watchPaths: [...(answered.watchPaths ?? []), folder] }
  })

  on('classic.FileChanged', async ($, e, next) => {
    const answered = await next(e)
    if (trimSlash(e.file_path) === `${await projectRoot($)}${PROJECT_FILE}`) await refresh($)
    return answered
  })

  // A Milestone tool call in this session redraws as soon as its result is in.
  on('tool.call', async ($, e, next) => {
    if (!MILESTONE_TOOL.test(e.tool)) return next(e)
    const ran = await next(e)
    if (OPEN_TOOL.test(e.tool)) void openPane($)
    await refresh($)
    return ran
  })

  on('command.run', { command: COMMAND }, async $ => {
    const opened = await openPane($)
    await refresh($)
    return { text: opened.isPlaced ? 'Milestone 面板已打开。' : `Milestone 面板暂时无法显示：${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Progress = 'Progress' in els ? els.Progress : undefined
    const { view, sync, message } = await read($, paneAtom)
    const expanded = await read($, expandedAtom)
    const toggle = (key: string) => () => update($, expandedAtom, open => ({ ...open, [key]: !open[key] }))

    const Lines = ({ lines }: { lines: string[] }) => (
      <Box flexDirection="column" gap={1}>
        {lines.map(line => <Text dimColor wrap="wrap">{line}</Text>)}
      </Box>
    )

    const taskRow = (task: TaskView) => (
      <Box flexDirection="column" key={task.key}>
        <Box flexDirection="row" gap={1}>
          <Text color={task.isCurrent ? 'suggestion' : undefined} dimColor={!task.isCurrent}>{task.icon}</Text>
          <Box flexGrow={1}>
            <Text bold={task.isCurrent} dimColor={task.isFinished} wrap="wrap">{task.title}</Text>
          </Box>
          <Text color={task.isCurrent ? 'suggestion' : undefined} dimColor={!task.isCurrent}>{task.state}</Text>
          <Button key={`toggle:${task.key}`} plain label={expanded[task.key] ? '收起' : '详情'} onPress={toggle(task.key)} />
        </Box>
        {expanded[task.key] && (
          <Box paddingLeft={2}>
            <Lines lines={[task.acceptance, ...task.notes]} />
          </Box>
        )}
      </Box>
    )

    const goalRow = (goal: GoalView) => (
      <Box flexDirection="column" key={goal.key}>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1}>
            <Text wrap="wrap">{goal.title}</Text>
          </Box>
          <Text dimColor>{goal.state}</Text>
          <Button key={`toggle:${goal.key}`} plain label={expanded[goal.key] ? '收起' : '展开'} onPress={toggle(goal.key)} />
        </Box>
        {expanded[goal.key] && (
          <Box flexDirection="column" paddingLeft={2} gap={1}>
            <Lines lines={goal.details} />
            {goal.tasks.map(taskRow)}
          </Box>
        )}
      </Box>
    )

    const status = sync === 'error' ? `暂时无法同步：${message}` : sync === 'live' ? '实时同步' : '正在读取…'

    if (!view) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor wrap="wrap">{sync === 'error' ? status : sync === 'idle' ? '这个项目还没有使用 Milestone。在对话中说“初始化 Milestone”即可开始。' : '正在读取项目…'}</Text>
          {sync === 'error' && <Button key="refresh" label="刷新" onPress={() => refresh($)} />}
        </Box>
      )
    }

    const current = view.current
    const archiveKey = 'archive'
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold size="heading">{view.projectName}</Text>
        <Box flexDirection="column">
          <Text dimColor size="caption">{current?.label ?? '当前目标'}</Text>
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1}>
              <Text bold size="title" wrap="wrap">{current?.title ?? view.emptyTitle}</Text>
            </Box>
            {current && <Button key="toggle:current" plain label={expanded['current'] ? '收起' : '详情'} onPress={toggle('current')} />}
          </Box>
          {!current && <Text dimColor>{view.emptyHint}</Text>}
          {current && expanded['current'] && <Lines lines={current.details} />}
        </Box>
        {current && (
          <Box flexDirection="row" justifyContent="space-between">
            <Text color="suggestion">{current.state}</Text>
            <Text dimColor tabular>{view.progress?.text ?? ''}</Text>
          </Box>
        )}
        {view.progress && Progress && <Progress label="已完成任务数" value={view.progress.done} max={view.progress.total} color="suggestion" />}
        {view.reason && <Text dimColor wrap="wrap">{view.reason}</Text>}
        {current && current.tasks.length > 0 && <Box flexDirection="column">{current.tasks.map(taskRow)}</Box>}
        {view.others.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text dimColor size="caption">其他目标</Text>
            {view.others.map(goalRow)}
          </Box>
        )}
        {view.archive.goals.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
              <Box flexGrow={1}>
                <Text dimColor>{view.archive.summary}</Text>
              </Box>
              <Button key="toggle:archive" plain label={expanded[archiveKey] ? '收起' : '展开'} onPress={toggle(archiveKey)} />
            </Box>
            {expanded[archiveKey] && view.archive.goals.map(goalRow)}
          </Box>
        )}
        {view.errors.length > 0 && <Text color="error" wrap="wrap">{view.errors.join('\n')}</Text>}
        <Box flexDirection="row" gap={1}>
          <Text dimColor size="caption">{status}</Text>
          {sync === 'error' && <Button key="refresh" plain label="刷新" onPress={() => refresh($)} />}
        </Box>
      </Box>
    )
  })
}
