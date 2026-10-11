// The panel: the goal tree above, the active goal's acceptance and tasks below.

import type { Elements as AllElements, RenderSurface } from 'claude-code'

import type { Auto, Goal, Pool, Status, Task } from '../types'

import { SECTION, STATUS_LABEL, activeGoal, progressOf, sectionBody, treeOrder } from './model'

const SYMBOL: Record<Status, string> = {
  idea: '·',
  planning: '?',
  planned: '○',
  active: '▶',
  done: '✓',
  dropped: '×',
}

const MARK_COLOR: Record<Task['mark'], string | undefined> = {
  ' ': undefined,
  '~': 'warning',
  x: 'success',
  '-': 'inactive',
}

/** Longer than any pane; drawn truncated, so it spans exactly the pane's width on every surface. */
const RULE = '─'.repeat(400)

export type PaneData = { pool: Pool; auto: Auto; project: string }

type Elements = Pick<AllElements[RenderSurface], 'Box' | 'Text'>

const modeText = (auto: Auto): string =>
  auto.remaining === 0 ? 'step' : auto.remaining < 0 ? 'auto · 全部' : `auto · 剩 ${auto.remaining}`

const row = ({ Box, Text }: Elements, g: Goal, depth: number, right: string, isActive: boolean) => (
  <Box key={`g${g.id}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
    <Text
      wrap="truncate-end"
      bold={isActive}
      color={isActive ? 'claude' : g.status === 'done' ? 'success' : undefined}
      dimColor={g.status === 'idea' || g.status === 'dropped'}
    >
      {`${'  '.repeat(depth)}${SYMBOL[g.status]} #${g.id} ${g.title}`}
    </Text>
    <Text dimColor={!isActive} color={isActive ? 'claude' : undefined}>
      {right}
    </Text>
  </Box>
)

export const paneTree = (el: Elements, data: PaneData) => {
  const { Box, Text } = el
  const { pool, auto, project } = data
  const active = activeGoal(pool)
  const shown = treeOrder(pool).filter(x => x.goal.status !== 'dropped')

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate-end">{`milestone · ${project}`}</Text>
        <Text dimColor>{modeText(auto)}</Text>
      </Box>
      {shown.length === 0 && <Text dimColor>还没有目标。用 /ms-new 标题 记下第一个。</Text>}
      {shown.map(({ goal, depth }) => {
        const p = progressOf(pool, goal)
        const label = goal.status === 'active' ? `执行中 ${p}` : `${STATUS_LABEL[goal.status]}${p ? ` ${p}` : ''}`
        return row(el, goal, depth, label, goal.status === 'active')
      })}
      {pool.errors.map(e => (
        <Box key={`e${e.file}`}>
          <Text color="error" wrap="truncate-end">{`! ${e.file}：${e.reason}`}</Text>
        </Box>
      ))}
      {active && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor wrap="truncate-end">{RULE}</Text>
          <Text bold>{`#${active.id} ${active.title}`}</Text>
          {sectionBody(active, SECTION.acceptance) !== '' && (
            <Text dimColor wrap="wrap">{`验收：${sectionBody(active, SECTION.acceptance).split('\n')[0] ?? ''}`}</Text>
          )}
          {active.tasks.map(t => (
            <Box key={`t${t.n}`}>
              <Text wrap="truncate-end">
                <Text color={MARK_COLOR[t.mark]}>{`[${t.mark}]`}</Text>
                <Text dimColor={t.mark === '-' || t.mark === 'x'}>{` T${t.n} ${t.title}`}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
