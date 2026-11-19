import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ProjectStore } from '../storage/project.mjs';
import * as M from '../core/model.ts';

async function connect(project) {
  const client = new Client({ name: 'milestone-workflow-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--project', project] }));
  const call = async (name, args = {}, error) => {
    const response = await client.callTool({ name, arguments: args });
    if (error) { assert(response.isError, JSON.stringify(response)); assert.match(JSON.stringify(response), error); return response; }
    assert(!response.isError, JSON.stringify(response));
    return response.structuredContent;
  };
  return { client, call, state: () => call('list_goals', { dataset: 'test' }) };
}

test('project assignments record evidence without scheduling conversation work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-project-'));
  const a = await connect(root), b = await connect(root);
  try {
    const tools = (await a.client.listTools()).tools.map(t => t.name);
    assert(!tools.includes('control_run'));
    assert(tools.includes('report_task'));
    const metadata = (await a.client.listTools()).tools;
    for (const name of ['manage_goal', 'start_task', 'report_task', 'finish_task']) assert.deepEqual(metadata.find(t => t.name === name)._meta.ui.visibility, ['model']);
    for (const name of ['manage_goal', 'start_task', 'report_task', 'finish_task']) assert.equal(metadata.find(t => t.name === name)._meta.ui.resourceUri, metadata.find(t => t.name === 'open_app')._meta.ui.resourceUri);
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Deliver report', revision: state.revision });
    assert.deepEqual(state.panelEvent, { type: 'project-changed', project: await realpath(root), revision: state.revision });
    state = await a.call('manage_goal', { action: 'propose', id: 1, revision: state.revision, acceptance: 'Report accepted', approach: 'Two deliverables', tasks: [{ title: 'Data prepared', acceptance: 'Data checked' }, { title: 'Report delivered', acceptance: 'Report checked' }] });
    state = await a.call('manage_goal', { action: 'plan', id: 1, draftId: state.drafts[1].id, revision: state.revision, confirmed: true });
    state = await a.call('manage_goal', { action: 'focus', id: 1, revision: state.revision });
    state = await a.call('start_task', { id: 1, task: 1, revision: state.revision });
    const first = state.run.id;
    assert.equal(state.prompt, undefined);
    await b.call('start_task', { id: 1, task: 1, revision: state.revision }, /assigned/);
    await b.call('finish_task', { id: 1, task: 1, runId: first, revision: state.revision, summary: 'Wrong session', evidence: 'None' }, /owning executor/);
    state = await a.call('finish_task', { id: 1, task: 1, runId: first, revision: state.revision, summary: 'Data prepared', evidence: 'Data checked' });
    assert.equal(state.run.status, 'stopped');
    assert.equal(state.prompt, undefined);
    assert.equal(state.goals[0].tasks[1].mark, ' ');
    await a.call('finish_task', { id: 1, task: 1, runId: first, revision: state.revision, summary: 'Duplicate', evidence: 'Duplicate' }, /ticket is stale/);
    state = await b.call('start_task', { id: 1, task: 2, revision: state.revision });
    const finish = { id: 1, task: 2, runId: state.run.id, revision: state.revision, summary: 'Report delivered', evidence: 'Report checked' };
    await b.call('finish_task', finish, /goal acceptance/);
    state = await b.call('finish_task', { ...finish, goalAcceptanceChecked: true });
    assert.equal(state.goals[0].status, 'done');
    assert.equal(state.run.receipts.length, 2);
    assert.equal(state.run.owner, undefined);
  } finally { await a.client.close(); await b.client.close(); }
});

test('draft review preserves Markdown until confirmation and rejects stale proposals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-plan-review-'));
  const a = await connect(root), b = await connect(root);
  try {
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Review this plan', revision: state.revision });
    const path = join(root, '.goals', 'project.json');
    const before = JSON.parse(await readFile(path, 'utf8')).goals;
    const proposal = { action: 'propose', id: 1, revision: state.revision, acceptance: 'Output checked', approach: 'First approach', tasks: [{ title: 'Create output', acceptance: 'Read output and check contents' }] };
    state = await a.call('manage_goal', proposal);
    const first = state.drafts[1].id;
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).goals, before);
    assert.equal((await b.state()).drafts[1].id, first);
    await b.call('manage_goal', proposal, /draft changed/);
    await a.call('manage_goal', { action: 'plan', id: 1, draftId: first, revision: state.revision }, /Confirm/);
    await a.call('manage_goal', { ...proposal, action: 'plan', confirmed: true }, /provide its draftId/);
    state = await b.call('manage_goal', { ...proposal, draftId: first, approach: 'Reviewed approach' });
    const current = state.drafts[1].id;
    assert.notEqual(first, current);
    await a.call('manage_goal', { action: 'plan', id: 1, draftId: first, revision: state.revision, confirmed: true }, /draft has changed/);
    state = await a.call('manage_goal', { action: 'plan', id: 1, draftId: current, revision: state.revision, confirmed: true });
    assert.equal(state.goals[0].status, 'planned');
    assert.equal(state.goals[0].sections.find(s => s.heading === 'Approach').body, 'Reviewed approach');
    assert.deepEqual(state.drafts, {});
    assert.equal(JSON.parse(await readFile(path, 'utf8')).goals[0].status, 'planned');
  } finally { await a.client.close(); await b.client.close(); }
});

