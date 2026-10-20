// Goal files: parsing, serializing and the rules every change is checked against.
// Pure functions only; reading and writing files lives in register.tsx.

import type { FileError, Goal, Mark, Pool, Section, Split, Status, Task } from '../types'

export type { FileError, Goal, Mark, Pool, Section, Split, Status, Task }

export const STATUSES: readonly Status[] = ['idea', 'planning', 'planned', 'active', 'done', 'dropped']

export const SECTION = {
  description: 'Description',
  acceptance: 'Acceptance',
  approach: 'Approach',
  decisions: 'Decisions',
  tasks: 'Tasks',
} as const

/** Headings written by earlier versions, read as today's. */
const LEGACY_HEADING: Readonly<Record<string, string>> = {
  描述: SECTION.description,
  验收标准: SECTION.acceptance,
  方案: SECTION.approach,
  已定决策: SECTION.decisions,
}

const BODY_SECTIONS = [SECTION.description, SECTION.acceptance, SECTION.approach, SECTION.decisions]

const TASK_LINE = /^- \[( |~|x|-)\] T([1-9][0-9]*) \| (.+?) \| (?:acceptance|验收): (.+)$/
const FILE_NAME = /^([1-9][0-9]*)\.md$/

export const fileName = (id: number): string => `${id}.md`

export const idOfFile = (name: string): number | undefined => {
  const m = FILE_NAME.exec(name)
  return m?.[1] === undefined ? undefined : Number(m[1])
}

export const isEnded = (t: Task): boolean => t.mark === 'x' || t.mark === '-'

// ---------- parsing ----------

export const parseGoal = (text: string, file: string): Goal | FileError => {
  const fail = (reason: string): FileError => ({ file, reason })
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') return fail('the first line is not ---')
  const end = lines.indexOf('---', 1)
  if (end < 0) return fail('the frontmatter has no closing ---')

  const fm = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon < 0) return fail(`cannot read frontmatter line: ${line}`)
    fm.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }

  const idText = fm.get('id') ?? ''
  if (!/^[1-9][0-9]*$/.test(idText)) return fail('id is not a positive integer')
  const id = Number(idText)
  const expected = idOfFile(file)
  if (expected !== id) return fail(`id ${id} does not match the file name ${file}`)

  const title = fm.get('title') ?? ''
  if (title === '') return fail('title is empty')

  const status = (fm.get('status') ?? '') as Status
  if (!STATUSES.includes(status)) return fail(`invalid status: ${fm.get('status') ?? ''}`)

  const parentText = fm.get('parent') ?? ''
  if (parentText !== '' && !/^[1-9][0-9]*$/.test(parentText)) return fail('parent is not a positive integer')
  const parent = parentText === '' ? null : Number(parentText)
  if (parent === id) return fail('a goal cannot be its own parent')

  const orderText = fm.get('order') ?? ''
  if (orderText !== '' && !/^[1-9][0-9]*$/.test(orderText)) return fail('order is not a positive integer')
  const order = orderText === '' ? null : Number(orderText)

  const split = (fm.get('split') ?? '') as Split
  if (split !== '' && split !== 'tasks' && split !== 'goals') return fail(`invalid split: ${split}`)

  const created = fm.get('created') ?? ''

  const sections: Section[] = []
  let current: Section | undefined
  for (const line of lines.slice(end + 1)) {
    const h = /^## (.+)$/.exec(line)
    if (h?.[1] !== undefined) {
      const heading = h[1].trim()
      current = { heading: LEGACY_HEADING[heading] ?? heading, body: '' }
      sections.push(current)
    } else if (current) {
      current.body += (current.body === '' ? '' : '\n') + line
    } else if (line.trim() !== '') {
      return fail('text before the first ## heading')
    }
  }
  for (const s of sections) s.body = s.body.replace(/\s+$/, '')

  const tasks: Task[] = []
  const taskSection = sections.find(s => s.heading === SECTION.tasks)
  if (taskSection) {
    for (const line of taskSection.body.split('\n')) {
      if (line.trim() === '') continue
      const m = TASK_LINE.exec(line)
      if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) {
        return fail(`not a task line: ${line}`)
      }
      tasks.push({ n: Number(m[2]), mark: m[1] as Mark, title: m[3], acceptance: m[4] })
    }
  }
  if (tasks.length > 0 && split !== 'tasks') return fail('has tasks but split is not tasks')
  for (const [i, t] of tasks.entries()) {
    if (t.n !== i + 1) return fail(`task numbers are not consecutive: expected T${i + 1}, found T${t.n}`)
  }
  if (tasks.filter(t => t.mark === '~').length > 1) return fail('more than one task in progress')
  if (status === 'active' && split !== 'tasks') return fail('an active goal must be split into tasks')

  return {
    id,
    title,
    status,
    parent,
    order,
    split,
    created,
    sections: sections.filter(s => s.heading !== SECTION.tasks),
    tasks,
  }
}

