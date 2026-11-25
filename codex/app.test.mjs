import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import packageInfo from './package.json' with { type: 'json' };

const source = (await readFile(new URL('./app.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(initial = { revision: '1', test: {} }, openingSnapshot) {
  const timers = new Map(), listeners = {}, elements = {}, rendered = [];
  const waits = [], readArgs = [];
  let id = 0, calls = 0, response = initial?.isError ? initial : { structuredContent: initial }, held;
  class App {
    constructor() { this.getHostContext = () => ({}); }
    async connect() {}
    setNotificationHandler(_schema, handler) { this.notify = handler; }
    async callServerTool({ name, arguments: args }, { signal } = {}) {
      if (name === 'wait_panel') {
        return new Promise(resolve => {
          const abort = () => resolve({ isError: true });
          signal.addEventListener('abort', abort, { once: true });
          waits.push({ after: args.after, project: args.project, signal, complete(changeToken) {
            signal.removeEventListener('abort', abort);
            resolve({ structuredContent: { changeToken } });
          } });
        });
      }
      assert.equal(name, 'read_panel');
      calls++;
      readArgs.push(args);
      if (calls === 1 && openingSnapshot) {
        const first = response;
        this.ontoolresult({ structuredContent: openingSnapshot });
        response = { structuredContent: { ...initial, ...openingSnapshot } };
        return first;
      }
      return held ? await held : response;
    }
  }
  const document = { hidden: false, querySelector(selector) { return elements[selector] ??= { hidden: true, textContent: '', addEventListener(event, handler) { this[event] = handler; } }; }, addEventListener(event, handler) { listeners[event] = handler; } };
  const context = vm.createContext({ App, AbortController, document, window: { addEventListener(event, handler) { listeners[event] = handler; } }, ResourceUpdatedNotificationSchema: {}, applyDocumentTheme() {}, applyHostStyleVariables() {}, renderPanel(_document, data) { rendered.push(data.revision); }, setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; }, clearTimeout(key) { timers.delete(key); } });
  context.packageInfo = packageInfo;
  await vm.runInContext(`(async () => {${source}\nreturn app;})()`, context).then(app => { context.app = app; });
  return { document, listeners, elements, rendered, timers, waits, readArgs, app: context.app, get calls() { return calls; }, set response(value) { response = value; }, hold() { held = new Promise(resolve => { this.release = value => { held = null; resolve(value); }; }); } };
}
test('panel stays idle without push support and reads only on explicit events', async () => {
  const f = await fixture();
  assert.deepEqual(f.rendered, ['1']);
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements['#status'].textContent, '等待操作更新');
  f.response = { structuredContent: { revision: '2', test: {} } };
  f.app.notify({ params: { uri: 'milestone://panel/state' } }); await tick();
  assert.deepEqual(f.rendered, ['1', '2']);
  assert.equal(f.timers.size, 0);
  f.document.hidden = true; f.listeners.visibilitychange();
  const before = f.calls;
  f.app.notify({ params: { uri: 'milestone://panel/state' } }); await tick();
  assert.equal(f.calls, before);
  f.document.hidden = false; f.listeners.visibilitychange(); await tick();
  assert.equal(f.calls, before + 1);
  assert.equal(f.timers.size, 0);
});
test('pushed results supersede stale reads without scheduling retries', async () => {
  const f = await fixture();
  f.hold(); f.elements['#refresh'].click(); await tick();
  const calls = f.calls;
  f.app.ontoolresult({ structuredContent: { revision: 'new', test: {} } });
  f.release({ structuredContent: { revision: 'old', test: {} } }); await tick();
  assert(!f.rendered.includes('old'));
  assert.equal(f.calls, calls);
  assert.equal(f.timers.size, 0);
  f.response = { isError: true, content: [{ type: 'text', text: 'offline' }] };
  f.elements['#refresh'].click(); await tick();
  assert.equal(f.elements['#status'].textContent, '暂时无法同步');
  assert.equal(f.timers.size, 0);
});