test('confirmation rejects a draft after the goal changes, and starting rejects a switched active goal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-plan-conflict-'));
  const a = await connect(root);
  try {
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Original goal', revision: state.revision });
    state = await a.call('manage_goal', { action: 'propose', id: 1, revision: state.revision, acceptance: 'Checked', approach: 'Test', tasks: [{ title: 'One', acceptance: 'Checked one' }] });
    const draftId = state.drafts[1].id;
    const path = join(root, '.goals', 'project.json');
    const edited = JSON.parse(await readFile(path, 'utf8'));
    edited.goals[0].title = 'Edited goal';
    await writeFile(path, JSON.stringify(edited));
    state = await a.state();
    await a.call('manage_goal', { action: 'plan', id: 1, draftId, confirmed: true, revision: state.revision }, /goal changed/);
    state = await a.call('manage_goal', { action: 'propose', id: 1, draftId, revision: state.revision, acceptance: 'Checked', approach: 'Revised', tasks: [{ title: 'One', acceptance: 'Checked one' }] });
    state = await a.call('manage_goal', { action: 'plan', id: 1, draftId: state.drafts[1].id, confirmed: true, revision: state.revision });
    state = await a.call('manage_goal', { action: 'focus', id: 1, revision: state.revision });
    await a.call('start_task', { id: 2, task: 1, revision: state.revision }, /no goal/);
    assert.equal((await a.state()).run.status, 'stopped');
  } finally { await a.client.close(); }
});

test('blocked work and paused handoffs preserve history and require explicit recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-handoff-'));
  const a = await connect(root), b = await connect(root);
  try {
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Handoff', revision: state.revision });
    state = await a.call('manage_goal', { action: 'plan', id: 1, revision: state.revision, confirmed: true, acceptance: 'Checked', approach: 'Test', tasks: [{ title: 'One', acceptance: 'Checked' }] });
    state = await a.call('manage_goal', { action: 'focus', id: 1, revision: state.revision });
    state = await a.call('start_task', { id: 1, task: 1, revision: state.revision });
    const old = state.run.id;
    await b.call('report_task', { action: 'block', id: 1, task: 1, runId: old, revision: state.revision, reason: 'Not mine' }, /owning conversation/);
    state = await a.call('report_task', { action: 'block', id: 1, task: 1, runId: old, revision: state.revision, reason: 'Missing source data' });
    assert.equal(state.run.status, 'blocked');
    assert.equal(state.goals[0].tasks[0].mark, ' ');
    const resume = { action: 'resume', id: 1, task: 1, runId: old, revision: state.revision, reason: 'Previous conversation stopped; source data supplied' };
    await b.call('report_task', resume, /explicit confirmation/);
    state = await b.call('report_task', { ...resume, confirmed: true });
    assert.notEqual(state.run.id, old);
    await a.call('finish_task', { id: 1, task: 1, runId: old, revision: state.revision, summary: 'Stale', evidence: 'Stale' }, /ticket is stale/);
    state = await b.call('report_task', { action: 'pause', id: 1, task: 1, runId: state.run.id, revision: state.revision, reason: 'Continue tomorrow' });
    assert.equal(state.run.status, 'paused');
  } finally { await a.client.close(); await b.client.close(); }
});

test('plan revision preserves completed identities, requires reviewed draft and cancellation does not complete a goal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-revision-'));
  const a = await connect(root);
  try {
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Revise', revision: state.revision });
    state = await a.call('manage_goal', { action: 'plan', id: 1, revision: state.revision, confirmed: true, acceptance: 'Checked', approach: 'Test', tasks: [{ title: 'One', acceptance: 'One checked' }, { title: 'Two', acceptance: 'Two checked' }] });
    state = await a.call('manage_goal', { action: 'focus', id: 1, revision: state.revision });
    state = await a.call('start_task', { id: 1, task: 1, revision: state.revision });
    state = await a.call('finish_task', { id: 1, task: 1, runId: state.run.id, revision: state.revision, summary: 'One done', evidence: 'One checked' });
    const proposal = { action: 'propose', id: 1, revision: state.revision, acceptance: 'New acceptance', approach: 'Revised', tasks: [{ n: 1, title: 'One', acceptance: 'One checked' }, { n: 2, title: 'Better two', acceptance: 'Better check' }] };
    await a.call('manage_goal', { ...proposal, tasks: [{ n: 1, title: 'Changed history', acceptance: 'One checked' }, proposal.tasks[1]] }, /cannot be rewritten/);
    await a.call('manage_goal', { ...proposal, tasks: [...proposal.tasks].reverse() }, /existing task order/);
    state = await a.call('manage_goal', proposal);
    assert.equal(state.goals[0].tasks[1].title, 'Two');
    state = await a.call('manage_goal', { action: 'plan', id: 1, draftId: state.drafts[1].id, confirmed: true, revision: state.revision });
    assert.equal(state.goals[0].tasks[0].mark, 'x');
    assert.equal(state.goals[0].tasks[1].title, 'Better two');
    assert.equal(state.run.receipts.length, 1);
    state = await a.call('manage_goal', { action: 'skip', id: 1, task: 2, confirmed: true, revision: state.revision });
    assert.equal(state.goals[0].status, 'active');
    await a.call('manage_goal', { action: 'done', id: 1, confirmed: true, revision: state.revision }, /goal acceptance/);
    state = await a.call('manage_goal', { action: 'done', id: 1, confirmed: true, goalAcceptanceChecked: true, evidence: 'Revised goal independently verified', revision: state.revision });
    assert.equal(state.goals[0].status, 'done');
    assert.equal(state.run.receipts.at(-1).evidence, 'Revised goal independently verified');
  } finally { await a.client.close(); }
});