export const isError = (x: Goal | FileError): x is FileError => 'reason' in x

// ---------- serializing ----------

export const sectionBody = (g: Goal, heading: string): string =>
  g.sections.find(s => s.heading === heading)?.body ?? ''

const withSection = (g: Goal, heading: string, body: string): Goal => {
  const has = g.sections.some(s => s.heading === heading)
  return {
    ...g,
    sections: has
      ? g.sections.map(s => (s.heading === heading ? { heading, body } : s))
      : [...g.sections, { heading, body }],
  }
}

export const taskLine = (t: Task): string => `- [${t.mark}] T${t.n} | ${t.title} | acceptance: ${t.acceptance}`

export const serializeGoal = (g: Goal): string => {
  const out: string[] = [
    '---',
    `id: ${g.id}`,
    `title: ${g.title}`,
    `status: ${g.status}`,
    `parent: ${g.parent ?? ''}`,
    ...(g.order === null ? [] : [`order: ${g.order}`]),
    `split: ${g.split}`,
    `created: ${g.created}`,
    '---',
  ]
  const known = new Set<string>([...BODY_SECTIONS, SECTION.tasks])
  for (const heading of BODY_SECTIONS) {
    out.push(`## ${heading}`)
    const body = sectionBody(g, heading)
    if (body !== '') out.push(body)
  }
  for (const s of g.sections) {
    if (known.has(s.heading)) continue
    out.push(`## ${s.heading}`)
    if (s.body !== '') out.push(s.body)
  }
  if (g.split === 'tasks') {
    out.push(`## ${SECTION.tasks}`)
    for (const t of g.tasks) out.push(taskLine(t))
  }
  return out.join('\n') + '\n'
}

// ---------- references and lookups ----------

export const parseRef = (text: string): number | undefined => {
  const m = /^#?([1-9][0-9]*)$/.exec(text.trim())
  return m?.[1] === undefined ? undefined : Number(m[1])
}

/**
 * A goal named by its number (`12`, `#12`) or by part of its title, case ignored; dropped goals
 * are not matched by title. A whole title wins over titles that only contain the text.
 */
