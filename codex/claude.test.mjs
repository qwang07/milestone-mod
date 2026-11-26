import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlugin, skillFor } from './build.mjs';
import { panelView } from './view.mjs';

test('the Claude Code package bundles the shared server, skill and pane module', async () => {
  const out = await mkdtemp(join(tmpdir(), 'milestone-claude-'));
  try {
    await buildPlugin(out, undefined, 'claude');
    const manifest = JSON.parse(await readFile(join(out, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'milestone');
    assert.equal(manifest.types, './types/index.d.ts');
    const mcp = JSON.parse(await readFile(join(out, '.mcp.json'), 'utf8'));
    assert.deepEqual(mcp.mcpServers.milestone.args, ['${CLAUDE_PLUGIN_ROOT}/server.mjs', '--model-read-panel']);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'hooks', 'hooks.json'), 'utf8')), { modules: ['./register.tsx'] });
    assert.equal(await readFile(join(out, 'hooks', 'view.mjs'), 'utf8'), await readFile(new URL('./view.mjs', import.meta.url), 'utf8'));
    const skill = await readFile(join(out, 'skills', 'milestone', 'SKILL.md'), 'utf8');
    assert.match(skill, /`\/ms-panel`/);
    assert.doesNotMatch(skill, /More tools/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('only the Claude Code skill changes the panel lines', async () => {
  const skill = await readFile(new URL('./SKILL.md', import.meta.url), 'utf8');
  assert.equal(skillFor('codex', skill), skill);
  assert.equal(skillFor('antigravity', skill), skill);
  assert.notEqual(skillFor('claude', skill), skill);
  assert.throws(() => skillFor('claude', 'no panel lines'), /SKILL.md panel lines changed/);
});

test('the shared view model orders goals and labels task states', () => {
  const goal = (id, title, status, tasks = []) => ({ id, title, status, sections: [], tasks: tasks.map(([n, mark]) => ({ n, title: `T${n}`, acceptance: 'ok', mark })) });
  const view = panelView({
    projectName: 'demo',
    test: { goals: [goal(1, 'A', 'active', [[1, 'x'], [2, '~'], [3, ' ']]), goal(2, 'B', 'planned'), goal(3, 'C', 'done'), goal(4, 'D', 'dropped')], drafts: {}, errors: [] },
    run: null,
  });
  assert.equal(view.current.title, 'A');
  assert.deepEqual(view.current.tasks.map(t => t.state), ['已完成', '进行中', '待开始']);
  assert.equal(view.progress.text, '1 / 3');
  assert.deepEqual(view.others.map(g => g.title), ['B']);
  assert.equal(view.archive.summary, '已完成的目标  1 · 已取消 1');
});
