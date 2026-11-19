// Verify discovery, project state and the read-only panel through Codex.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as M from '../core/model.ts';
import packageInfo from './package.json' with { type: 'json' };

if (process.argv.includes('--execute') || process.argv.includes('--plan')) throw new Error('The 0.2 execution-loop verifier is retired. Run npm test for the 0.3 project workflow.');
const here = dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--hold') && !process.stdin.isTTY) {
  throw new Error('--hold requires an interactive terminal; omit it for an unattended check');
}
const source = await realpath(resolve(here, '..'));
const scratch = await mkdtemp(join(tmpdir(), 'milestone-codex-probe-'));
await mkdir(join(scratch, '.goals'));
await writeFile(join(scratch, '.milestone-probe.json'), JSON.stringify({ source }));
const original = new Map();
const pool = { goals: [], errors: [] };
for (const name of (await readdir(join(source, '.goals'))).filter(n => M.idOfFile(n) !== undefined)) {
  const text = await readFile(join(source, '.goals', name), 'utf8');
  original.set(name, text);
  await writeFile(join(scratch, '.goals', name), text);
  const goal = M.parseGoal(text, name);
  assert(!M.isError(goal), `${name} must parse`);
  pool.goals.push(goal);
}
const canonical = await readFile(join(source, '.goals', 'project.json'), 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (canonical !== null) {
  pool.goals = JSON.parse(canonical).goals;
  original.clear();
  original.set('project.json', canonical);
  for (const goal of pool.goals) await writeFile(join(scratch, '.goals', M.fileName(goal.id)), M.serializeGoal(goal));
}
// Add a disposable active goal; never reopen a completed project goal.
let state = pool;
const prepared = new Map();
function apply(outcome) {
  assert(!M.refused(outcome), JSON.stringify(outcome));
  state = M.applyChange(state, outcome.write);
  for (const goal of outcome.write) prepared.set(goal.id, goal);
}
const id = M.nextId(state);
apply(M.createGoal(state, { title: 'Codex MCP verification', today: '2026-11-16' }));
apply(M.planGoal(state, { id, today: '2026-11-16', split: 'tasks', acceptance: 'A test task starts through Codex MCP and the panel refreshes.', approach: 'Use an isolated copy; leave the original project unchanged.', tasks: [
  { title: 'Verify one task status update', acceptance: 'MCP start_task changes this mark from [ ] to [~].' },
  { title: 'Keep a pending task for inspection', acceptance: 'This task remains [ ].' },
] }));
apply(M.focusGoal(state, id));
for (const goal of prepared.values()) {
  await writeFile(join(scratch, '.goals', M.fileName(goal.id)), M.serializeGoal(goal));
}
if (process.argv.includes('--prepare-only')) {
  console.log(JSON.stringify({ source, scratch, fixtureGoal: id }));
  process.exit(0);
}

const config = `mcp_servers.milestone_probe={command=${JSON.stringify(process.execPath)},args=[${[join(here, 'server.mjs'), '--source', source, '--scratch', scratch].map(JSON.stringify).join(',')}]}`;
const installed = process.argv.includes('--inspect-installed');
const apps = installed || process.argv.includes('--apps');
const child = spawn('codex', ['app-server', ...(installed ? [] : ['-c', config])], { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
const waiting = new Map();
let sequence = 0;
const completedTurns = [];
const modelEvents = [];
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'turn/completed') completedTurns.push(message.params);
  if (message.method === 'item/completed') { const item = message.params?.item; modelEvents.push({ type: item?.type, tool: item?.tool ?? item?.name, text: item?.type === 'agentMessage' ? item.text : undefined }); }
  if (message.id !== undefined && waiting.has(message.id)) {
    const pending = waiting.get(message.id); waiting.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
  } else if (message.id !== undefined && message.method) {
    // Unexpected server requests must fail visibly; do not auto-approve prompts.
    child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Probe does not handle interactive requests' } }) + '\n');
  }
});
child.on('exit', code => {
  for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error(`Codex exited ${code}: ${stderr}`)); }
  waiting.clear();
});
function rpc(method, params) {
  const requestId = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(`Timed out: ${method}\n${stderr}`)); }, 45000);
    waiting.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
}
const stdin = createInterface({ input: process.stdin });
const commands = [];
let resume;
stdin.on('line', text => { if (resume) { const fn = resume; resume = undefined; fn(text); } else commands.push(text); });
const pause = () => commands.length ? Promise.resolve(commands.shift()) : new Promise(ok => { resume = ok; });
const report = { source, scratch, fixtureGoal: id, checks: [] };
const evidence = join(scratch, 'verification.json');
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'milestone_probe', version: '0.0.1' }, capabilities: { experimentalApi: true } });
  report.codex = initialized;
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/start', { cwd: scratch, ephemeral: true });
  const threadId = started.thread.id;
  // This ephemeral context only owns an MCP connection. No turn/start is sent.
  const inventory = await rpc('mcpServerStatus/list', { threadId, ...(installed ? {} : { serverName: 'milestone_probe' }) });
  const selected = inventory.data.find(s => installed ? s.pluginId === 'milestone-codex-probe@milestone-local-probe' : s.name === 'milestone_probe');
  assert(selected, `Milestone server must be present in the Codex inventory: ${JSON.stringify(inventory.data.filter(s => s.name.includes('milestone')).map(s => ({ name: s.name, pluginId: s.pluginId, runtimeStatus: s.runtimeStatus, toolsError: s.toolsError })))}`);
  assert.equal(selected.runtimeStatus, 'connected', JSON.stringify({ status: selected.runtimeStatus, error: selected.toolsError, diagnostic: stderr.split('\n').filter(line => /server\.mjs|MODULE_NOT_FOUND|test copy must|PLUGIN_ROOT/.test(line)).slice(-8) }));
  report.inventory = selected;
  console.log('Codex MCP inventory:', JSON.stringify({ name: selected.name, version: selected.serverInfo?.version, tools: Object.keys(selected.tools) }));
  async function call(tool, args = {}, expectError = false) {
    const response = await rpc('mcpServer/tool/call', { threadId, server: selected.name, tool, arguments: args });
    const data = response.result ?? response;
    if (expectError) { assert.equal(data.isError, true, JSON.stringify(data)); return data; }
    assert(!data.isError, JSON.stringify(data));
    return data.structuredContent ?? JSON.parse(data.content.find(c => c.type === 'text').text);
  }
  const dataset = installed ? 'project' : 'existing';
  const listed = await call('list_goals', { dataset });
  assert.equal(listed.goals.length, (installed ? state : pool).goals.length);
  assert.deepEqual(listed.errors, []);
  report.checks.push(`Codex MCP reads ${listed.goals.length} goals from the ${dataset} dataset`);
  if (apps) {
    const entrypoints = Object.values(selected.tools).flatMap(tool => tool._meta?.['openai/ui']?.entrypoints ?? []);
    assert.deepEqual(entrypoints, [{ type: 'thread' }]);
    const opener = selected.tools.open_app._meta;
    assert.deepEqual(opener['openai/ui'].entrypoints, [{ type: 'thread' }]);
    assert.equal(opener.ui.resourceUri, 'ui://milestone/panel.html');
    const panel = await rpc('mcpServer/resource/read', { threadId, server: selected.name, uri: opener.ui.resourceUri });
    assert.equal(panel.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert(!panel.contents[0].text.includes('id="next"'));
    assert(panel.contents[0].text.includes('id="progress"'));
    assert(!panel.contents[0].text.includes('/* APP_BUNDLE */'));
    await writeFile(join(scratch, 'mcp-app-resource.html'), panel.contents[0].text);
    const opened = await call('open_app');
    assert.equal(opened.project, await realpath(scratch));
    assert.equal(opened.version, packageInfo.version);
    if (installed) {
      assert.deepEqual(opened.test.errors, []);
      assert(selected.tools.report_task);
      assert(!selected.tools.control_run);
    } else {
      assert.equal(opened.existing.goals.length, pool.goals.length);
    }
    assert.equal(opened.test.goals.find(g => g.id === id && g.status === 'active').tasks[0].mark, ' ');
    report.checks.push('Codex discovers only the native thread entrypoint and reads its bundled MCP Apps UI', 'open_app accepts empty arguments and reads the selected project');
  }
  if (installed) {
    report.checks.push('Installed local plugin connects through its packaged MCP configuration');
    report.uiStatus = 'Desktop rendering and MCP Apps bridge remain unverified';
    await writeFile(evidence, JSON.stringify(report, null, 2));
    console.log('INSTALLED_PLUGIN_CONTRACT_VERIFIED', evidence);
  } else {
  const test = await call('list_goals', { dataset: 'test' });
  const opened = apps ? await call('open_app') : await call('open_panel');
  if (!apps) {
  report.url = opened.url;
  const before = await fetch(opened.url).then(r => r.text());
  assert(before.includes('[ ]</span> T1'));
  assert(before.includes('Existing project'));
  await writeFile(join(scratch, 'panel-before.html'), before);
  }
  await writeFile(evidence, JSON.stringify(report, null, 2));
  await writeFile('/tmp/milestone-codex-probe-latest.json', JSON.stringify({ ...report, evidence }, null, 2));
  console.log('PANEL_READY', JSON.stringify({ url: opened.url, scratch, evidence }));
  if (process.argv.includes('--hold')) { console.log('Send a newline to perform the MCP update.'); await pause(); }
  const updated = await call('start_task', { id, task: 1, revision: test.revision });
  assert.equal(updated.goals.find(g => g.id === id).tasks[0].mark, '~');
  assert.equal(updated.goals.find(g => g.id === id).tasks[1].mark, ' ');
  const disk = JSON.parse(await readFile(join(scratch, '.goals', 'project.json'), 'utf8'));
  assert.equal(disk.goals.find(g => g.id === id).tasks[0].mark, '~');
  if (apps) {
    const after = await call('read_panel');
    assert.equal(after.test.goals.find(g => g.id === id).tasks[0].mark, '~');
    await writeFile(join(scratch, 'app-state-after.json'), JSON.stringify(after, null, 2));
  } else {
    const after = await fetch(opened.url).then(r => r.text());
    assert(after.includes('[~]</span> T1'));
    await writeFile(join(scratch, 'panel-after.html'), after);
  }
  report.checks.push('Codex MCP start_task changes only test T1 from [ ] to [~]', 'Panel data tool returns the updated mark');
  const stale = await call('start_task', { id, task: 2, revision: test.revision }, true);
  assert(JSON.stringify(stale).includes('Conflict'));
  report.checks.push('Stale revision is rejected');
  const invalid = await call('start_task', { id, task: 2, revision: updated.revision }, true);
  assert(/assigned|still in progress/.test(JSON.stringify(invalid)));
  report.checks.push('Business rule rejects a second running task');
  if (!apps) {
  assert.equal(await fetch(opened.url.replace(/[^/]+$/, 'wrong-token')).then(r => r.status), 404);
  assert.equal(await fetch(opened.url, { method: 'POST' }).then(r => r.status), 404);
  report.checks.push('Panel rejects invalid token and HTTP writes');
  }
  for (const [name, text] of original) {
    assert.equal(await readFile(join(source, '.goals', name), 'utf8'), text);

  }
  report.sourceSha256 = createHash('sha256').update(JSON.stringify([...original].sort())).digest('hex');
  report.checks.push('All original goals remain byte-identical; copied goals are unchanged by the MCP update');
  await writeFile(evidence, JSON.stringify(report, null, 2));
  console.log('VERIFIED', JSON.stringify(report.checks));
  if (process.argv.includes('--hold')) { console.log('Panel remains live. Send a newline to stop.'); await pause(); }
  }
} catch (error) {
  report.failure = error.message;
  report.modelEvents = modelEvents;
  await writeFile(evidence, JSON.stringify(report, null, 2));
  throw error;
} finally {
  stdin.close(); lines.close(); child.kill('SIGTERM');
}
