import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Auto, Pool } from '../types'

import * as M from './model'
import { fileName, idOfFile, isError, parseGoal, serializeGoal } from './model'
import type { Goal } from './model'
import { TREE, paneTree, treeRows } from './pane'

type $ = EngineInterface

const PANE = 'milestone'
const POLL_MS = 5000
const EMPTY_POOL: Pool = { goals: [], errors: [] }
const STEP: Auto = { remaining: 0, pending: null }

const poolAtom = atom({ plugin: 'milestone', key: 'pool' } as const, EMPTY_POOL)
const autoAtom = atom({ plugin: 'milestone', key: 'auto' } as const, STEP)
const projectAtom = atom({ plugin: 'milestone', key: 'project' } as const, '')
const treeFailedAtom = atom({ plugin: 'milestone', key: 'treeFailed' } as const, false)

// ---------- .goals/ on disk ----------
// Every path goes through `place`, which only ever answers <project root>/.goals/<digits>.md,
// judged by the resolved real path.

const GOALS_DIR = '.goals'

const trimSlash = (p: string): string => p.replace(/\/+$/, '')

/** The real path of .goals/, or undefined when it is missing or lands outside the project. */
const goalsDir = async ($: $): Promise<{ dir: string; exists: boolean } | undefined> => {
  const root = await $.session.root()
  const rootReal = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath
  if (rootReal === undefined) return undefined
  const base = trimSlash(rootReal)
  const stat = await $.fs.stat(`${base}/${GOALS_DIR}`, { resolve: true }).catch(() => undefined)
  if (stat === undefined) return { dir: `${base}/${GOALS_DIR}`, exists: false }
  if (stat.kind !== 'dir' || stat.realPath === undefined) return undefined
  const real = trimSlash(stat.realPath)
  if (real !== `${base}/${GOALS_DIR}` && !real.startsWith(`${base}/`)) return undefined
  return { dir: real, exists: true }
}

const place = async ($: $, name: string): Promise<string> => {
  if (idOfFile(name) === undefined) throw new Error(`milestone only reads and writes .goals/<digits>.md; refused ${name}`)
  const at = await goalsDir($)
  if (at === undefined) throw new Error('milestone: .goals/ is not inside the project; refused')
  const path = `${at.dir}/${name}`
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own !== undefined && (own.isLink || own.realPath !== path)) {
    throw new Error(`milestone: ${name} is a link or points elsewhere; refused`)
  }
  return path
}

type Listing = { name: string; mtimeMs: number }[]

const listGoalFiles = async ($: $): Promise<Listing> => {
  const at = await goalsDir($)
  if (at === undefined || !at.exists) return []
  const entries = await $.fs.list(at.dir)
  return entries
    .filter(e => e.kind === 'file' && !e.isLink && idOfFile(e.name) !== undefined)
    .map(e => ({ name: e.name, mtimeMs: e.mtimeMs }))
}

const readPool = async ($: $): Promise<Pool> => {
  const files = await listGoalFiles($)
  const pool: Pool = { goals: [], errors: [] }
  for (const f of files) {
    const text = await $.fs.read(await place($, f.name)).catch((err: unknown) => err)
    if (typeof text !== 'string') {
      pool.errors.push({ file: f.name, reason: 'read failed' })
      continue
    }
    const parsed = parseGoal(text, f.name)
    if (isError(parsed)) pool.errors.push(parsed)
    else pool.goals.push(parsed)
  }
  pool.goals.sort((a, b) => a.id - b.id)
  pool.errors.sort((a, b) => a.file.localeCompare(b.file))
  return pool
}

const writeGoals = async ($: $, goals: readonly Goal[]): Promise<void> => {
  for (const g of goals) await $.fs.write(await place($, fileName(g.id)), serializeGoal(g))
}

/** A fingerprint of .goals/ that changes when any goal file is added, removed or modified. */
const fingerprint = (files: Listing): string =>
  files.map(f => `${f.name}:${f.mtimeMs}`).sort().join('|')

// ---------- shared helpers ----------

