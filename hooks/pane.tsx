// The panel: the goal tree above, the active goal's acceptance and tasks below.

import type { Elements as AllElements, RenderSurface } from 'claude-code'

import type { Auto, Pool, Status, Task } from '../types'

import { SECTION, activeGoal, labelOf, sectionBody, treeOrder } from './model'
import { rowView } from './tree'
import type { TreeRow } from './tree'

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

/** Longer than any pane; clipped to one row, so it spans exactly the pane's width with no ellipsis. */
const RULE = '─'.repeat(400)

/** The key of the tree's Client: what `ui.message` and `ui.fault` name as `element`. */
export const TREE = 'tree'

/** `canDrag` false once the tree's Client failed on a surface: the rows are then drawn as plain rows. */
export type PaneData = { pool: Pool; auto: Auto; project: string; canDrag: boolean }

type Elements = AllElements[RenderSurface]

const modeText = (auto: Auto): string =>
  auto.remaining === 0 ? 'step' : auto.remaining < 0 ? 'auto · all' : `auto · ${auto.remaining} left`

/** The goal tree as plain rows, in tree order, dropped goals left out. */
export const treeRows = (pool: Pool): TreeRow[] => {
  const shown = treeOrder(pool).filter(x => x.goal.status !== 'dropped')
  const drawn = new Set(shown.map(x => x.goal.id))
  return shown.map(({ goal, depth }) => ({
    id: goal.id,
    parent: goal.parent !== null && drawn.has(goal.parent) ? goal.parent : null,
    depth,
    text: `${SYMBOL[goal.status]} ${goal.title}`,
    label: labelOf(goal),
    tone: goal.status === 'active' ? 'active' : goal.status === 'done' ? 'done' : goal.status === 'idea' ? 'dim' : 'plain',
  }))
}

/** The surfaces that draw a `Client` today; elsewhere the table may still name one it cannot run. */
const CLIENT_SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']

export const paneTree = (el: Elements, surface: RenderSurface, data: PaneData) => {
  const { Box, Text } = el
  const { pool, auto, project, canDrag } = data
  const active = activeGoal(pool)
  const rows = treeRows(pool)
  const Client = canDrag && CLIENT_SURFACES.includes(surface) && 'Client' in el ? el.Client : undefined

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate-end">{`milestone · ${project}`}</Text>
        <Text dimColor>{modeText(auto)}</Text>
      </Box>
      {rows.length === 0 && <Text dimColor>No goals yet. Record the first one with /ms-new title.</Text>}
      {Client && rows.length > 0 ? (
        <Client key={TREE} module="./tree.tsx" props={{ rows }} width="100%" />
      ) : (
        rows.map(r => rowView(el, r, ''))
      )}
      {pool.errors.map(e => (
        <Box key={`e${e.file}`}>
          <Text color="error" wrap="truncate-end">{`! ${e.file}: ${e.reason}`}</Text>
        </Box>
      ))}
      {active && (
        <Box flexDirection="column" marginTop={2}>
          <Box height={1} overflow="hidden">
            <Text dimColor wrap="wrap">{RULE}</Text>
          </Box>
          <Text bold>{active.title}</Text>
          {sectionBody(active, SECTION.acceptance) !== '' && (
            <Text dimColor wrap="wrap">{`Acceptance: ${sectionBody(active, SECTION.acceptance).split('\n')[0] ?? ''}`}</Text>
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
