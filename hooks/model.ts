// Goal files: parsing, serializing and the rules every change is checked against.
// Pure functions only; reading and writing files lives in store.ts.

import type { FileError, Goal, Mark, Pool, Section, Split, Status, Task } from '../types'

export type { FileError, Goal, Mark, Pool, Section, Split, Status, Task }

export const STATUSES: readonly Status[] = ['idea', 'planning', 'planned', 'active', 'done', 'dropped']

export const STATUS_LABEL: Record<Status, string> = {
  idea: '想法',
  planning: '找方案',
  planned: '已计划',
  active: '执行中',
  done: '完成',
  dropped: '放弃',
}

export const SECTION = {
  description: '描述',
  acceptance: '验收标准',
  approach: '方案',
  decisions: '已定决策',
  tasks: 'Tasks',
} as const

const BODY_SECTIONS = [SECTION.description, SECTION.acceptance, SECTION.approach, SECTION.decisions]

const TASK_LINE = /^- \[( |~|x|-)\] T([1-9][0-9]*) \| (.+?) \| 验收: (.+)$/
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
  if (lines[0] !== '---') return fail('第一行不是 ---')
  const end = lines.indexOf('---', 1)
  if (end < 0) return fail('frontmatter 没有结束的 ---')

  const fm = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon < 0) return fail(`frontmatter 行无法解析：${line}`)
    fm.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }

  const idText = fm.get('id') ?? ''
  if (!/^[1-9][0-9]*$/.test(idText)) return fail('id 不是正整数')
  const id = Number(idText)
  const expected = idOfFile(file)
  if (expected !== id) return fail(`id ${id} 与文件名 ${file} 不一致`)

  const title = fm.get('title') ?? ''
  if (title === '') return fail('title 为空')

  const status = (fm.get('status') ?? '') as Status
  if (!STATUSES.includes(status)) return fail(`status 无效：${fm.get('status') ?? ''}`)

  const parentText = fm.get('parent') ?? ''
  if (parentText !== '' && !/^[1-9][0-9]*$/.test(parentText)) return fail('parent 不是正整数')
  const parent = parentText === '' ? null : Number(parentText)
  if (parent === id) return fail('parent 不能是自己')

  const split = (fm.get('split') ?? '') as Split
  if (split !== '' && split !== 'tasks' && split !== 'goals') return fail(`split 无效：${split}`)

  const created = fm.get('created') ?? ''

  const sections: Section[] = []
  let current: Section | undefined
  for (const line of lines.slice(end + 1)) {
    const h = /^## (.+)$/.exec(line)
    if (h?.[1] !== undefined) {
      current = { heading: h[1].trim(), body: '' }
      sections.push(current)
    } else if (current) {
      current.body += (current.body === '' ? '' : '\n') + line
    } else if (line.trim() !== '') {
      return fail('正文在第一个 ## 标题之前有内容')
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
        return fail(`不是 task 行：${line}`)
      }
      tasks.push({ n: Number(m[2]), mark: m[1] as Mark, title: m[3], acceptance: m[4] })
    }
  }
  if (tasks.length > 0 && split !== 'tasks') return fail('有 tasks 但 split 不是 tasks')
  for (const [i, t] of tasks.entries()) {
    if (t.n !== i + 1) return fail(`task 编号不连续：期望 T${i + 1}，实际 T${t.n}`)
  }
  if (tasks.filter(t => t.mark === '~').length > 1) return fail('有多个进行中的 task')
  if (status === 'active' && split !== 'tasks') return fail('执行中的目标必须拆成 tasks')

  return {
    id,
    title,
    status,
    parent,
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

export const taskLine = (t: Task): string => `- [${t.mark}] T${t.n} | ${t.title} | 验收: ${t.acceptance}`

export const serializeGoal = (g: Goal): string => {
  const out: string[] = [
    '---',
    `id: ${g.id}`,
    `title: ${g.title}`,
    `status: ${g.status}`,
    `parent: ${g.parent ?? ''}`,
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

export const childrenOf = (pool: Pool, id: number): Goal[] => pool.goals.filter(g => g.parent === id)

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
  if (text.trim() === '') return `${label}不能为空`
  if (/[\r\n]/.test(text)) return `${label}不能换行`
  return undefined
}

const taskTextError = (title: string, acceptance: string): string | undefined =>
  oneLine('task 标题', title) ??
  oneLine('验收', acceptance) ??
  (/\| 验收: /.test(title) ? 'task 标题不能包含「| 验收: 」' : undefined)

const find = (pool: Pool, id: number): Goal | Refusal => {
  const g = pool.goals.find(x => x.id === id)
  if (g) return g
  const broken = pool.errors.find(e => e.file === fileName(id))
  return refuse(broken ? `#${id} 的文件无法解析（${broken.reason}），先修好它` : `没有目标 #${id}`)
}

const isRefusal = (x: Goal | Refusal): x is Refusal => 'error' in x

export type CreateInput = { title: string; parent?: number; description?: string; today: string }

export const createGoal = (pool: Pool, input: CreateInput, taken: readonly number[] = []): Outcome => {
  const bad = oneLine('标题', input.title)
  if (bad) return refuse(bad)
  if (input.parent !== undefined) {
    const parent = find(pool, input.parent)
    if (isRefusal(parent)) return parent
    if (parent.split === 'tasks') return refuse(`#${parent.id} 已拆成 tasks，不能再挂子目标`)
    if (parent.status === 'done' || parent.status === 'dropped') {
      return refuse(`#${parent.id} 已${STATUS_LABEL[parent.status]}，不能再挂子目标`)
    }
  }
  const id = nextId(pool, taken)
  const goal: Goal = {
    id,
    title: input.title.trim(),
    status: 'idea',
    parent: input.parent ?? null,
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
  return { write, message: `已记下 #${id} ${goal.title}` }
}

export const startPlanning = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status !== 'idea' && g.status !== 'planning') {
    return refuse(`#${id} 是「${STATUS_LABEL[g.status]}」，只有想法或找方案中的目标能找方案`)
  }
  return { write: g.status === 'planning' ? [] : [{ ...g, status: 'planning' }], message: `#${id} 开始找方案` }
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
    return refuse(`#${g.id} 是「${STATUS_LABEL[g.status]}」，只有想法或找方案中的目标能写入方案`)
  }
  if (input.acceptance.trim() === '') return refuse('验收标准不能为空')
  if (input.approach.trim() === '') return refuse('方案不能为空')
  const kids = childrenOf(pool, g.id)
  if (input.split === 'tasks' && kids.length > 0) return refuse(`#${g.id} 已有子目标，只能拆成子目标`)
  if (g.split !== '' && g.split !== input.split) return refuse(`#${g.id} 已确定拆成${g.split === 'tasks' ? ' tasks' : '子目标'}`)

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
    if (tasks.length === 0) return refuse('拆成 tasks 时至少要有一个 task')
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
    if (goals.length === 0 && kids.length === 0) return refuse('拆成子目标时至少要有一个子目标')
    write.push(next)
    const taken: number[] = []
    for (const c of goals) {
      const made = createGoal(pool, { title: c.title, parent: undefined, description: c.description, today: input.today }, taken)
      if (refused(made)) return made
      const child = made.write[0]
      if (!child) return refuse('子目标创建失败')
      taken.push(child.id)
      write.push({ ...child, parent: g.id })
    }
  }
  const what = input.split === 'tasks' ? `${next.tasks.length} 个 task` : `${write.length - 1 + kids.length} 个子目标`
  return { write, message: `#${g.id} 已计划：${what}` }
}