const today = async ($: $): Promise<string> => {
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const refresh = async ($: $): Promise<Pool> => {
  const pool = await readPool($)
  await update($, poolAtom, () => pool)
  return pool
}

/** Reads the pool fresh from disk, applies one checked change, writes it and redraws. */
const mutate = async ($: $, change: (pool: Pool) => M.Outcome | Promise<M.Outcome>): Promise<M.Outcome> => {
  const pool = await readPool($)
  const out = await change(pool)
  if (M.refused(out)) {
    await update($, poolAtom, () => pool)
    return out
  }
  await writeGoals($, out.write)
  await update($, poolAtom, () => M.applyChange(pool, out.write))
  return out
}

/** Submits a prompt once the current dispatch is over: a command.run hook may not submit itself. */
const submit = ($: $, text: string) => {
  $.clock.after(0, () => {
    void $.prompt.submit({ text }).catch((err: unknown) =>
      $.ui.toast(`milestone: could not submit the prompt (${err instanceof Error ? err.message : String(err)})`, { timeoutMs: 8000 }),
    )
  })
}

const stopAuto = async ($: $, reason?: string) => {
  const was = await read($, autoAtom)
  await update($, autoAtom, () => STEP)
  if (reason !== undefined && (was.remaining !== 0 || was.pending !== null)) {
    $.ui.toast(`milestone auto stopped: ${reason}`, { timeoutMs: 8000 })
  }
}

const prompts = {
  plan: (id: number) =>
    `[milestone] plan #${id}\nFollow the milestone skill: read .goals/${id}.md and propose a description, acceptance criteria, an approach and a split (sub-goals or tasks, one of the two). This stage is read-only; call mcp__milestone__plan_goal only after the user clearly confirms.`,
  run: (id: number, n: number) =>
    `[milestone] run #${id} T${n}\nFollow the milestone skill: do this one task only. Call mcp__milestone__start_task first; when done, check it against its acceptance, call mcp__milestone__finish_task only if it passes, then report and end the turn.`,
  add: (id: number, text: string) =>
    `[milestone] add task #${id}: ${text}\nFollow the milestone skill: propose the task's title and acceptance, and call mcp__milestone__add_task only after the user agrees.`,
}

const parseTarget = (args: string, pool: Pool): number | M.Refusal => {
  if (args.trim() === '') {
    const a = M.activeGoal(pool)
    return a ? a.id : { error: 'No active goal; name one by number or part of its title' }
  }
  return M.resolveRef(pool, args)
}

/** The goal a command names, by number or part of its title. */
const pick = async ($: $, args: string, command: string): Promise<number | M.Refusal> =>
  args.trim() === ''
    ? { error: `Name a goal, e.g. /${command} 12 or /${command} part of its title` }
    : M.resolveRef(await readPool($), args)

const isNumber = (x: number | M.Refusal): x is number => typeof x === 'number'

const reply = (out: M.Outcome, extra = ''): { text: string } => ({
  text: M.refused(out) ? out.error : out.message + extra,
})

const readyHint = (pool: Pool, id: number): string => {
  const parent = M.parentReady(pool, id)
  return parent ? `\nAll sub-goals of ${parent.title} have ended; /ms-done ${parent.title} completes it` : ''
}

const FAILED = { text: 'The command failed; run claude --debug to see why' }
const TOOL_FAILED = { deny: 'milestone: the tool failed internally; tell the user to run claude --debug to see why' }

const runNext = async ($: $, remaining: number): Promise<{ text: string }> => {
  const pool = await refresh($)
  const active = M.activeGoal(pool)
  if (!active) return { text: 'No active goal; /ms-focus <goal> first' }
  const t = M.nextTask(active)
  if (!t) return { text: `#${active.id} has no task left` }
  await update($, autoAtom, () => ({ remaining, pending: { goal: active.id, task: t.n } }))
  submit($, prompts.run(active.id, t.n))
  return { text: `Starting #${active.id} T${t.n} ${t.title}` }
}

/** /ms-focus and focus_goal: make a goal active, stop any auto run, show the panel. */
const focus = async ($: $, id: number): Promise<M.Outcome> => {
  const out = await mutate($, pool => M.focusGoal(pool, id))
  if (!M.refused(out)) {
    await stopAuto($, 'the active goal changed')
    void $.ui.open({ id: PANE, title: 'milestone' })
  }
  return out
}

// ---------- tool inputs ----------

type Input = Readonly<Record<string, unknown>>

const str = (e: Input, k: string): string | undefined => (typeof e[k] === 'string' ? (e[k] as string) : undefined)
const int = (e: Input, k: string): number | undefined => {
  const v = e[k]
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
  if (typeof v === 'string') return M.parseRef(v)
  return undefined
}
const list = <T,>(e: Input, k: string, pick: (x: Input) => T | undefined): T[] | undefined => {
  const v = e[k]
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return undefined
  const out: T[] = []
  for (const x of v) {
    const one = typeof x === 'object' && x !== null ? pick(x as Input) : undefined
    if (one === undefined) return undefined
    out.push(one)
  }
  return out
}

const answer = (out: M.Outcome) => (M.refused(out) ? { deny: out.error } : { result: out.message })

const ID = { type: 'integer', minimum: 1, description: 'Goal number, e.g. 12' }
const TASK_NO = { type: 'integer', minimum: 1, description: 'Task number, e.g. 2 for T2' }

const TOOLS = [
  {
    name: 'create_goal',
    description:
      "Records a new goal in the project's goal pool (status: idea). Use it when the user brings up a new problem, need or goal. `parent` puts it under an existing goal.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'One-line title' },
        description: { type: 'string', description: 'Optional: the problem or goal' },
        parent: { ...ID, description: 'Optional: the parent goal number' },
      },
      required: ['title'],
    },
  },
  {
    name: 'plan_goal',
    description:
      'Writes a goal\'s plan and split, and sets it to planned. Call only after the user clearly confirms the plan. `split` is one of: tasks (give `tasks`) or goals (give `goals`).',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        description: { type: 'string' },
        acceptance: { type: 'string', description: 'Acceptance criteria' },
        approach: { type: 'string', description: 'Approach' },
        decisions: { type: 'string', description: 'Decisions made' },
        split: { type: 'string', enum: ['tasks', 'goals'] },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, acceptance: { type: 'string' } },
            required: ['title', 'acceptance'],
          },
        },
        goals: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, description: { type: 'string' } },
            required: ['title'],
          },
        },
      },
      required: ['id', 'acceptance', 'approach', 'split'],
    },
  },
  {
    name: 'focus_goal',
    description:
      'Makes a planned goal that is split into tasks the active goal; the previously active goal goes back to planned and any auto run stops. Call only when the user clearly asks to start or switch to a goal; never switch on your own.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] },
  },
  {
    name: 'start_task',
    description: "Marks one of the active goal's tasks in progress. Call it before starting the task.",
    inputSchema: { type: 'object', properties: { id: ID, task: TASK_NO }, required: ['id', 'task'] },
  },
  {
    name: 'finish_task',
    description:
      "Marks the task in progress done. Call only after checking it against its acceptance and passing; if it fails, don't call it and report to the user. Finishing the last task completes the whole goal, so for the last task also check the goal's acceptance criteria first.",
    inputSchema: { type: 'object', properties: { id: ID, task: TASK_NO }, required: ['id', 'task'] },
  },
  {
    name: 'move_goal',
    description:
      'Moves a goal among its siblings (the goals under the same parent): before `before`, or to the end when `before` is left out. Call when the user asks to reorder goals.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, before: { ...ID, description: 'Optional: the sibling to move it in front of' } },
      required: ['id'],
    },
  },
  {
    name: 'add_task',
    description: 'Adds a task to a goal split into tasks. Call only after the user agrees to add it.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, title: { type: 'string' }, acceptance: { type: 'string' } },
      required: ['id', 'title', 'acceptance'],
    },
  },
] as const