export const resolveRef = (pool: Pool, text: string): number | Refusal => {
  const id = parseRef(text)
  if (id !== undefined) return id
  const want = text.trim().toLowerCase()
  if (want === '') return refuse('Name a goal: its number or part of its title')
  const live = pool.goals.filter(g => g.status !== 'dropped')
  const whole = live.filter(g => g.title.toLowerCase() === want)
  const found = whole.length > 0 ? whole : live.filter(g => g.title.toLowerCase().includes(want))
  const [only] = found
  if (found.length === 1 && only) return only.id
  if (found.length === 0) return refuse(`No goal matches "${text.trim()}"`)
  return refuse(`"${text.trim()}" matches several goals; write more of the title or its number:\n${found.map(g => `  ${g.title} (#${g.id})`).join('\n')}`)
}

/** Siblings by `order`, then by id: a group never reordered (no orders) stays in creation order. */
const bySiblingOrder = (a: Goal, b: Goal): number =>
  (a.order ?? Infinity) - (b.order ?? Infinity) || a.id - b.id

/** The goals under `id` (null: the top level), in sibling order. */
export const childrenOf = (pool: Pool, id: number | null): Goal[] =>
  pool.goals.filter(g => g.parent === id).sort(bySiblingOrder)

/** The order a new last sibling takes: next after the group's, or none while the group has none. */
const orderAfter = (siblings: readonly Goal[]): number | null =>
  siblings.length > 0 && siblings.every(s => s.order !== null) ? Math.max(...siblings.map(s => s.order ?? 0)) + 1 : null

export const activeGoal = (pool: Pool): Goal | undefined => pool.goals.find(g => g.status === 'active')

export const nextTask = (g: Goal): Task | undefined =>
  g.tasks.find(t => t.mark === '~') ?? g.tasks.find(t => t.mark === ' ')

export const nextId = (pool: Pool, taken: readonly number[] = []): number =>
  Math.max(0, ...pool.goals.map(g => g.id), ...taken) + 1

// ---------- changes ----------

export type Change = { write: Goal[]; message: string }
export type Refusal = { error: string }
export type Outcome = Change | Refusal

export const refused = (o: Outcome): o is Refusal => 'error' in o

const refuse = (error: string): Refusal => ({ error })

const oneLine = (label: string, text: string): string | undefined => {
  if (text.trim() === '') return `${label} cannot be empty`
  if (/[\r\n]/.test(text)) return `${label} must be one line`
  return undefined
}

const taskTextError = (title: string, acceptance: string): string | undefined =>
  oneLine('task title', title) ??
  oneLine('acceptance', acceptance) ??
  (/\| (?:acceptance|验收): /.test(title) ? 'a task title cannot contain "| acceptance: "' : undefined)

const find = (pool: Pool, id: number): Goal | Refusal => {
  const g = pool.goals.find(x => x.id === id)
  if (g) return g
  const broken = pool.errors.find(e => e.file === fileName(id))
  return refuse(broken ? `#${id} cannot be read (${broken.reason}); fix the file first` : `no goal #${id}`)
}

const isRefusal = (x: Goal | Refusal): x is Refusal => 'error' in x

export type CreateInput = { title: string; parent?: number; description?: string; today: string }

export const createGoal = (pool: Pool, input: CreateInput, taken: readonly number[] = []): Outcome => {
  const bad = oneLine('title', input.title)
  if (bad) return refuse(bad)
  if (input.parent !== undefined) {
    const parent = find(pool, input.parent)
    if (isRefusal(parent)) return parent
    if (parent.split === 'tasks') return refuse(`#${parent.id} is split into tasks and cannot take sub-goals`)
    if (parent.status === 'done' || parent.status === 'dropped') {
      return refuse(`#${parent.id} is ${parent.status} and cannot take sub-goals`)
    }
  }
  const id = nextId(pool, taken)
  const goal: Goal = {
    id,
    title: input.title.trim(),
    status: 'idea',
    parent: input.parent ?? null,
    order: orderAfter(childrenOf(pool, input.parent ?? null)),
    split: '',
    created: input.today,
    sections: input.description ? [{ heading: SECTION.description, body: input.description.trim() }] : [],
    tasks: [],
  }
  const write = [goal]
  if (input.parent !== undefined) {
    const parent = pool.goals.find(x => x.id === input.parent)
    if (parent && parent.split === '') write.push({ ...parent, split: 'goals' })
  }
  return { write, message: `Recorded #${id} ${goal.title}` }
}

export const startPlanning = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status !== 'idea' && g.status !== 'planning') {
    return refuse(`#${id} is ${g.status}; only an idea or a goal being planned can be planned`)
  }
  return { write: g.status === 'planning' ? [] : [{ ...g, status: 'planning' }], message: `#${id} planning started` }
}