export const focusGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'active') return { write: [], message: `#${id} 已经是执行中` }
  if (g.status !== 'planned') return refuse(`#${id} 是「${STATUS_LABEL[g.status]}」，只有已计划的目标能执行`)
  if (g.split !== 'tasks') return refuse(`#${id} 拆成了子目标，请选择一个子目标执行`)
  const write: Goal[] = [{ ...g, status: 'active' }]
  for (const other of pool.goals) {
    if (other.status === 'active') write.push({ ...other, status: 'planned' })
  }
  return { write, message: `#${id} ${g.title} 设为执行中` }
}

const requireActive = (pool: Pool, id: number): Goal | Refusal => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status !== 'active') return refuse(`#${id} 不是执行中的目标`)
  return g
}

const findTask = (g: Goal, n: number): Task | Refusal =>
  g.tasks.find(t => t.n === n) ?? refuse(`#${g.id} 没有 T${n}`)

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
  if (t.mark === '~') return { write: [], message: `T${n} 已在进行中` }
  if (t.mark !== ' ') return refuse(`T${n} 已${t.mark === 'x' ? '完成' : '跳过'}`)
  const running = g.tasks.find(x => x.mark === '~')
  if (running) return refuse(`T${running.n} 还在进行中，同一时刻只能有一个 task 进行中`)
  return { write: [setMark(g, n, '~')], message: `#${id} T${n} 开始` }
}

