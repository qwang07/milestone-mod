import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, rename, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const URI = 'milestone://panel/state';

test('file changes notify subscribed clients; unchanged content and unsubscribe stay quiet', { timeout: 15000 }, async () => {
  const fixture = JSON.parse(execFileSync(process.execPath, [join(here, 'verify.mjs'), '--prepare-only'], { encoding: 'utf8' }));
  const original = new Map(await Promise.all((await readdir(join(fixture.source, '.goals'))).map(async name =>
    [name, await readFile(join(fixture.source, '.goals', name), 'utf8')])));
  const client = new Client({ name: 'milestone-event-check', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, env: { TMPDIR: tmpdir() },
    args: [join(here, 'server.mjs'), '--source', fixture.source, '--scratch', fixture.scratch] });
  const notices = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, notification => { notices.push(notification.params.uri); });
  async function waitForNotice(previous) {
    for (let i = 0; i < 60 && notices.length === previous; i++) await delay(25);
    assert(notices.length > previous, 'A filesystem change must produce a notification');
    assert.equal(notices.at(-1), URI);
  }
  async function state() {
    const data = await client.readResource({ uri: URI });
    return JSON.parse(data.contents[0].text);
  }
  try {
    await client.connect(transport);
    assert.equal(client.getServerCapabilities().resources.subscribe, true);
    await client.subscribeResource({ uri: URI });
    const before = await state();
    const changed = await client.callTool({ name: 'start_task', arguments: { id: fixture.fixtureGoal, task: 1, revision: before.test.revision } });
    assert(!changed.isError);
    await waitForNotice(0);
    assert.equal((await state()).test.goals.find(g => g.id === fixture.fixtureGoal).tasks[0].mark, '~');
    const path = join(fixture.scratch, '.goals', 'project.json');
    const content = await readFile(path, 'utf8');
    await delay(200);
    const count = notices.length;
    await writeFile(path, content);
    await delay(250);
    assert.equal(notices.length, count, 'Same content must not notify');
    const renamed = content.replace('"title": "Codex MCP verification"', '"title": "External writer verification"');
    await writeFile(`${path}.tmp`, renamed);
    await rename(`${path}.tmp`, path);
    await waitForNotice(count);
    assert.equal((await state()).test.goals.find(g => g.id === fixture.fixtureGoal).title, 'External writer verification');
    const created = await client.callTool({ name: 'manage_goal', arguments: { action: 'create', title: 'Draft notification', revision: (await state()).test.revision } });
    assert(!created.isError);
    const draftGoal = created.structuredContent.goals.find(g => g.title === 'Draft notification').id;
    await delay(150);
    const draftBefore = await state();
    const beforeDraftCount = notices.length;
    const proposed = await client.callTool({ name: 'manage_goal', arguments: { action: 'propose', id: draftGoal, revision: draftBefore.test.revision, acceptance: 'Checked', approach: 'Test', tasks: [{ title: 'One', acceptance: 'Check one' }] } });
    assert(!proposed.isError);
    await waitForNotice(beforeDraftCount);
    const draftAfter = await state();
    assert.equal(draftAfter.test.revision, draftBefore.test.revision, 'Drafts do not change goal Markdown');
    assert.notEqual(draftAfter.revision, draftBefore.revision, 'A runtime-only draft update must refresh the panel');
    assert(draftAfter.test.drafts[draftGoal].id);
    await client.unsubscribeResource({ uri: URI });
    const unsubscribed = notices.length;
    await writeFile(path, content);
    await delay(250);
    assert.equal(notices.length, unsubscribed, 'Unsubscribed clients must not be notified');
    for (const [name, text] of original) assert.equal(await readFile(join(fixture.source, '.goals', name), 'utf8'), text);
  } finally { await client.close(); }
});

test('one project write reaches both independent panel event streams', { timeout: 15000 }, async () => {
  const fixture = JSON.parse(execFileSync(process.execPath, [join(here, 'verify.mjs'), '--prepare-only'], { encoding: 'utf8' }));
  const clients = ['first', 'second'].map(name => new Client({ name, version: '1' }));
  const abort = new AbortController();
  const snapshot = async client => (await client.callTool({ name: 'read_panel', arguments: {} })).structuredContent;
  const timeout = setTimeout(() => abort.abort(), 10000);
  try {
    const panels = await Promise.all(clients.map(async client => {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, 'server.mjs'), '--project', fixture.scratch] }));
      const initial = await snapshot(client);
      const resource = await client.readResource({ uri: 'ui://milestone/panel.html' });
      assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, [new URL(initial.eventUrl).origin]);
      const response = await fetch(initial.eventUrl, { signal: abort.signal });
      assert.equal(response.status, 200);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      async function afterChange() {
        let buffer = '';
        while (!buffer.includes('data: changed\n\n')) {
          const { value, done } = await reader.read();
          assert(!done, 'event stream ended before a change');
          buffer += value;
        }
        return snapshot(client);
      }
      return { initial, afterChange };
    }));
    const result = await clients[0].callTool({ name: 'start_task', arguments: {
      id: fixture.fixtureGoal, task: 1, revision: panels[0].initial.test.revision,
    } });
    assert(!result.isError);
    const updated = await Promise.all(panels.map(p => p.afterChange()));
    assert.equal(updated[0].revision, updated[1].revision);
    for (const data of updated) assert.equal(data.test.goals.find(g => g.id === fixture.fixtureGoal).tasks[0].mark, '~');
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await Promise.all(clients.map(c => c.close()));
  }
});

test('project file publishes a committed task for two directory watchers', { timeout: 15000 }, async () => {
  const fixture = JSON.parse(execFileSync(process.execPath, [join(here, 'verify.mjs'), '--prepare-only'], { encoding: 'utf8' }));
  const client = new Client({ name: 'progress-file', version: '1' });
  const { watch } = await import('node:fs/promises');
  const stop = new AbortController();
  const dir = join(fixture.scratch, '.goals');
  const file = join(dir, 'progress.milestone');
  const read = async () => JSON.parse(await readFile(file, 'utf8'));
  const mark = data => data.test.goals.find(g => g.id === fixture.fixtureGoal).tasks[0].mark;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, 'server.mjs'), '--project', fixture.scratch] }));
    const { tools } = await client.listTools();
    assert(!tools.some(t => t._meta?.['openai/ui']?.entrypoints?.some(entry => entry.type === 'thread')));
    const tool = tools.find(t => t.name === 'view_progress_file');
    assert.equal(tool._meta['openai/ui'].entrypoints[0].type, 'file');
    const html = await client.readResource({ uri: tool._meta.ui.resourceUri });
    assert(html.contents[0].text.includes('<body data-sync-mode="project-file">'));
    assert.equal(mark(await read()), ' ');
    const { structuredContent } = await client.callTool({ name: 'list_goals', arguments: { dataset: 'project' } });
    assert.equal(structuredContent.progressFile, await realpath(file));
    async function changedFile() {
      for await (const event of watch(dir, { signal: stop.signal })) {
        if (event.filename === 'progress.milestone') return read();
      }
    }
    const readers = Promise.all([changedFile(), changedFile()]);
    const outcome = await client.callTool({ name: 'start_task', arguments: { id: fixture.fixtureGoal, task: 1, revision: structuredContent.revision } });
    assert(!outcome.isError);
    for (const data of await readers) assert.equal(mark(data), '~');
  } finally { stop.abort(); await client.close(); }
});
