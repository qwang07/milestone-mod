import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('./app.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const timers = new Map(), listeners = {}, elements = {}, rendered = [];
  let id = 0, calls = 0, response = { structuredContent: { revision: '1', test: {} } }, held;
  class App {
    constructor() { this.getHostContext = () => ({}); }
    async connect() {}
    async request() { throw new Error("Host does not forward subscriptions"); }
    setNotificationHandler(_schema, handler) { this.notify = handler; }
    async callServerTool({ name }) { assert.equal(name, 'read_panel'); calls++; return held ? await held : response; }
  }
  const document = { hidden: false, querySelector(selector) { return elements[selector] ??= { hidden: true, textContent: '', addEventListener(event, handler) { this[event] = handler; } }; }, addEventListener(event, handler) { listeners[event] = handler; } };
  const context = vm.createContext({ App, document, window: { addEventListener(event, handler) { listeners[event] = handler; } }, EmptyResultSchema: {}, ResourceUpdatedNotificationSchema: {}, applyDocumentTheme() {}, applyHostStyleVariables() {}, renderPanel(_document, data) { rendered.push(data.revision); }, setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; }, clearTimeout(key) { timers.delete(key); } });
  await vm.runInContext(`(async () => {${source}\nreturn app;})()`, context).then(app => { context.app = app; });
  return { document, listeners, elements, rendered, timers, app: context.app, get calls() { return calls; }, set response(value) { response = value; }, hold() { held = new Promise(resolve => { this.release = value => { held = null; resolve(value); }; }); }, async next() { const [key, timer] = [...timers][0]; timers.delete(key); timer.fn(); await tick(); } };
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
