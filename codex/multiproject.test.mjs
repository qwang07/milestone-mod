import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildPlugin } from './build.mjs';

const serverFile = fileURLToPath(new URL('./server.mjs', import.meta.url));
const modelTools = ['list_goals', 'manage_goal', 'start_task', 'finish_task', 'report_task', 'open_app', 'open_panel'];

async function connect(args = [], cwd) {
  const client = new Client({ name: 'milestone-multiproject-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverFile, ...args], ...(cwd ? { cwd } : {}) }));
  const call = async (name, toolArgs = {}, error) => {
    const response = await client.callTool({ name, arguments: toolArgs });
    if (error) {
      assert(response.isError, JSON.stringify(response));
      assert.match(JSON.stringify(response), error);
      return response;
    }
    assert(!response.isError, JSON.stringify(response));
    return response.structuredContent;
  };
  return { client, call };
}

test('multi-project mode does no startup disk I/O, requires project, and validates paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'milestone-mp-cwd-'));
  const projectA = await realpath(await mkdtemp(join(tmpdir(), 'milestone-mp-a-')));
  const regularFile = join(projectA, 'note.txt');
  await writeFile(regularFile, 'hello');
  const linkA = join(cwd, 'link-a');
  await symlink(projectA, linkA);
  const { client, call } = await connect([], cwd);
  try {
    assert.deepEqual(await readdir(cwd), ['link-a'], 'Startup must not create .goals or .milestone-runtime in cwd');
    const { tools } = await client.listTools();
    for (const name of modelTools) {
      const tool = tools.find(t => t.name === name);
      assert(tool, `Expected tool ${name}`);
      assert(tool.inputSchema?.required?.includes('project'), `${name} must require project in multi-project mode`);
    }
    await call('list_goals', { dataset: 'project' }, /project|Required|expected string/i);
    await call('open_app', {}, /project|Required|expected string/i);
    await call('open_panel', {}, /project|Required|expected string/i);
    await call('read_panel', {}, /project is required/);
    await call('wait_panel', { after: '00000000-0000-4000-8000-000000000000' }, /project is required/);

    const badPaths = [
      '.',
      'relative/path',
      join(projectA, 'does-not-exist'),
      regularFile,
      `${projectA}\0bad`,
      `${projectA}/../${basename(projectA)}`,
      parse(projectA).root,
    ];
    for (const bad of badPaths) {
      await call('list_goals', { dataset: 'project', project: bad }, /absolute|exist|directory|traversal|filesystem root/i);
    }

    const viaLink = await call('list_goals', { dataset: 'project', project: linkA });
    const created = await call('manage_goal', { action: 'create', title: 'Canonical cache', revision: viaLink.revision, project: linkA });
    assert.equal(created.panelEvent.project, projectA);
    const viaReal = await call('list_goals', { dataset: 'project', project: projectA });
    assert.equal(viaReal.revision, created.revision);
    assert.equal(viaReal.goals[0].title, 'Canonical cache');
    assert.deepEqual(await readdir(cwd), ['link-a'], 'cwd remains untouched after operating on another project');
  } finally {
    await client.close();
  }
});

test('multi-project mode isolates state, watchers, SSE streams, wait_panel, subscriptions, and panels', { timeout: 20000 }, async () => {
  const projectA = await realpath(await mkdtemp(join(tmpdir(), 'milestone-iso-a-')));
  const projectB = await realpath(await mkdtemp(join(tmpdir(), 'milestone-iso-b-')));
  const { client, call } = await connect([]);
  const notices = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, n => notices.push(n.params.uri));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    let stateA = await call('list_goals', { dataset: 'project', project: projectA });
    let stateB = await call('list_goals', { dataset: 'project', project: projectB });
    stateA = await call('manage_goal', { action: 'create', title: 'Alpha goal', revision: stateA.revision, project: projectA });
    stateA = await call('manage_goal', { action: 'plan', id: 1, revision: stateA.revision, confirmed: true, acceptance: 'Alpha done', approach: 'A', tasks: [{ title: 'Alpha task', acceptance: 'Check A' }], project: projectA });
    stateA = await call('manage_goal', { action: 'focus', id: 1, revision: stateA.revision, project: projectA });

    stateB = await call('manage_goal', { action: 'create', title: 'Beta goal', revision: stateB.revision, project: projectB });
    stateB = await call('manage_goal', { action: 'plan', id: 1, revision: stateB.revision, confirmed: true, acceptance: 'Beta done', approach: 'B', tasks: [{ title: 'Beta task', acceptance: 'Check B' }], project: projectB });
    stateB = await call('manage_goal', { action: 'focus', id: 1, revision: stateB.revision, project: projectB });

    const appA = await call('open_app', { project: projectA });
    const appB = await call('open_app', { project: projectB });
    assert.equal(appA.project, projectA);
    assert.equal(appB.project, projectB);
    assert.notEqual(appA.stateUri, appB.stateUri);
    assert.equal(appA.test.goals[0].title, 'Alpha goal');
    assert.equal(appB.test.goals[0].title, 'Beta goal');

    const panelA = await call('open_panel', { project: projectA });
    const panelB = await call('open_panel', { project: projectB });
    assert.notEqual(panelA.url, panelB.url);
    const htmlA = await fetch(panelA.url).then(r => r.text());
    const htmlB = await fetch(panelB.url).then(r => r.text());
    assert(htmlA.includes('Alpha goal') && !htmlA.includes('Beta goal'));
    assert(htmlB.includes('Beta goal') && !htmlB.includes('Alpha goal'));
    assert.equal(await fetch(panelA.url.replace(/[^/]+$/, 'wrong')).then(r => r.status), 404);

    const readA = await call('read_panel', { project: projectA });
    const readB = await call('read_panel', { project: projectB });
    assert.notEqual(readA.eventUrl, readB.eventUrl);
    const resource = await client.readResource({ uri: 'ui://milestone/panel.html' });
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, [new URL(readA.eventUrl).origin]);
    assert.equal(new URL(readA.eventUrl).origin, new URL(readB.eventUrl).origin);

    await client.subscribeResource({ uri: readA.stateUri });
    await client.subscribeResource({ uri: readB.stateUri });
    const readResA = JSON.parse((await client.readResource({ uri: readA.stateUri })).contents[0].text);
    const readResB = JSON.parse((await client.readResource({ uri: readB.stateUri })).contents[0].text);
    assert.equal(readResA.project, projectA);
    assert.equal(readResB.project, projectB);

    const sseA = await fetch(readA.eventUrl, { signal: abort.signal });
    const sseB = await fetch(readB.eventUrl, { signal: abort.signal });
    const readerA = sseA.body.pipeThrough(new TextDecoderStream()).getReader();
    const readerB = sseB.body.pipeThrough(new TextDecoderStream()).getReader();
    const chunksA = [], chunksB = [];
    const pump = async (reader, out) => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          out.push(value);
        }
      } catch {}
    };
    void pump(readerA, chunksA);
    void pump(readerB, chunksB);

    let waitADone = false, waitBDone = false;
    const waitA = call('wait_panel', { after: readA.changeToken, project: projectA }).then(res => { waitADone = true; return res; });
    const waitB = call('wait_panel', { after: readB.changeToken, project: projectB }).then(res => { waitBDone = true; return res; });
    await delay(100);
    assert(!waitADone && !waitBDone);

    // Mutate only project A via MCP tool.
    stateA = await call('start_task', { id: 1, task: 1, revision: stateA.revision, project: projectA });
    const nextA = await waitA;
    assert.notEqual(nextA.changeToken, readA.changeToken);
    for (let i = 0; i < 40 && !chunksA.join('').includes('data: changed\n\n'); i++) await delay(25);
    assert(chunksA.join('').includes('data: changed\n\n'), 'Project A SSE must receive change');
    for (let i = 0; i < 40 && !notices.includes(readA.stateUri); i++) await delay(25);
    assert(notices.includes(readA.stateUri), 'Project A subscription must receive notification');

    // Also test external file write to project A.
    const countABeforeExt = notices.filter(u => u === readA.stateUri).length;
    const fileA = join(projectA, '.goals', 'project.json');
    const updatedA = (await readFile(fileA, 'utf8')).replace('"title": "Alpha goal"', '"title": "Alpha external"');
    await writeFile(`${fileA}.tmp`, updatedA);
    await rename(`${fileA}.tmp`, fileA);
    for (let i = 0; i < 60 && notices.filter(u => u === readA.stateUri).length === countABeforeExt; i++) await delay(25);
    assert(notices.filter(u => u === readA.stateUri).length > countABeforeExt, 'External write to A must notify A');

    // Verify project B stayed completely isolated.
    await delay(250);
    assert(!waitBDone, 'Project B wait_panel must remain pending when only A changed');
    assert(!chunksB.join('').includes('data: changed'), 'Project B SSE must stay quiet when only A changed');
    assert(!notices.includes(readB.stateUri), 'Project B subscription must stay quiet when only A changed');
    const finalB = await call('list_goals', { dataset: 'project', project: projectB });
    assert.equal(finalB.goals[0].title, 'Beta goal');
    assert.equal(finalB.goals[0].tasks[0].mark, ' ');

    // Unsubscribing from A stops further A notifications; mutating B wakes B.
    await client.unsubscribeResource({ uri: readA.stateUri });
    stateB = await call('start_task', { id: 1, task: 1, revision: stateB.revision, project: projectB });
    const nextB = await waitB;
    assert.notEqual(nextB.changeToken, readB.changeToken);
    for (let i = 0; i < 40 && !notices.includes(readB.stateUri); i++) await delay(25);
    assert(notices.includes(readB.stateUri), 'Project B subscription must receive notification when B changes');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await client.close();
  }
});

