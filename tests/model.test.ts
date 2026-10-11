import { describe, expect, test } from 'claude-code/testing'

import * as M from '../hooks/model'
import type { Goal, Pool } from '../types'

const goal = (over: Partial<Goal> & { id: number }): Goal => ({
  title: `目标 ${over.id}`,
  status: 'idea',
  parent: null,
  split: '',
  created: '2026-10-11',
  sections: [],
  tasks: [],
  ...over,
})

const pool = (...goals: Goal[]): Pool => ({ goals, errors: [] })

const tasks = (marks: string) =>
  [...marks].map((m, i) => ({ n: i + 1, mark: m as ' ' | '~' | 'x' | '-', title: `做第 ${i + 1} 步`, acceptance: `第 ${i + 1} 步可检验` }))

const ok = (o: M.Outcome): M.Change => {
  if (M.refused(o)) throw new Error(`expected a change, got refusal: ${o.error}`)
  return o
}
const no = (o: M.Outcome): string => {
  if (!M.refused(o)) throw new Error(`expected a refusal, got: ${o.message}`)
  return o.error
}

describe('goal files', () => {
  test('serialize then parse gives the same goal back', () => {
    const g = goal({
      id: 12,
      title: 'CSV 导出',
      status: 'active',
      parent: 3,
      split: 'tasks',
      sections: [
        { heading: '描述', body: '导出订单' },
        { heading: '验收标准', body: '10 万行 3 秒内\nExcel 不乱码' },
        { heading: '方案', body: '流式写出' },
        { heading: '已定决策', body: '' },
      ],
      tasks: tasks('x~ '),
    })
    const text = M.serializeGoal(g)
    expect(text).toContain('- [~] T2 | 做第 2 步 | 验收: 第 2 步可检验')
    expect(M.parseGoal(text, '12.md')).toEqual(g)
  })

  test('the file layout matches the README', () => {
    const text = M.serializeGoal(goal({ id: 1, split: 'tasks', tasks: tasks(' ') }))
    expect(text).toBe(
      [
        '---',
        'id: 1',
        'title: 目标 1',
        'status: idea',
        'parent: ',
        'split: tasks',
        'created: 2026-10-11',
        '---',
        '## 描述',
        '## 验收标准',
        '## 方案',
        '## 已定决策',
        '## Tasks',
        '- [ ] T1 | 做第 1 步 | 验收: 第 1 步可检验',
        '',
      ].join('\n'),
    )
  })

  test('sections the person added by hand are kept', () => {
    const text = M.serializeGoal(goal({ id: 2 })) + '## 备注\n手写的内容\n'
    const parsed = M.parseGoal(text, '2.md')
    if (M.isError(parsed)) throw new Error(parsed.reason)
    expect(M.serializeGoal(parsed)).toContain('## 备注\n手写的内容')
  })

  test('broken files are reported with a reason', () => {
    const base = M.serializeGoal(goal({ id: 5, split: 'tasks', tasks: tasks('  ') }))
    const cases: [string, string, RegExp][] = [
      ['5.md', 'no frontmatter', /第一行/],
      ['6.md', base, /文件名/],
      ['5.md', base.replace('status: idea', 'status: open'), /status/],
      ['5.md', base.replace('T2 |', 'T3 |'), /不连续/],
      ['5.md', base.replace('- [ ] T1', '- [~] T1').replace('- [ ] T2', '- [~] T2'), /多个进行中/],
      ['5.md', base.replace('- [ ] T1 | 做第 1 步 | 验收: 第 1 步可检验', 'T1 随便写'), /不是 task 行/],
    ]
    for (const [file, text, reason] of cases) {
      const r = M.parseGoal(text, file)
      expect(M.isError(r)).toBe(true)
      if (M.isError(r)) expect(r.reason).toMatch(reason)
    }
  })

  test('refs accept 12 and #12 only', () => {
    expect(M.parseRef('12')).toBe(12)
    expect(M.parseRef(' #7 ')).toBe(7)
    expect(M.parseRef('0')).toBeUndefined()
    expect(M.parseRef('abc')).toBeUndefined()
  })
})