export type PlanInput = {
  id: number
  description?: string
  acceptance: string
  approach: string
  decisions?: string
  split: 'tasks' | 'goals'
  tasks?: readonly { title: string; acceptance: string }[]
  goals?: readonly { title: string; description?: string }[]
  today: string
}

export const planGoal = (pool: Pool, input: PlanInput): Outcome => {
  const g = find(pool, input.id)
  if (isRefusal(g)) return g
  if (g.status !== 'idea' && g.status !== 'planning') {
    return refuse(`#${g.id} is ${g.status}; only an idea or a goal being planned can take a plan`)
  }
  if (input.acceptance.trim() === '') return refuse('acceptance cannot be empty')
  if (input.approach.trim() === '') return refuse('approach cannot be empty')
  const kids = childrenOf(pool, g.id)
  if (input.split === 'tasks' && kids.length > 0) return refuse(`#${g.id} already has sub-goals; it can only split into sub-goals`)
  if (g.split !== '' && g.split !== input.split) return refuse(`#${g.id} is already split into ${g.split === 'tasks' ? 'tasks' : 'sub-goals'}`)

  let next: Goal = { ...g, status: 'planned', split: input.split }
  if (input.description !== undefined && input.description.trim() !== '') {
    next = withSection(next, SECTION.description, input.description.trim())
  }
  next = withSection(next, SECTION.acceptance, input.acceptance.trim())
  next = withSection(next, SECTION.approach, input.approach.trim())
  if (input.decisions !== undefined && input.decisions.trim() !== '') {
    next = withSection(next, SECTION.decisions, input.decisions.trim())
  }

  const write: Goal[] = []
  if (input.split === 'tasks') {
    const tasks = input.tasks ?? []
    if (tasks.length === 0) return refuse('a split into tasks needs at least one task')
    for (const t of tasks) {
      const bad = taskTextError(t.title, t.acceptance)
      if (bad) return refuse(bad)
    }
    next = {
      ...next,
      tasks: tasks.map((t, i) => ({ n: i + 1, mark: ' ', title: t.title.trim(), acceptance: t.acceptance.trim() })),
    }
    write.push(next)
  } else {
    const goals = input.goals ?? []
    if (goals.length === 0 && kids.length === 0) return refuse('a split into sub-goals needs at least one sub-goal')
    write.push(next)
    const taken: number[] = []
    const first = orderAfter(kids)
    for (const [i, c] of goals.entries()) {
      const made = createGoal(pool, { title: c.title, parent: undefined, description: c.description, today: input.today }, taken)
      if (refused(made)) return made
      const child = made.write[0]
      if (!child) return refuse('could not create the sub-goal')
      taken.push(child.id)
      write.push({ ...child, parent: g.id, order: first === null ? null : first + i })
    }
  }
  const what = input.split === 'tasks' ? `${next.tasks.length} tasks` : `${write.length - 1 + kids.length} sub-goals`
  return { write, message: `#${g.id} planned: ${what}` }
}

export const focusGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'active') return { write: [], message: `#${id} is already active` }
  if (g.status !== 'planned') return refuse(`#${id} is ${g.status}; only a planned goal can become active`)
  if (g.split !== 'tasks') return refuse(`#${id} is split into sub-goals; pick one of them`)
  const write: Goal[] = [{ ...g, status: 'active' }]
  for (const other of pool.goals) {
    if (other.status === 'active') write.push({ ...other, status: 'planned' })
  }
  return { write, message: `#${id} ${g.title} is now active` }
}

const requireActive = (pool: Pool, id: number): Goal | Refusal => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status !== 'active') return refuse(`#${id} is not the active goal`)
  return g
}