test('single-project mode remains backward compatible and rejects mismatched project paths', async () => {
  const projectA = await realpath(await mkdtemp(join(tmpdir(), 'milestone-sp-a-')));
  const projectB = await realpath(await mkdtemp(join(tmpdir(), 'milestone-sp-b-')));
  const { client, call } = await connect(['--project', projectA]);
  try {
    const { tools } = await client.listTools();
    for (const name of modelTools) {
      const tool = tools.find(t => t.name === name);
      assert(!tool.inputSchema?.required?.includes('project'), `${name} must keep project optional in single-project mode`);
    }
    const omitted = await call('list_goals', { dataset: 'project' });
    const matched = await call('list_goals', { dataset: 'project', project: projectA });
    assert.equal(omitted.revision, matched.revision);
    await call('list_goals', { dataset: 'project', project: projectB }, /does not match the bound project/);
    const app = await call('open_app', {});
    assert.equal(app.project, projectA);
    assert.equal(app.stateUri, 'milestone://panel/state');
  } finally {
    await client.close();
  }
});

test('antigravity build generates portable multi-project mcp_config.json and launches cleanly', async () => {
  const out = await mkdtemp(join(tmpdir(), 'milestone-ag-pkg-'));
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'milestone-ag-ws-')));
  await buildPlugin(out, undefined, 'antigravity');
  const config = JSON.parse(await readFile(join(out, 'mcp_config.json'), 'utf8'));
  assert.deepEqual(config, {
    mcpServers: {
      milestone: {
        command: 'node',
        args: ['${PLUGIN_ROOT}/server.mjs'],
      },
    },
  });
  const expandedArgs = config.mcpServers.milestone.args.map(arg => arg.replaceAll('${PLUGIN_ROOT}', out));
  const client = new Client({ name: 'milestone-ag-pkg-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: expandedArgs, cwd: out }));
  try {
    const panel = await client.readResource({ uri: 'ui://milestone/panel.html' });
    assert.equal(panel.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert(panel.contents[0].text.includes('id="progress"'));
    assert(!panel.contents[0].text.includes('/* APP_BUNDLE */'));
    const listed = await client.callTool({ name: 'list_goals', arguments: { dataset: 'project', project: workspace } });
    assert(!listed.isError, JSON.stringify(listed));
    const opened = await client.callTool({ name: 'open_app', arguments: { project: workspace } });
    assert(!opened.isError, JSON.stringify(opened));
    assert.equal(opened.structuredContent.project, workspace);
  } finally {
    await client.close();
  }
});