describe('rules', () => {
  test('new goals take the next id and start as ideas', () => {
    const c = ok(M.createGoal(pool(goal({ id: 3 }), goal({ id: 9 })), { title: '性能问题', today: '2026-10-11' }))
    expect(c.write[0]).toMatchObject({ id: 10, status: 'idea', parent: null })
  })

  test('a child under an unsplit goal makes the parent split into goals', () => {
    const c = ok(M.createGoal(pool(goal({ id: 1 })), { title: '子', parent: 1, today: 'd' }))
    expect(c.write.map(g => [g.id, g.split, g.parent])).toEqual([
      [2, '', 1],
      [1, 'goals', null],
    ])
  })

  test('no children under a goal split into tasks', () => {
    expect(no(M.createGoal(pool(goal({ id: 1, split: 'tasks' })), { title: '子', parent: 1, today: 'd' }))).toMatch(/tasks/)
  })

  test('planning into tasks writes sections and numbered tasks', () => {
    const c = ok(
      M.planGoal(pool(goal({ id: 4, status: 'planning' })), {
        id: 4,
        acceptance: '能导出',
        approach: '流式',
        split: 'tasks',
        tasks: [
          { title: '字段', acceptance: '字段确认' },
          { title: '写出', acceptance: '内存稳定' },
        ],
        today: 'd',
      }),
    )
    const g = c.write[0]
    expect(g?.status).toBe('planned')
    expect(g?.tasks.map(t => `${t.mark}T${t.n}`)).toEqual([' T1', ' T2'])
    expect(g && M.sectionBody(g, '验收标准')).toBe('能导出')
  })

  test('planning into goals creates idea children with consecutive ids', () => {
    const c = ok(
      M.planGoal(pool(goal({ id: 4 }), goal({ id: 6 })), {
        id: 4,
        acceptance: 'a',
        approach: 'b',
        split: 'goals',
        goals: [{ title: '甲' }, { title: '乙' }],
        today: 'd',
      }),
    )
    expect(c.write.map(g => [g.id, g.parent, g.status])).toEqual([
      [4, null, 'planned'],
      [7, 4, 'idea'],
      [8, 4, 'idea'],
    ])
  })

  test('split is either tasks or goals, never both', () => {
    const p = pool(goal({ id: 1, split: 'goals' }), goal({ id: 2, parent: 1 }))
    expect(
      no(M.planGoal(p, { id: 1, acceptance: 'a', approach: 'b', split: 'tasks', tasks: [{ title: 't', acceptance: 'a' }], today: 'd' })),
    ).toMatch(/子目标/)
  })

  test('only planned task goals can be focused; the old active goes back to planned', () => {
    const p = pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks(' ') }), goal({ id: 2, status: 'planned', split: 'tasks', tasks: tasks(' ') }))
    const c = ok(M.focusGoal(p, 2))
    expect(c.write.map(g => [g.id, g.status])).toEqual([
      [2, 'active'],
      [1, 'planned'],
    ])
    expect(no(M.focusGoal(pool(goal({ id: 3, status: 'planned', split: 'goals' })), 3))).toMatch(/子目标/)
    expect(no(M.focusGoal(pool(goal({ id: 3 })), 3))).toMatch(/已计划/)
  })

  test('one task in progress at a time', () => {
    const p = pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('~ ') }))
    expect(no(M.startTask(p, 1, 2))).toMatch(/T1 还在进行中/)
  })

  test('a task finishes only from in progress', () => {
    const p = pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks(' ~') }))
    expect(no(M.finishTask(p, 1, 1))).toMatch(/不在进行中/)
    const c = ok(M.finishTask(p, 1, 2))
    expect(c.write[0]?.tasks.map(t => t.mark).join('')).toBe(' x')
  })

  test('finishing the last task says so', () => {
    const p = pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('x-~') }))
    expect(ok(M.finishTask(p, 1, 3)).message).toMatch(/全部 task 已结束/)
  })

  test('tasks only move on the active goal', () => {
    expect(no(M.startTask(pool(goal({ id: 1, status: 'planned', split: 'tasks', tasks: tasks(' ') })), 1, 1))).toMatch(/不是执行中/)
  })

  test('skip picks the in-progress task first, then the first pending one', () => {
    expect(ok(M.skipTask(pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks(' ~') })))).message).toMatch(/T2/)
    expect(ok(M.skipTask(pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('x  ') })))).message).toMatch(/T2/)
  })

  test('added tasks continue the numbering', () => {
    const c = ok(M.addTask(pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('xx') })), 1, '补测试', '测试通过'))
    expect(c.write[0]?.tasks.at(-1)).toEqual({ n: 3, mark: ' ', title: '补测试', acceptance: '测试通过' })
    expect(no(M.addTask(pool(goal({ id: 1, status: 'active', split: 'tasks' })), 1, 'a | 验收: b', 'c'))).toMatch(/验收/)
  })

  test('done waits for every task or child to end', () => {
    expect(no(M.completeGoal(pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('x ') })), 1))).toMatch(/T2/)
    expect(ok(M.completeGoal(pool(goal({ id: 1, status: 'active', split: 'tasks', tasks: tasks('x-') })), 1)).write[0]?.status).toBe('done')
    const p = pool(goal({ id: 1, split: 'goals', status: 'planned' }), goal({ id: 2, parent: 1, status: 'done' }), goal({ id: 3, parent: 1, status: 'planned' }))
    expect(no(M.completeGoal(p, 1))).toMatch(/#3/)
  })

  test('a parent is ready once all its children ended', () => {
    const p = pool(goal({ id: 1, split: 'goals', status: 'planned' }), goal({ id: 2, parent: 1, status: 'done' }), goal({ id: 3, parent: 1, status: 'dropped' }))
    expect(M.parentReady(p, 3)?.id).toBe(1)
  })

  test('broken files block changes to that goal', () => {
    const p: Pool = { goals: [], errors: [{ file: '4.md', reason: 'status 无效' }] }
    expect(no(M.focusGoal(p, 4))).toMatch(/无法解析/)
  })

  test('the tree puts children under their parent', () => {
    const p = pool(goal({ id: 1, split: 'goals' }), goal({ id: 2 }), goal({ id: 3, parent: 1 }))
    expect(M.treeOrder(p).map(x => [x.goal.id, x.depth])).toEqual([
      [1, 0],
      [3, 1],
      [2, 0],
    ])
  })
})
