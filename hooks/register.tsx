import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Auto, Pool } from '../types'

import * as M from './model'
import { fileName, idOfFile, isError, parseGoal, serializeGoal } from './model'
import type { Goal } from './model'
import { paneTree } from './pane'

type $ = EngineInterface

const PANE = 'milestone'
const POLL_MS = 5000
const EMPTY_POOL: Pool = { goals: [], errors: [] }
const STEP: Auto = { remaining: 0, pending: null }

const poolAtom = atom({ plugin: 'milestone', key: 'pool' } as const, EMPTY_POOL)
const autoAtom = atom({ plugin: 'milestone', key: 'auto' } as const, STEP)
const projectAtom = atom({ plugin: 'milestone', key: 'project' } as const, '')

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
  if (idOfFile(name) === undefined) throw new Error(`milestone 只读写 .goals/<数字>.md，拒绝 ${name}`)
  const at = await goalsDir($)
  if (at === undefined) throw new Error('milestone：.goals/ 不在项目目录内，拒绝读写')
  const path = `${at.dir}/${name}`
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own !== undefined && (own.isLink || own.realPath !== path)) {
    throw new Error(`milestone：${name} 是链接或指向别处，拒绝读写`)
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
      pool.errors.push({ file: f.name, reason: '读取失败' })
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
      $.ui.toast(`milestone：提示没能提交（${err instanceof Error ? err.message : String(err)}）`, { timeoutMs: 8000 }),
    )
  })
}

const stopAuto = async ($: $, reason?: string) => {
  const was = await read($, autoAtom)
  await update($, autoAtom, () => STEP)
  if (reason !== undefined && (was.remaining !== 0 || was.pending !== null)) {
    $.ui.toast(`milestone auto 停下：${reason}`, { timeoutMs: 8000 })
  }
}

const prompts = {
  plan: (id: number) =>
    `[milestone] 找方案 #${id}\n按 milestone 技能处理：阅读 .goals/${id}.md，提出描述、验收标准、方案和拆解（子目标或 tasks，二选一）。这一阶段只读；用户明确确认后才调用 mcp__milestone__plan_goal。`,
  run: (id: number, n: number) =>
    `[milestone] 执行 #${id} T${n}\n按 milestone 技能处理：只做这一个 task。先 mcp__milestone__start_task，完成后对照验收自检，通过才 mcp__milestone__finish_task，然后汇报并结束本轮。`,
  add: (id: number, text: string) =>
    `[milestone] 追加 task #${id}：${text}\n按 milestone 技能处理：提出 task 标题与验收，等用户同意后才调用 mcp__milestone__add_task。`,
}

const parseTarget = (args: string, pool: Pool): number | M.Refusal => {
  if (args.trim() === '') {
    const a = M.activeGoal(pool)
    return a ? a.id : { error: '没有执行中的目标，请写目标编号，例如 12 或 #12' }
  }
  return M.parseRef(args) ?? { error: `看不懂目标编号「${args.trim()}」，请写 12 或 #12` }
}

const isNumber = (x: number | M.Refusal): x is number => typeof x === 'number'

const reply = (out: M.Outcome, extra = ''): { text: string } => ({
  text: M.refused(out) ? out.error : out.message + extra,
})

const readyHint = (pool: Pool, id: number): string => {
  const parent = M.parentReady(pool, id)
  return parent ? `\n#${parent.id} ${parent.title} 的子目标都已结束，可以 /ms-done ${parent.id}` : ''
}

const runNext = async ($: $, remaining: number): Promise<{ text: string }> => {
  const pool = await refresh($)
  const active = M.activeGoal(pool)
  if (!active) return { text: '没有执行中的目标，先 /ms-focus <目标>' }
  const t = M.nextTask(active)
  if (!t) return { text: `#${active.id} 的 task 已全部结束，可以 /ms-done 确认完成` }
  await update($, autoAtom, () => ({ remaining, pending: { goal: active.id, task: t.n } }))
  submit($, prompts.run(active.id, t.n))
  return { text: `开始 #${active.id} T${t.n} ${t.title}` }
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

const ID = { type: 'integer', minimum: 1, description: '目标编号，例如 12' }
const TASK_NO = { type: 'integer', minimum: 1, description: 'task 编号，例如 T2 写 2' }

const TOOLS = [
  {
    name: 'create_goal',
    description:
      '在项目目标池里新建一个目标（状态：想法）。用户提到一个新的问题、需求或目标时使用。可以用 parent 挂在已有目标下面。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一行标题' },
        description: { type: 'string', description: '可选：问题或目标的描述' },
        parent: { ...ID, description: '可选：父目标编号' },
      },
      required: ['title'],
    },
  },
  {
    name: 'plan_goal',
    description:
      '写入一个目标的方案并拆解，状态改为「已计划」。只在用户明确确认方案之后调用。split 二选一：tasks（给出 tasks）或 goals（给出子目标）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        description: { type: 'string' },
        acceptance: { type: 'string', description: '验收标准' },
        approach: { type: 'string', description: '方案' },
        decisions: { type: 'string', description: '已定决策' },
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
    name: 'start_task',
    description: '把执行中目标的一个 task 标为进行中。开始做这个 task 之前调用。',
    inputSchema: { type: 'object', properties: { id: ID, task: TASK_NO }, required: ['id', 'task'] },
  },
  {
    name: 'finish_task',
    description: '把进行中的 task 标为完成。只在对照验收标准自检通过之后调用；没通过就不要调用，直接向用户汇报。',
    inputSchema: { type: 'object', properties: { id: ID, task: TASK_NO }, required: ['id', 'task'] },
  },
  {
    name: 'add_task',
    description: '给一个已拆成 tasks 的目标追加一个 task。只在用户同意追加之后调用。',
    inputSchema: {
      type: 'object',
      properties: { id: ID, title: { type: 'string' }, acceptance: { type: 'string' } },
      required: ['id', 'title', 'acceptance'],
    },
  },
] as const