test('project obstacles survive work on another deliverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milestone-obstacles-'));
  const a = await connect(root);
  try {
    let state = await a.state();
    state = await a.call('manage_goal', { action: 'create', title: 'Parallel context', revision: state.revision });
    state = await a.call('manage_goal', { action: 'plan', id: 1, revision: state.revision, confirmed: true, acceptance: 'Both checked', approach: 'Independent deliverables', tasks: [{ title: 'One', acceptance: 'One checked' }, { title: 'Two', acceptance: 'Two checked' }] });
    state = await a.call('manage_goal', { action: 'focus', id: 1, revision: state.revision });
    state = await a.call('start_task', { id: 1, task: 1, revision: state.revision });
    state = await a.call('report_task', { action: 'block', id: 1, task: 1, runId: state.run.id, revision: state.revision, reason: 'Waiting for source' });
    state = await a.call('start_task', { id: 1, task: 2, revision: state.revision });
    state = await a.call('finish_task', { id: 1, task: 2, runId: state.run.id, revision: state.revision, summary: 'Two done', evidence: 'Two checked' });
    assert.equal(state.run.updates['1:1'].reason, 'Waiting for source');
    assert.equal(state.goals[0].status, 'active');
    state = await a.call('manage_goal', { action: 'propose', id: 1, revision: state.revision, acceptance: 'All checked', approach: 'Include another deliverable', tasks: [{ n: 1, title: 'One', acceptance: 'One checked' }, { n: 2, title: 'Two', acceptance: 'Two checked' }, { title: 'Three', acceptance: 'Three checked' }] });
    state = await a.call('manage_goal', { action: 'plan', id: 1, draftId: state.drafts[1].id, confirmed: true, revision: state.revision });
    assert.deepEqual(state.goals[0].tasks.map(t => t.n), [1, 2, 3]);
    assert.equal(state.goals[0].tasks[1].mark, 'x');
    assert.deepEqual((await a.state()).errors, []);
  } finally { await a.client.close(); }
});

test('migration replays a pending legacy transaction and keeps original bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'milestone-migrate-')));
  const store = new ProjectStore(root);
  await mkdir(store.goals);
  await mkdir(store.runtime);
  const [goal] = M.createGoal({ goals: [], errors: [] }, { title: 'Review recovery', today: '2026-11-18' }).write;
  const markdown = M.serializeGoal(goal);
  await writeFile(join(store.goals, '1.md'), markdown);
  await writeFile(join(store.runtime, 'transaction.json'), JSON.stringify({ version: 1, entries: [
    { name: 'run.json', before: null, after: '{"status":"paused"}' },
    { name: 'drafts.json', before: null, after: '{"1":{"id":"pending"}}' },
  ] }));
  const state = await store.snapshot();
  assert.equal(state.run.status, 'paused');
  assert.equal(state.drafts[1].id, 'pending');
  assert.deepEqual(state.goals, [M.parseGoal(markdown, '1.md')]);
  assert.equal(await readFile(join(store.runtime, 'before-project-json', '1.md'), 'utf8'), markdown);
  assert.deepEqual((await readdir(store.goals)).sort(), ['progress.milestone', 'project.json']);
  assert.deepEqual(await store.snapshot(), state);
  const linked = await realpath(await mkdtemp(join(tmpdir(), 'milestone-linked-')));
  await symlink(store.runtime, join(linked, '.milestone-runtime'));
  await assert.rejects(() => new ProjectStore(linked).snapshot(), /linked directory/);
});

test('migration refuses a conflicting legacy journal before changing any input', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'milestone-migration-conflict-')));
  const store = new ProjectStore(root);
  await mkdir(store.goals);
  await mkdir(store.runtime);
  await writeFile(join(store.runtime, 'drafts.json'), '{"external":true}');
  await writeFile(join(store.runtime, 'transaction.json'), JSON.stringify({ version: 1, entries: [
    { name: 'run.json', before: null, after: '{"status":"paused"}' },
    { name: 'drafts.json', before: '{}', after: '{"1":{}}' },
  ] }));
  await assert.rejects(() => store.snapshot(), /external edit/);
  await assert.rejects(() => readFile(store.projectFile), { code: 'ENOENT' });
  await assert.rejects(() => readFile(join(store.runtime, 'run.json')), { code: 'ENOENT' });
});
