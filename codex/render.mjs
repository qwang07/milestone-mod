// Pure display adapter: no tool calls, execution actions or conversation messages.
import { panelView } from './view.mjs';

export function renderPanel(document, data) {
  const $ = selector => document.querySelector(selector);
  const view = panelView(data);
  $('#project-name').textContent = view.projectName;
  document.title = view.projectName;
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const expanded = new Map([...document.querySelectorAll('details[data-key]')].map(d => [d.dataset.key, d.open]));
  function details(key, summary, body) {
    const d = document.createElement('details'); d.dataset.key = key; d.open = expanded.get(key) ?? false;
    const s = document.createElement('summary'); s.append(...summary); d.append(s, body); return d;
  }
  const goalBody = g => text('div', g.details.join('\n\n'), 'detail-body');
  function tasks(g) {
    return g.tasks.map(t => {
      const row = document.createElement('li');
      if (t.isCurrent) row.className = 'current';
      else if (t.isFinished) row.className = 'finished';
      const body = text('div', t.acceptance, 'detail-body');
      body.append(...t.notes.map(note => text('p', note)));
      row.append(details(t.key, [text('span', t.icon, 'task-icon'), text('span', t.title, 'task-title'), text('span', t.state, 'task-state')], body));
      return row;
    });
  }
  const goal = view.current;
  $('#active').textContent = goal?.title ?? view.emptyTitle;
  $('#current-label').textContent = goal?.label ?? '当前目标';
  $('#acceptance').replaceChildren(...(goal ? [...goalBody(goal).childNodes] : [text('p', view.emptyHint)]));
  $('#goal-status').textContent = goal?.state ?? '';
  $('#progress-text').textContent = view.progress?.text ?? '';
  $('#progress').hidden = !view.progress; $('#progress').max = view.progress?.total || 1; $('#progress').value = view.progress?.done ?? 0;
  $('#tasks').replaceChildren(...(goal ? tasks(goal) : []));
  $('#reason').hidden = !view.reason; $('#reason').textContent = view.reason;
  function goalRow(g) {
    const row = document.createElement('li'); row.className = 'goal-row';
    const body = goalBody(g); const list = document.createElement('ul'); list.append(...tasks(g)); body.append(list);
    row.append(details(g.key, [text('span', g.title, 'goal-title'), text('span', g.state, 'task-state')], body)); return row;
  }
  $('#other-section').hidden = !view.others.length; $('#goals').replaceChildren(...view.others.map(goalRow));
  $('#archive').hidden = !view.archive.goals.length;
  $('#archive-count').textContent = view.archive.summary;
  $('#archived-goals').replaceChildren(...view.archive.goals.map(goalRow));
  $('#errors').textContent = view.errors.join('\n');
}
