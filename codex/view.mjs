// Pure panel view model shared by every host: no DOM, Node or tool calls.
// The Codex/Antigravity HTML panel (render.mjs) and the Claude Code pane both draw from it.
const LABELS = { idea: '待规划', planning: '规划中', planned: '待开始', active: '进行中', done: '已完成', dropped: '已取消' };
const SECTION_NAMES = { Description: '目标', Acceptance: '目标验收', Approach: '方案', Decisions: '约定' };

export function panelView(data) {
  const projectName = data.projectName || (data.source || data.project || data.scratch || '').split(/[\\/]/).filter(Boolean).at(-1) || '项目';
  const pool = data.test, run = data.run;
  const goals = pool.rows?.map(row => pool.goals.find(g => g.id === row.id)).filter(Boolean) ?? pool.goals;
  const goal = goals.find(g => g.status === 'active') ?? goals.find(g => !['done', 'dropped'].includes(g.status)) ?? goals.find(g => g.id === run?.goal);

  function status(g) {
    if (pool.drafts?.[g.id]) return '待确认';
    if (g.id === run?.goal && g.status !== 'done') {
      if (run.status === 'blocked') return '受阻';
      if (run.status === 'paused') return '已暂停';
    }
    if (g.status !== 'done') {
      const pending = g.tasks.filter(t => t.mark === ' ');
      if (pending.some(t => run?.updates?.[`${g.id}:${t.n}`]?.status === 'blocked')) return '受阻';
      if (pending.some(t => run?.updates?.[`${g.id}:${t.n}`]?.status === 'paused')) return '已暂停';
    }
    return LABELS[g.status];
  }
  function details(g) {
    const draft = pool.drafts?.[g.id];
    const lines = (draft ? [['待确认方案', draft.approach], ['目标验收', draft.acceptance]] : g.sections.map(s => [SECTION_NAMES[s.heading] ?? s.heading, s.body]))
      .filter(([, v]) => v).map(([k, v]) => `${k}：${v}`);
    const goalReceipt = run?.receipts?.findLast(r => r.goal === g.id && r.task === undefined);
    if (goalReceipt) lines.push(`验收结果：${goalReceipt.evidence}`);
    if (draft) lines.push(...draft.tasks.map(t => `待确认任务：${t.title}\n验收：${t.acceptance}`));
    return lines;
  }
  function tasks(g) {
    return g.tasks.map(t => {
      const assigned = run?.goal === g.id && run?.task === t.n && !['stopped'].includes(run.status);
      const update = run?.updates?.[`${g.id}:${t.n}`];
      const state = t.mark === 'x' ? '已完成' : t.mark === '-' ? '已取消' : assigned && run.status === 'blocked' ? '受阻' : assigned && run.status === 'paused' ? '已暂停' : t.mark === '~' ? '进行中' : update?.status === 'blocked' ? '受阻' : update?.status === 'paused' ? '已暂停' : '待开始';
      const icon = t.mark === 'x' ? '✓' : t.mark === '-' ? '–' : state === '进行中' ? '◉' : state === '受阻' ? '!' : '•';
      const notes = [];
      const receipt = run?.receipts?.findLast(r => r.goal === g.id && r.task === t.n);
      if (receipt) notes.push(receipt.summary, receipt.evidence);
      if (assigned && run.reason) notes.push(run.reason);
      else if (update?.reason && t.mark === ' ') notes.push(update.reason);
      return { key: `task:${g.id}:${t.n}`, icon, title: t.title, state, isCurrent: state === '进行中', isFinished: t.mark === 'x' || t.mark === '-', acceptance: `验收：${t.acceptance}`, notes };
    });
  }
  const goalView = g => ({ key: `goal:${g.id}`, id: g.id, title: g.title, state: status(g), details: details(g), tasks: tasks(g) });

  const completed = goal?.tasks.filter(t => t.mark === 'x').length ?? 0;
  const reason = goal?.id === run?.goal && ['blocked', 'paused'].includes(run?.status) ? run.reason : goal?.tasks.filter(t => t.mark === ' ').map(t => run?.updates?.[`${goal.id}:${t.n}`]?.reason).find(Boolean) ?? '';
  const archived = pool.goals.filter(g => ['done', 'dropped'].includes(g.status));
  const doneCount = archived.filter(g => g.status === 'done').length, droppedCount = archived.filter(g => g.status === 'dropped').length;
  return {
    projectName,
    current: goal ? { ...goalView(goal), label: goal.status === 'done' ? '已完成目标' : '当前目标' } : null,
    emptyTitle: '暂无项目目标',
    emptyHint: '在对话中确定项目目标和计划',
    progress: goal?.tasks.length ? { done: completed, total: goal.tasks.length, text: `${completed} / ${goal.tasks.length}` } : null,
    reason: reason || '',
    others: goals.filter(g => g.id !== goal?.id && !['done', 'dropped'].includes(g.status)).map(goalView),
    archive: { summary: `已完成的目标  ${doneCount}${droppedCount ? ` · 已取消 ${droppedCount}` : ''}`, goals: archived.map(goalView) },
    errors: pool.errors.map(e => `${e.file}: ${e.reason}`),
  };
}
