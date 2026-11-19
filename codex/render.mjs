// Pure display adapter: no tool calls, execution actions or conversation messages.
export function renderPanel(document, data) {
  const $ = selector => document.querySelector(selector);
  const projectName = data.projectName || (data.source || data.project || data.scratch || '').split(/[\\/]/).filter(Boolean).at(-1) || '项目';
  $('#project-name').textContent = projectName;
  document.title = projectName;
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const expanded = new Map([...document.querySelectorAll('details[data-key]')].map(d => [d.dataset.key, d.open]));
  const pool = data.test, run = data.run;
  const labels = { idea: '待规划', planning: '规划中', planned: '待开始', active: '进行中', done: '已完成', dropped: '已取消' };
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
    return labels[g.status];
  }
  function details(key, summary, body) {
    const d = document.createElement('details'); d.dataset.key = key; d.open = expanded.get(key) ?? false;
    const s = document.createElement('summary'); s.append(...summary); d.append(s, body); return d;
  }
  function goalBody(g) {
    const draft = pool.drafts?.[g.id];
    const lines = (draft ? [['待确认方案', draft.approach], ['目标验收', draft.acceptance]] : g.sections.map(s => [({ Description: '目标', Acceptance: '目标验收', Approach: '方案', Decisions: '约定' })[s.heading] ?? s.heading, s.body])).filter(([,v]) => v).map(([k,v]) => `${k}：${v}`);
    const goalReceipt = run?.receipts?.findLast(r => r.goal === g.id && r.task === undefined);
    if (goalReceipt) lines.push(`验收结果：${goalReceipt.evidence}`);
    if (draft) lines.push(...draft.tasks.map(t => `待确认任务：${t.title}\n验收：${t.acceptance}`));
    return text('div', lines.join('\n\n'), 'detail-body');
  }
  function tasks(g) {
    return g.tasks.map(t => {
      const assigned = run?.goal === g.id && run?.task === t.n && !['stopped'].includes(run.status);
      const update = run?.updates?.[`${g.id}:${t.n}`];
      const state = t.mark === 'x' ? '已完成' : t.mark === '-' ? '已取消' : assigned && run.status === 'blocked' ? '受阻' : assigned && run.status === 'paused' ? '已暂停' : t.mark === '~' ? '进行中' : update?.status === 'blocked' ? '受阻' : update?.status === 'paused' ? '已暂停' : '待开始';
      const icon = t.mark === 'x' ? '✓' : t.mark === '-' ? '–' : state === '进行中' ? '◉' : state === '受阻' ? '!' : '•';
      const row = document.createElement('li');
      if (state === '进行中') row.className = 'current';
      else if (t.mark === 'x' || t.mark === '-') row.className = 'finished';
      const body = text('div', `验收：${t.acceptance}`, 'detail-body');
      const receipt = run?.receipts?.findLast(r => r.goal === g.id && r.task === t.n);
      if (receipt) body.append(text('p', receipt.summary), text('p', receipt.evidence));
      if (assigned && run.reason) body.append(text('p', run.reason));
      else if (update?.reason && t.mark === ' ') body.append(text('p', update.reason));
      row.append(details(`task:${g.id}:${t.n}`, [text('span', icon, 'task-icon'), text('span', t.title, 'task-title'), text('span', state, 'task-state')], body));
      return row;
    });
  }
  $('#active').textContent = goal?.title ?? '暂无项目目标';
  $('#current-label').textContent = goal?.status === 'done' ? '已完成目标' : '当前目标';
  $('#acceptance').replaceChildren(...(goal ? [...goalBody(goal).childNodes] : [text('p', '在对话中确定项目目标和计划')]));
  $('#goal-status').textContent = goal ? status(goal) : '';
  const completed = goal?.tasks.filter(t => t.mark === 'x').length ?? 0;
  $('#progress-text').textContent = goal?.tasks.length ? `${completed} / ${goal.tasks.length}` : '';
  $('#progress').hidden = !goal?.tasks.length; $('#progress').max = goal?.tasks.length || 1; $('#progress').value = completed;
  $('#tasks').replaceChildren(...(goal ? tasks(goal) : []));
  const reason = goal?.id === run?.goal && ['blocked', 'paused'].includes(run?.status) ? run.reason : goal?.tasks.filter(t => t.mark === ' ').map(t => run?.updates?.[`${goal.id}:${t.n}`]?.reason).find(Boolean) ?? '';
  $('#reason').hidden = !reason; $('#reason').textContent = reason;
  function goalRow(g) {
    const row = document.createElement('li'); row.className = 'goal-row';
    const body = goalBody(g); const list = document.createElement('ul'); list.append(...tasks(g)); body.append(list);
    row.append(details(`goal:${g.id}`, [text('span', g.title, 'goal-title'), text('span', status(g), 'task-state')], body)); return row;
  }
  const others = goals.filter(g => g.id !== goal?.id && !['done', 'dropped'].includes(g.status));
  $('#other-section').hidden = !others.length; $('#goals').replaceChildren(...others.map(goalRow));
  const archived = pool.goals.filter(g => ['done', 'dropped'].includes(g.status));
  $('#archive').hidden = !archived.length;
  $('#archive-count').textContent = `已完成的目标  ${archived.filter(g => g.status === 'done').length}${archived.some(g => g.status === 'dropped') ? ` · 已取消 ${archived.filter(g => g.status === 'dropped').length}` : ''}`;
  $('#archived-goals').replaceChildren(...archived.map(goalRow));
  $('#errors').textContent = pool.errors.map(e => `${e.file}: ${e.reason}`).join('\n');
}