const COMMANDS = [
  { name: 'ms-new', description: 'Record an idea', argumentHint: '<title> [--under <goal>]' },
  { name: 'ms-plan', description: 'Ask Claude to plan and split a goal', argumentHint: '<goal>' },
  { name: 'ms-focus', description: 'Make a goal the active one', argumentHint: '<goal>' },
  { name: 'ms-next', description: "Run the active goal's next task" },
  { name: 'ms-auto', description: 'Run tasks one after another, stopping at the first failure', argumentHint: '[n|all]' },
  { name: 'ms-skip', description: 'Skip the current task' },
  { name: 'ms-add', description: 'Ask Claude to propose a new task', argumentHint: '<description>' },
  { name: 'ms-done', description: 'Complete a goal', argumentHint: '[goal]' },
  { name: 'ms-drop', description: 'Drop a goal', argumentHint: '<goal>' },
  { name: 'ms-status', description: 'Overview of the goal pool', immediate: true },
  { name: 'ms-panel', description: 'Open the milestone panel', immediate: true },
] as const

export const COMMAND_NAMES: readonly string[] = COMMANDS.map(c => c.name)

/** Once per session, where someone can see it: show the panel for the active goal. Never a prompt: it would cut into the conversation. */
const greet = ($: $, pool: Pool) => {
  const active = M.activeGoal(pool)
  if (!active) return
  void $.ui
    .open({ id: PANE, title: 'milestone' })
    .then(opened => {
      if (!opened.isPlaced) $.ui.toast(`milestone: ${active.title} is active; the panel did not open on its own, use /ms-panel`, { timeoutMs: 8000 })
    })
    .catch(() => undefined)
}