test('successful mutation result triggers one read; failures and read results do not loop', async () => {
  const f = await fixture();
  const before = f.calls;
  f.response = { structuredContent: { revision: 'committed', project: '/project/a', test: {} } };
  f.app.ontoolresult({ structuredContent: { panelEvent: { type: 'project-changed', project: '/project/a' } } });
  await tick();
  assert.equal(f.calls, before + 1);
  assert.equal(f.rendered.at(-1), 'committed');
  f.app.ontoolresult({ structuredContent: { revision: 'committed', project: '/project/a', test: {} } }); await tick();
  f.app.ontoolresult({ isError: true, structuredContent: { panelEvent: { type: 'project-changed' } } });
  f.app.ontoolresult({ structuredContent: { panelEvent: { type: 'project-changed', project: '/project/b' } } });
  await tick();
  assert.equal(f.calls, before + 1);
  assert.equal(f.timers.size, 0);
});
test('mutation arriving during an older read invalidates it and reads committed state once', async () => {
  const f = await fixture();
  f.hold(); f.elements['#refresh'].click(); await tick();
  const before = f.calls;
  f.app.ontoolresult({ structuredContent: { panelEvent: { type: 'project-changed', project: '/project/a' } } });
  f.response = { structuredContent: { revision: 'committed', project: '/project/a', test: {} } };
  f.release({ structuredContent: { revision: 'old', test: {} } }); await tick();
  assert.equal(f.calls, before + 1);
  assert(!f.rendered.includes('old'));
  assert.equal(f.rendered.at(-1), 'committed');
});

test('the panel renews an idle wait without reading, reloads on a change and cancels on teardown', async () => {
  const f = await fixture({ revision: '1', test: {}, changeToken: 'first' });
  assert.equal(f.waits[0].after, 'first');
  f.waits[0].complete('first'); await tick();
  assert.deepEqual(f.rendered, ['1']);
  assert.equal(f.calls, 1);
  assert.equal(f.waits[1].after, 'first');
  f.response = { structuredContent: { revision: '2', test: {}, changeToken: 'second' } };
  f.waits[1].complete('second'); await tick();
  assert.deepEqual(f.rendered, ['1', '2']);
  assert.equal(f.elements['#status'].textContent, '实时同步');
  assert.equal(f.waits[2].after, 'second');
  await f.app.onteardown();
  assert.equal(f.waits[2].signal.aborted, true);
  await tick();
  assert.equal(f.calls, 2);
  assert.equal(f.waits.length, 3);
  assert.equal(f.timers.size, 0);
});

test('the opening snapshot keeps the wait token from an in-flight read', async () => {
  const f = await fixture({ revision: 'older', test: {}, changeToken: 'first' }, { revision: 'opened', test: {} });
  await tick();
  assert.deepEqual(f.rendered, ['opened']);
  assert.equal(f.waits[0].after, 'first');
  await f.app.onteardown();
});

test('inline multi-project panel binds to its project and ignores other projects', async () => {
  const stateUriA = 'milestone://panel/state?project=%2Fproject%2Fa';
  const stateUriB = 'milestone://panel/state?project=%2Fproject%2Fb';
  const mp = await fixture({ isError: true, content: [{ type: 'text', text: 'project is required' }] });
  assert.equal(mp.elements['#status'].textContent, '暂时无法同步');
  mp.response = { structuredContent: { revision: 'a1', project: '/project/a', stateUri: stateUriA, changeToken: 'tok-a1', test: {} } };
  mp.app.ontoolinput({ arguments: { project: '/project/a' } });
  mp.app.ontoolresult({ structuredContent: { revision: 'a1', project: '/project/a', stateUri: stateUriA, changeToken: 'tok-a1', test: {} } });
  await tick();
  assert.equal(mp.rendered.at(-1), 'a1');
  assert.equal(mp.waits[0].project, '/project/a');
  const callsAfterBind = mp.calls;
  // Events and snapshots from project B must be ignored.
  mp.app.ontoolresult({ structuredContent: { revision: 'b1', project: '/project/b', stateUri: stateUriB, test: {} } });
  mp.app.ontoolresult({ structuredContent: { panelEvent: { type: 'project-changed', project: '/project/b' } } });
  mp.app.notify({ params: { uri: stateUriB } });
  await tick();
  assert.equal(mp.calls, callsAfterBind);
  assert(!mp.rendered.includes('b1'));
  // Notifications for project A trigger a read scoped to project A.
  mp.response = { structuredContent: { revision: 'a2', project: '/project/a', stateUri: stateUriA, changeToken: 'tok-a2', test: {} } };
  mp.app.notify({ params: { uri: stateUriA } });
  await tick();
  assert.deepEqual({ ...mp.readArgs.at(-1) }, { project: '/project/a' });
  assert.equal(mp.rendered.at(-1), 'a2');
  await mp.app.onteardown();
});