export const finishTask = (pool: Pool, id: number, n: number): Outcome => {
  const g = requireActive(pool, id)
  if (isRefusal(g)) return g
  const t = findTask(g, n)
  if (isTaskRefusal(t)) return t
  if (t.mark !== '~') return refuse(`T${n} 不在进行中，先开始它`)
  const after = setMark(g, n, 'x')
  const left = after.tasks.filter(x => !isEnded(x)).length
  const tail = left === 0 ? '；全部 task 已结束，请对照验收标准汇报，由用户 /ms-done 确认' : `；还剩 ${left} 个`
  return { write: [after], message: `#${id} T${n} 完成${tail}` }
}

export const skipTask = (pool: Pool): Outcome => {
  const g = activeGoal(pool)
  if (!g) return refuse('没有执行中的目标')
  const t = nextTask(g)
  if (!t) return refuse(`#${g.id} 没有可跳过的 task`)
  return { write: [setMark(g, t.n, '-')], message: `#${g.id} T${t.n} 已跳过` }
}

export const addTask = (pool: Pool, id: number, title: string, acceptance: string): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.split !== 'tasks') return refuse(`#${id} 没有拆成 tasks`)
  if (g.status !== 'planned' && g.status !== 'active') return refuse(`#${id} 是「${STATUS_LABEL[g.status]}」，不能追加 task`)
  const bad = taskTextError(title, acceptance)
  if (bad) return refuse(bad)
  const n = g.tasks.length + 1
  return {
    write: [{ ...g, tasks: [...g.tasks, { n, mark: ' ', title: title.trim(), acceptance: acceptance.trim() }] }],
    message: `#${id} 追加 T${n}`,
  }
}

export const completeGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'done') return { write: [], message: `#${id} 已经完成` }
  if (g.status === 'dropped') return refuse(`#${id} 已放弃`)
  if (g.split === 'tasks') {
    const open = g.tasks.filter(t => !isEnded(t))
    if (open.length > 0) return refuse(`#${id} 还有未结束的 task：${open.map(t => `T${t.n}`).join('、')}`)
  }
  if (g.split === 'goals') {
    const open = childrenOf(pool, id).filter(c => c.status !== 'done' && c.status !== 'dropped')
    if (open.length > 0) return refuse(`#${id} 还有未结束的子目标：${open.map(c => `#${c.id}`).join('、')}`)
  }
  return { write: [{ ...g, status: 'done' }], message: `#${id} ${g.title} 完成` }
}

export const dropGoal = (pool: Pool, id: number): Outcome => {
  const g = find(pool, id)
  if (isRefusal(g)) return g
  if (g.status === 'done') return refuse(`#${id} 已完成，不能放弃`)
  if (g.status === 'dropped') return { write: [], message: `#${id} 已经是放弃` }
  const open = childrenOf(pool, id).filter(c => c.status !== 'done' && c.status !== 'dropped')
  const note = open.length > 0 ? `；子目标 ${open.map(c => `#${c.id}`).join('、')} 未处理` : ''
  return { write: [{ ...g, status: 'dropped' }], message: `#${id} 已放弃${note}` }
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

export const progressOf = (pool: Pool, g: Goal): string => {
  if (g.split === 'tasks') {
    const ended = g.tasks.filter(isEnded).length
    return `${ended}/${g.tasks.length}`
  }
  if (g.split === 'goals') {
    const kids = childrenOf(pool, g.id).filter(c => c.status !== 'dropped')
    return `${kids.filter(c => c.status === 'done').length}/${kids.length}`
  }
  return ''
}

/** Goals in tree order with their depth; children follow their parent, ids ascending. */
export const treeOrder = (pool: Pool): { goal: Goal; depth: number }[] => {
  const ids = new Set(pool.goals.map(g => g.id))
  const roots = pool.goals.filter(g => g.parent === null || !ids.has(g.parent))
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
  if (shown.length === 0 && pool.errors.length === 0) return '还没有目标。用 /ms-new <标题> 记下第一个。'
  const lines = shown.map(({ goal, depth }) => {
    const p = progressOf(pool, goal)
    return `${'  '.repeat(depth)}#${goal.id} ${goal.title} · ${STATUS_LABEL[goal.status]}${p ? ` · ${p}` : ''}`
  })
  const active = activeGoal(pool)
  if (active) {
    lines.push('', `执行中：#${active.id} ${active.title}`)
    for (const t of active.tasks) lines.push(`  [${t.mark}] T${t.n} ${t.title}`)
  }
  for (const e of pool.errors) lines.push(`无法解析 ${e.file}：${e.reason}`)
  return lines.join('\n')
}