const findTask = (g: Goal, n: number): Task | Refusal =>
  g.tasks.find(t => t.n === n) ?? refuse(`#${g.id} has no T${n}`)

const isTaskRefusal = (x: Task | Refusal): x is Refusal => 'error' in x

const setMark = (g: Goal, n: number, mark: Mark): Goal => ({
  ...g,
  tasks: g.tasks.map(t => (t.n === n ? { ...t, mark } : t)),
})

export const startTask = (pool: Pool, id: number, n: number): Outcome => {
  const g = requireActive(pool, id)
  if (isRefusal(g)) return g
  const t = findTask(g, n)
  if (isTaskRefusal(t)) return t
  if (t.mark === '~') return { write: [], message: `T${n} is already in progress` }
  if (t.mark !== ' ') return refuse(`T${n} is already ${t.mark === 'x' ? 'done' : 'skipped'}`)
  const running = g.tasks.find(x => x.mark === '~')
  if (running) return refuse(`T${running.n} is still in progress; only one task can be in progress at a time`)
  return { write: [setMark(g, n, '~')], message: `#${id} T${n} started` }
}

export const finishTask = (pool: Pool, id: number, n: number): Outcome => {
  const g = requireActive(pool, id)
  if (isRefusal(g)) return g
  const t = findTask(g, n)
  if (isTaskRefusal(t)) return t
  if (t.mark !== '~') return refuse(`T${n} is not in progress; start it first`)
  return endTask(g, n, 'x', `#${id} T${n} done`)
}

export const skipTask = (pool: Pool): Outcome => {
  const g = activeGoal(pool)
  if (!g) return refuse('no active goal')
  const t = nextTask(g)
  if (!t) return refuse(`#${g.id} has no task to skip`)
  return endTask(g, t.n, '-', `#${g.id} T${t.n} skipped`)
}

/** Ends one task; ending the last one completes the goal. */
const endTask = (g: Goal, n: number, mark: Mark, said: string): Change => {
  const after = setMark(g, n, mark)
  const left = after.tasks.filter(x => !isEnded(x)).length
  if (left > 0) return { write: [after], message: `${said}; ${left} left` }
  return { write: [{ ...after, status: 'done' }], message: `${said}; all tasks ended, #${g.id} ${g.title} done` }
}

export const addTask = (pool: Pool, id: number, title: string, acceptance: string): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.split !== 'tasks') return refuse(`#${id} is not split into tasks`)
  if (g.status !== 'planned' && g.status !== 'active') return refuse(`#${id} is ${g.status} and cannot take a task`)
  const bad = taskTextError(title, acceptance)
  if (bad) return refuse(bad)
  const n = g.tasks.length + 1
  return {
    write: [{ ...g, tasks: [...g.tasks, { n, mark: ' ', title: title.trim(), acceptance: acceptance.trim() }] }],
    message: `#${id} added T${n}`,
  }
}

export const completeGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'done') return { write: [], message: `#${id} is already done` }
  if (g.status === 'dropped') return refuse(`#${id} is dropped`)
  if (g.split === 'tasks') {
    const open = g.tasks.filter(t => !isEnded(t))
    if (open.length > 0) return refuse(`#${id} has tasks not ended: ${open.map(t => `T${t.n}`).join(', ')}`)
  }
  if (g.split === 'goals') {
    const open = childrenOf(pool, id).filter(c => c.status !== 'done' && c.status !== 'dropped')
    if (open.length > 0) return refuse(`#${id} has sub-goals not ended: ${open.map(c => `#${c.id}`).join(', ')}`)
  }
  return { write: [{ ...g, status: 'done' }], message: `#${id} ${g.title} done` }
}

export const dropGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'done') return refuse(`#${id} is done and cannot be dropped`)
  if (g.status === 'dropped') return { write: [], message: `#${id} is already dropped` }
  const open = childrenOf(pool, id).filter(c => c.status !== 'done' && c.status !== 'dropped')
  const note = open.length > 0 ? `; sub-goals ${open.map(c => `#${c.id}`).join(', ')} are left as they are` : ''
  return { write: [{ ...g, status: 'dropped' }], message: `#${id} dropped${note}` }
}