// ---------- the module ----------

export const register: Register = on => {
  let awaitingSurface = false

  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) await $.command.register(c)
    for (const t of TOOLS) await $.tool.register({ ...t, isDeferred: false })

    const root = await $.session.root()
    await update($, projectAtom, () => root.replace(/\/+$/, '').split('/').pop() ?? '')
    const pool = await refresh($)

    let seen = fingerprint(await listGoalFiles($).catch(() => []))
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const now = fingerprint(await listGoalFiles($))
        if (now !== seen) {
          seen = now
          await refresh($)
        }
      })().catch(() => undefined)
    })

    // A -p run draws nowhere: hold the panel for the first surface that attaches.
    if (e.isInteractive || (await $.session.surfaces()).length > 0) greet($, pool)
    else awaitingSurface = true
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (awaitingSurface) {
      awaitingSurface = false
      greet($, await refresh($))
    }
    return next(e)
  })

  // ---- commands ----

  on('command.run', { command: 'ms-new' }, async ($, e) => {
    const m = /^(.*?)(?:\s+--under\s+(.+?))?\s*$/s.exec(e.args)
    const title = (m?.[1] ?? '').trim()
    const under = m?.[2]
    const day = await today($)
    return reply(
      await mutate($, pool => {
        const parent = under === undefined ? undefined : M.resolveRef(pool, under)
        if (parent !== undefined && !isNumber(parent)) return parent
        return M.createGoal(pool, { title, parent, today: day })
      }),
    )
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-plan' }, async ($, e) => {
    const id = await pick($, e.args, 'ms-plan')
    if (!isNumber(id)) return reply(id)
    const out = await mutate($, pool => M.startPlanning(pool, id))
    if (!M.refused(out)) submit($, prompts.plan(id))
    return reply(out)
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-focus' }, async ($, e) => {
    const id = await pick($, e.args, 'ms-focus')
    if (!isNumber(id)) return reply(id)
    return reply(await focus($, id))
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-next' }, async $ => runNext($, 0)).catch(() => FAILED)

  on('command.run', { command: 'ms-auto' }, async ($, e) => {
    const arg = e.args.trim()
    const n = arg === '' || arg === 'all' ? -1 : /^[1-9][0-9]*$/.test(arg) ? Number(arg) : undefined
    if (n === undefined) return { text: '/ms-auto takes a positive integer or all' }
    const out = await runNext($, n)
    void $.ui.open({ id: PANE, title: 'milestone' })
    return out
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-skip' }, async $ => {
    const out = await mutate($, M.skipTask)
    if (M.refused(out)) return reply(out)
    const ended = out.write.find(g => g.status === 'done')
    if (ended) await stopAuto($)
    return reply(out, ended ? readyHint(await read($, poolAtom), ended.id) : '')
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-add' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') return { text: 'Describe the task, e.g. /ms-add add unit tests' }
    const active = M.activeGoal(await refresh($))
    if (!active) return { text: 'No active goal' }
    submit($, prompts.add(active.id, text))
    return { text: `Asked Claude to propose a task for #${active.id}` }
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-done' }, async ($, e) => {
    let target = 0
    const out = await mutate($, pool => {
      const id = parseTarget(e.args, pool)
      if (!isNumber(id)) return id
      target = id
      return M.completeGoal(pool, id)
    })
    if (M.refused(out)) return reply(out)
    if (out.write.some(g => g.status === 'done')) await stopAuto($)
    return reply(out, readyHint(await read($, poolAtom), target))
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-drop' }, async ($, e) => {
    const id = await pick($, e.args, 'ms-drop')
    if (!isNumber(id)) return reply(id)
    const out = await mutate($, pool => M.dropGoal(pool, id))
    if (!M.refused(out)) await stopAuto($, `${out.write[0]?.title ?? 'a goal'} was dropped`)
    return reply(out, M.refused(out) ? '' : readyHint(await read($, poolAtom), id))
  }).catch(() => FAILED)

  on('command.run', { command: 'ms-status' }, async $ => ({ text: M.statusText(await refresh($)) })).catch(() => FAILED)

  on('command.run', { command: 'ms-panel' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'milestone' })
    return { text: opened.isPlaced ? 'Opened the milestone panel' : 'The milestone panel is ready, but the interface has no room to show it now' }
  }).catch(() => FAILED)

  // ---- tools Claude calls ----

  on('tool.call', { tool: 'mcp__milestone__create_goal' }, async ($, e) => {
    const title = str(e, 'title')
    if (title === undefined) return { deny: 'title is required' }
    const parent = e.parent === undefined ? undefined : int(e, 'parent')
    if (e.parent !== undefined && parent === undefined) return { deny: 'parent is not a valid goal number' }
    const day = await today($)
    return answer(await mutate($, pool => M.createGoal(pool, { title, parent, description: str(e, 'description'), today: day })))
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__plan_goal' }, async ($, e) => {
    const id = int(e, 'id')
    const split = str(e, 'split')
    if (id === undefined) return { deny: 'id is not a valid goal number' }
    if (split !== 'tasks' && split !== 'goals') return { deny: 'split must be tasks or goals' }
    const tasks = list(e, 'tasks', x => {
      const title = str(x, 'title')
      const acceptance = str(x, 'acceptance')
      return title === undefined || acceptance === undefined ? undefined : { title, acceptance }
    })
    const goals = list(e, 'goals', x => {
      const title = str(x, 'title')
      return title === undefined ? undefined : { title, description: str(x, 'description') }
    })
    if (e.tasks !== undefined && tasks === undefined) return { deny: 'each task needs a title and an acceptance' }
    if (e.goals !== undefined && goals === undefined) return { deny: 'each goal needs a title' }
    const day = await today($)
    return answer(
      await mutate($, pool =>
        M.planGoal(pool, {
          id,
          split,
          description: str(e, 'description'),
          acceptance: str(e, 'acceptance') ?? '',
          approach: str(e, 'approach') ?? '',
          decisions: str(e, 'decisions'),
          tasks,
          goals,
          today: day,
        }),
      ),
    )
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__focus_goal' }, async ($, e) => {
    const id = int(e, 'id')
    if (id === undefined) return { deny: 'id is not a valid goal number' }
    return answer(await focus($, id))
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__start_task' }, async ($, e) => {
    const id = int(e, 'id')
    const n = int(e, 'task')
    if (id === undefined || n === undefined) return { deny: 'id and task must both be positive integers' }
    return answer(await mutate($, pool => M.startTask(pool, id, n)))
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__finish_task' }, async ($, e) => {
    const id = int(e, 'id')
    const n = int(e, 'task')
    if (id === undefined || n === undefined) return { deny: 'id and task must both be positive integers' }
    const out = await mutate($, pool => M.finishTask(pool, id, n))
    if (M.refused(out) || !out.write.some(g => g.status === 'done')) return answer(out)
    return { result: out.message + readyHint(await read($, poolAtom), id) }
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__move_goal' }, async ($, e) => {
    const id = int(e, 'id')
    const before = e.before === undefined ? undefined : int(e, 'before')
    if (id === undefined) return { deny: 'id is not a valid goal number' }
    if (e.before !== undefined && before === undefined) return { deny: 'before is not a valid goal number' }
    return answer(await mutate($, pool => M.moveGoal(pool, id, before)))
  }).catch(() => TOOL_FAILED)

  on('tool.call', { tool: 'mcp__milestone__add_task' }, async ($, e) => {
    const id = int(e, 'id')
    const title = str(e, 'title')
    const acceptance = str(e, 'acceptance')
    if (id === undefined || title === undefined || acceptance === undefined) return { deny: 'id, title and acceptance are all required' }
    return answer(await mutate($, pool => M.addTask(pool, id, title, acceptance)))
  }).catch(() => TOOL_FAILED)

  // ---- auto mode ----

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const auto = await read($, autoAtom)
    if (auto.pending === null) return next(e)
    const { goal: id, task: n } = auto.pending
    const isAuto = auto.remaining !== 0
    await update($, autoAtom, () => ({ ...auto, pending: null }))
    if (!isAuto) return next(e)

    if (e.reason !== 'answer') {
      await stopAuto($, e.reason === 'aborted' ? 'the turn was interrupted' : 'the turn failed')
      return next(e)
    }
    const pool = await refresh($)
    const goal = pool.goals.find(g => g.id === id)
    const t = goal?.tasks.find(x => x.n === n)
    if (goal?.status === 'done') {
      await stopAuto($, `all tasks of ${goal.title} ended; the goal is done`)
    } else if (!goal || goal.status !== 'active') {
      await stopAuto($, `${goal?.title ?? 'the goal'} is no longer the active goal`)
    } else if (t?.mark !== 'x') {
      await stopAuto($, `T${n} was not finished`)
    } else {
      const remaining = auto.remaining < 0 ? -1 : auto.remaining - 1
      const following = M.nextTask(goal)
      if (!following) await stopAuto($, `${goal.title} has no task left`)
      else if (remaining === 0) await stopAuto($, 'no runs left')
      else {
        await update($, autoAtom, () => ({ remaining, pending: { goal: id, task: following.n } }))
        submit($, prompts.run(id, following.n))
      }
    }
    return next(e)
  })

  // ---- the panel ----

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = {
      pool: await read($, poolAtom),
      auto: await read($, autoAtom),
      project: await read($, projectAtom),
      canDrag: !(await read($, treeFailedAtom)),
    }
    return paneTree($.ui.resolve(e), e.surface, data)
  })

  // A drop in the tree: the Client posts { move, before }, checked here like any tool input.
  on('ui.message', { element: TREE }, async ($, e, next) => {
    const d = (typeof e.data === 'object' && e.data !== null ? e.data : {}) as Input
    const id = int(d, 'move')
    const before = d.before === null ? undefined : int(d, 'before')
    if (id === undefined || (d.before !== null && before === undefined)) return next(e)
    const out = await mutate($, pool => M.moveGoal(pool, id, before))
    if (M.refused(out)) $.ui.toast(`milestone: ${out.error}`, { timeoutMs: 8000 })
    return { props: { rows: treeRows(await read($, poolAtom)) } }
  })

  on('ui.fault', { element: TREE }, async ($, e, next) => {
    await update($, treeFailedAtom, () => true)
    return next(e)
  })
}
