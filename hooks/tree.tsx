// The goal tree in the panel. Drawn as a Client where the surface has one: the pointer on a row
// shows a handle, and dragging a row moves it among its siblings, posting the move when dropped.

import type { ClientModule, Elements, RenderSurface } from 'claude-code'

export type TreeRow = {
  id: number
  /** The parent's id when the parent is drawn too; null for a row drawn at the top of its tree. */
  parent: number | null
  depth: number
  text: string
  label: string
  tone: 'active' | 'done' | 'dim' | 'plain'
}

export type TreeProps = { rows: TreeRow[] }

/** Posted when a drop changes the order: move `move` in front of `before`, or last when null. */
export type TreeMove = { move: number; before: number | null }

type Drag = { id: number; order: number[] }
type State = { hover?: number; drag?: Drag }

type Draw = Pick<Elements[RenderSurface], 'Box' | 'Text'>

const HANDLE = '⠿ '
const NO_HANDLE = '  '

export const rowView = ({ Box, Text }: Draw, r: TreeRow, gutter: string, isLifted = false) => (
  <Box key={`g${r.id}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
    <Text
      wrap="truncate-end"
      bold={r.tone === 'active'}
      color={r.tone === 'active' ? 'claude' : r.tone === 'done' ? 'success' : undefined}
      dimColor={r.tone === 'dim'}
      inverse={isLifted}
    >
      {`${gutter}${'  '.repeat(r.depth)}${r.text}`}
    </Text>
    <Box flexShrink={0}>
      <Text dimColor={r.tone !== 'active'} color={r.tone === 'active' ? 'claude' : undefined}>
        {r.label}
      </Text>
    </Box>
  </Box>
)

/** `ids` with `dragged` moved to `onto`'s place among their siblings, each subtree following its root. */
export const moveAmongSiblings = (rows: readonly TreeRow[], ids: readonly number[], dragged: number, onto: number): number[] => {
  const byId = new Map(rows.map(r => [r.id, r]))
  const roots: number[] = []
  const kids = new Map<number, number[]>()
  for (const id of ids) {
    const parent = byId.get(id)?.parent ?? null
    if (parent === null) roots.push(id)
    else kids.set(parent, [...(kids.get(parent) ?? []), id])
  }
  const parent = byId.get(dragged)?.parent ?? null
  const group = parent === null ? roots : (kids.get(parent) ?? [])
  const from = group.indexOf(dragged)
  const to = group.indexOf(onto)
  if (from >= 0 && to >= 0) {
    group.splice(from, 1)
    group.splice(to, 0, dragged)
  }
  const out: number[] = []
  const walk = (id: number) => {
    out.push(id)
    for (const c of kids.get(id) ?? []) walk(c)
  }
  for (const r of roots) walk(r)
  return out
}

/** The sibling of `dragged` that the row `at` belongs to: the row itself, or its ancestor. */
const siblingAt = (rows: readonly TreeRow[], dragged: number, at: number): number | undefined => {
  const byId = new Map(rows.map(r => [r.id, r]))
  const parent = byId.get(dragged)?.parent ?? null
  for (let r = byId.get(at); r; r = r.parent === null ? undefined : byId.get(r.parent)) {
    if (r.parent === parent) return r.id
  }
  return undefined
}

/** Where a drop leaves `dragged`: in front of its next sibling, or last; undefined when nothing moved. */
export const dropOf = (rows: readonly TreeRow[], order: readonly number[], dragged: number): TreeMove | undefined => {
  const parent = rows.find(r => r.id === dragged)?.parent ?? null
  const group = (ids: readonly number[]) => ids.filter(id => (rows.find(r => r.id === id)?.parent ?? null) === parent)
  const before = group(rows.map(r => r.id))
  const after = group(order)
  if (before.join() === after.join()) return undefined
  return { move: dragged, before: after[after.indexOf(dragged) + 1] ?? null }
}

const Tree: ClientModule<TreeProps, State> = (props, surface) => {
  const rows = props.rows
  const state = surface.state ?? {}
  const shown = state.drag?.order ?? rows.map(r => r.id)

  surface.onPointer(e => {
    const s = surface.state ?? {}
    const order = s.drag?.order ?? rows.map(r => r.id)
    const at = order[Math.max(0, Math.min(order.length - 1, e.y))]
    if (e.type === 'down' && e.button === 'left') {
      if (at !== undefined && e.y >= 0 && e.y < order.length) surface.setState({ hover: e.y, drag: { id: at, order } })
    } else if (e.type === 'move' && s.drag) {
      const onto = at === undefined ? undefined : siblingAt(rows, s.drag.id, at)
      if (onto === undefined || onto === s.drag.id) return
      const next = moveAmongSiblings(rows, s.drag.order, s.drag.id, onto)
      if (next.join() !== s.drag.order.join()) surface.setState({ ...s, drag: { ...s.drag, order: next } })
    } else if (e.type === 'up' && s.drag) {
      const drop = dropOf(rows, s.drag.order, s.drag.id)
      surface.setState({ hover: e.y })
      if (drop) surface.post(drop)
    } else if (e.type === 'move') {
      if (s.hover !== e.y) surface.setState({ hover: e.y })
    } else if (e.type === 'leave' && !s.drag) {
      surface.setState({})
    }
  })

  const byId = new Map(rows.map(r => [r.id, r]))
  const { Box } = surface.elements
  return (
    <Box flexDirection="column">
      {shown.map((id, i) => {
        const r = byId.get(id)
        if (!r) return null
        const isLifted = state.drag?.id === id
        const gutter = isLifted || (!state.drag && state.hover === i) ? HANDLE : NO_HANDLE
        return rowView(surface.elements, r, gutter, isLifted)
      })}
    </Box>
  )
}

export default Tree