/** Moves a goal among its siblings: before `before`, or last. The whole group is renumbered 1..n. */
export const moveGoal = (pool: Pool, id: number, before?: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  const group = childrenOf(pool, g.parent)
  const rest = group.filter(s => s.id !== id)
  let at = rest.length
  if (before !== undefined) {
    if (before === id) return refuse(`#${id} cannot move before itself`)
    const b = find(pool, before)
    if (isRefusal(b)) return b
    if (b.parent !== g.parent) return refuse(`#${before} is not a sibling of #${id}; only siblings can be reordered`)
    at = rest.findIndex(s => s.id === before)
  }
  const placed = [...rest.slice(0, at), g, ...rest.slice(at)]
  const write = placed.flatMap((s, i) => (s.order === i + 1 ? [] : [{ ...s, order: i + 1 }]))
  return { write, message: before === undefined ? `Moved #${id} ${g.title} to the end` : `Moved #${id} ${g.title} before #${before}` }
}

/** A parent whose children have all ended, after `id` changed: the hint shown to the person. */
export const parentReady = (pool: Pool, id: number): Goal | undefined => {
  const g = pool.goals.find(x => x.id === id)
  if (!g || g.parent === null) return undefined
  const parent = pool.goals.find(x => x.id === g.parent)
  if (!parent || parent.status === 'done' || parent.status === 'dropped') return undefined
  const kids = childrenOf(pool, parent.id)
  return kids.length > 0 && kids.every(c => c.status === 'done' || c.status === 'dropped') ? parent : undefined
}

/** The pool after a change: written goals replace their old selves. */
export const applyChange = (pool: Pool, write: readonly Goal[]): Pool => {
  const byId = new Map(pool.goals.map(g => [g.id, g]))
  for (const g of write) byId.set(g.id, g)
  return { goals: [...byId.values()].sort((a, b) => a.id - b.id), errors: pool.errors }
}

// ---------- text overview ----------

/** The one label beside a goal: its status, or `k/n` while active, k the task in progress or next. */
export const labelOf = (g: Goal): string => {
  if (g.status !== 'active' || g.tasks.length === 0) return g.status
  return `${nextTask(g)?.n ?? g.tasks.length}/${g.tasks.length}`
}

/** Goals in tree order with their depth; children follow their parent, in sibling order. */
export const treeOrder = (pool: Pool): { goal: Goal; depth: number }[] => {
  const ids = new Set(pool.goals.map(g => g.id))
  const roots = pool.goals.filter(g => g.parent === null || !ids.has(g.parent)).sort(bySiblingOrder)
  const out: { goal: Goal; depth: number }[] = []
  const seen = new Set<number>()
  const walk = (g: Goal, depth: number) => {
    if (seen.has(g.id)) return
    seen.add(g.id)
    out.push({ goal: g, depth })
    for (const c of childrenOf(pool, g.id)) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  for (const g of pool.goals) walk(g, 0)
  return out
}

export const statusText = (pool: Pool): string => {
  const shown = treeOrder(pool).filter(x => x.goal.status !== 'dropped')
  if (shown.length === 0 && pool.errors.length === 0) return 'No goals yet. Record the first one with /ms-new <title>.'
  const lines = shown.map(({ goal, depth }) => `${'  '.repeat(depth)}${goal.title} · ${labelOf(goal)}`)
  const active = activeGoal(pool)
  if (active) {
    lines.push('', `Active: ${active.title}`)
    for (const t of active.tasks) lines.push(`  [${t.mark}] T${t.n} ${t.title}`)
  }
  for (const e of pool.errors) lines.push(`Cannot read ${e.file}: ${e.reason}`)
  return lines.join('\n')
}