const COMMANDS = [
  { name: 'ms-new', description: '记一个想法', argumentHint: '<标题> [--under <目标>]' },
  { name: 'ms-plan', description: '请 Claude 为目标找方案并拆解', argumentHint: '<目标>' },
  { name: 'ms-focus', description: '设为执行中的目标', argumentHint: '<目标>' },
  { name: 'ms-next', description: '执行当前目标的下一个 task' },
  { name: 'ms-auto', description: '连续执行 task，失败即停', argumentHint: '[n|all]' },
  { name: 'ms-skip', description: '跳过当前 task' },
  { name: 'ms-add', description: '请 Claude 提议追加一个 task', argumentHint: '<描述>' },
  { name: 'ms-done', description: '确认目标完成', argumentHint: '[目标]' },
  { name: 'ms-drop', description: '放弃一个目标', argumentHint: '<目标>' },
  { name: 'ms-status', description: '目标池总览', immediate: true },
  { name: 'ms-panel', description: '打开 milestone 面板', immediate: true },
] as const

export const COMMAND_NAMES: readonly string[] = COMMANDS.map(c => c.name)

/** Once per session, where someone can see it: show the panel for the active goal. Never a prompt: it would cut into the conversation. */
const greet = ($: $, pool: Pool) => {
  const active = M.activeGoal(pool)
  if (!active) return
  void $.ui
    .open({ id: PANE, title: 'milestone' })
    .then(opened => {
      if (!opened.isPlaced) $.ui.toast(`milestone：#${active.id} 执行中，面板未自动显示，用 /ms-panel 打开`, { timeoutMs: 8000 })
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
    const m = /^(.*?)(?:\s+--under\s+(\S+))?\s*$/s.exec(e.args)
    const title = (m?.[1] ?? '').trim()
    const under = m?.[2]
    const parent = under === undefined ? undefined : M.parseRef(under)
    if (under !== undefined && parent === undefined) return { text: `看不懂目标编号「${under}」` }
    const day = await today($)
    return reply(await mutate($, pool => M.createGoal(pool, { title, parent, today: day })))
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-plan' }, async ($, e) => {
    const id = M.parseRef(e.args)
    if (id === undefined) return { text: '请写目标编号，例如 /ms-plan 12' }
    const out = await mutate($, pool => M.startPlanning(pool, id))
    if (!M.refused(out)) submit($, prompts.plan(id))
    return reply(out)
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-focus' }, async ($, e) => {
    const id = M.parseRef(e.args)
    if (id === undefined) return { text: '请写目标编号，例如 /ms-focus 12' }
    const out = await mutate($, pool => M.focusGoal(pool, id))
    if (!M.refused(out)) {
      await stopAuto($, '切换了执行中的目标')
      void $.ui.open({ id: PANE, title: 'milestone' })
    }
    return reply(out)
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-next' }, async $ => runNext($, 0)).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-auto' }, async ($, e) => {
    const arg = e.args.trim()
    const n = arg === '' || arg === 'all' ? -1 : /^[1-9][0-9]*$/.test(arg) ? Number(arg) : undefined
    if (n === undefined) return { text: '/ms-auto 后面写正整数或 all' }
    const out = await runNext($, n)
    void $.ui.open({ id: PANE, title: 'milestone' })
    return out
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-skip' }, async $ => reply(await mutate($, M.skipTask))).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-add' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') return { text: '请写要追加的 task，例如 /ms-add 补充单元测试' }
    const active = M.activeGoal(await refresh($))
    if (!active) return { text: '没有执行中的目标' }
    submit($, prompts.add(active.id, text))
    return { text: `请 Claude 为 #${active.id} 提议追加 task` }
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

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
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-drop' }, async ($, e) => {
    const id = M.parseRef(e.args)
    if (id === undefined) return { text: '请写目标编号，例如 /ms-drop 12' }
    const out = await mutate($, pool => M.dropGoal(pool, id))
    if (!M.refused(out)) await stopAuto($, `#${id} 已放弃`)
    return reply(out, M.refused(out) ? '' : readyHint(await read($, poolAtom), id))
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-status' }, async $ => ({ text: M.statusText(await refresh($)) })).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  on('command.run', { command: 'ms-panel' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'milestone' })
    return { text: opened.isPlaced ? '已打开 milestone 面板' : 'milestone 面板已就绪，界面当前没有位置显示它' }
  }).catch(() => ({ text: '命令出错，可用 claude --debug 查看原因' }))

  // ---- tools Claude calls ----

  on('tool.call', { tool: 'mcp__milestone__create_goal' }, async ($, e) => {
    const title = str(e, 'title')
    if (title === undefined) return { deny: 'title 必填' }
    const parent = e.parent === undefined ? undefined : int(e, 'parent')
    if (e.parent !== undefined && parent === undefined) return { deny: 'parent 不是有效的目标编号' }
    const day = await today($)
    return answer(await mutate($, pool => M.createGoal(pool, { title, parent, description: str(e, 'description'), today: day })))
  }).catch(() => ({ deny: 'milestone：工具内部出错，请告诉用户用 claude --debug 查看原因' }))

  on('tool.call', { tool: 'mcp__milestone__plan_goal' }, async ($, e) => {
    const id = int(e, 'id')
    const split = str(e, 'split')
    if (id === undefined) return { deny: 'id 不是有效的目标编号' }
    if (split !== 'tasks' && split !== 'goals') return { deny: 'split 只能是 tasks 或 goals' }
    const tasks = list(e, 'tasks', x => {
      const title = str(x, 'title')
      const acceptance = str(x, 'acceptance')
      return title === undefined || acceptance === undefined ? undefined : { title, acceptance }
    })
    const goals = list(e, 'goals', x => {
      const title = str(x, 'title')
      return title === undefined ? undefined : { title, description: str(x, 'description') }
    })
    if (e.tasks !== undefined && tasks === undefined) return { deny: 'tasks 每项需要 title 和 acceptance' }
    if (e.goals !== undefined && goals === undefined) return { deny: 'goals 每项需要 title' }
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
  }).catch(() => ({ deny: 'milestone：工具内部出错，请告诉用户用 claude --debug 查看原因' }))

  on('tool.call', { tool: 'mcp__milestone__start_task' }, async ($, e) => {
    const id = int(e, 'id')
    const n = int(e, 'task')
    if (id === undefined || n === undefined) return { deny: 'id 与 task 都要是正整数' }
    return answer(await mutate($, pool => M.startTask(pool, id, n)))
  }).catch(() => ({ deny: 'milestone：工具内部出错，请告诉用户用 claude --debug 查看原因' }))

  on('tool.call', { tool: 'mcp__milestone__finish_task' }, async ($, e) => {
    const id = int(e, 'id')
    const n = int(e, 'task')
    if (id === undefined || n === undefined) return { deny: 'id 与 task 都要是正整数' }
    return answer(await mutate($, pool => M.finishTask(pool, id, n)))
  }).catch(() => ({ deny: 'milestone：工具内部出错，请告诉用户用 claude --debug 查看原因' }))

  on('tool.call', { tool: 'mcp__milestone__add_task' }, async ($, e) => {
    const id = int(e, 'id')
    const title = str(e, 'title')
    const acceptance = str(e, 'acceptance')
    if (id === undefined || title === undefined || acceptance === undefined) return { deny: 'id、title、acceptance 都必填' }
    return answer(await mutate($, pool => M.addTask(pool, id, title, acceptance)))
  }).catch(() => ({ deny: 'milestone：工具内部出错，请告诉用户用 claude --debug 查看原因' }))

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
      await stopAuto($, e.reason === 'aborted' ? '这一轮被中断' : '这一轮出错')
      return next(e)
    }
    const pool = await refresh($)
    const goal = pool.goals.find(g => g.id === id)
    const t = goal?.tasks.find(x => x.n === n)
    if (!goal || goal.status !== 'active') {
      await stopAuto($, `#${id} 不再是执行中的目标`)
    } else if (t?.mark !== 'x') {
      await stopAuto($, `T${n} 没有完成`)
    } else {
      const remaining = auto.remaining < 0 ? -1 : auto.remaining - 1
      const following = M.nextTask(goal)
      if (!following) await stopAuto($, `#${id} 的 task 已全部结束，请对照验收标准确认后 /ms-done`)
      else if (remaining === 0) await stopAuto($, '次数用完')
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
    }
    return paneTree($.ui.resolve(e), data)
  })
}
