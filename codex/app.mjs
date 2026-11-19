import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { renderPanel } from './render.mjs';
const app = new App({ name: 'Milestone', version: '0.4.0' });
const $ = selector => document.querySelector(selector);
const STATE_URI = 'milestone://panel/state';
let renderedRevision, latestRead = 0, connected = false, inFlight = false, pending = false, currentProject;
let watcher, watchReady = false;
function showStatus() {
  const live = Boolean(watcher) && watchReady;
  $('#status').textContent = live ? '实时同步' : watcher ? '等待项目变更' : '等待操作更新';
  $('#refresh').hidden = live;
}
async function watchUpdates(after) {
  if (watcher || !connected || document.hidden || typeof after !== 'string') return;
  const controller = new AbortController();
  watcher = controller;
  try {
    while (!controller.signal.aborted) {
      const result = await app.callServerTool(
        { name: 'wait_panel', arguments: { after } },
        { signal: controller.signal, timeout: 35000 },
      );
      if (controller.signal.aborted) return;
      const next = result.structuredContent?.changeToken;
      if (result.isError || typeof next !== 'string') throw new Error('等待项目变更失败');
      watchReady = true;
      showStatus();
      if (next === after) continue;
      after = next;
      await sync();
    }
  } catch {
    if (watcher !== controller) return;
    watcher = undefined;
    watchReady = false;
    $('#status').textContent = '事件连接中断';
    $('#refresh').hidden = false;
  }
}
function stopWatching() {
  const previous = watcher;
  watcher = undefined;
  watchReady = false;
  previous?.abort();
}
function render(data) {
  if (data.revision === renderedRevision) return;
  currentProject = data.project;
  renderPanel(document, data);
  renderedRevision = data.revision;
}
async function sync() {
  if (!connected || document.hidden) return;
  if (inFlight) { pending = true; return; }
  inFlight = true;
  const read = ++latestRead;
  try {
    const result = await app.callServerTool({ name: 'read_panel', arguments: {} });
    const data = result.structuredContent;
    // An opening tool result can supersede the snapshot while this read is in flight.
    if (!result.isError && data) void watchUpdates(data.changeToken);
    if (read !== latestRead) return;
    if (result.isError || !data) throw new Error(result.content?.find(c => c.type === 'text')?.text ?? '读取失败');
    render(data);
    showStatus();
  } catch {
    if (read === latestRead) {
      $('#status').textContent = '暂时无法同步';
      $('#refresh').hidden = false;
    }
  } finally {
    inFlight = false;
    if (pending) { pending = false; void sync(); }
  }
}
$('#refresh').addEventListener('click', () => void sync());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopWatching();
  else void sync();
});
function disconnect() {
  connected = false;
  ++latestRead;
  pending = false;
  stopWatching();
}
app.onteardown = async () => { disconnect(); return {}; };
window.addEventListener('pagehide', disconnect);
window.addEventListener('pageshow', () => { if (app.getHostContext()) { connected = true; void sync(); } });
// Read only on opening, visibility changes, explicit retry, or a pushed event.
app.ontoolresult = result => {
  if (result.isError) return;
  const event = result.structuredContent?.panelEvent;
  if (event?.type === 'project-changed') {
    if (currentProject && event.project !== currentProject) return;
    // Invalidate an older read before requesting the committed state.
    ++latestRead;
    void sync();
    return;
  }
  if (result.structuredContent?.test) {
    ++latestRead;
    render(result.structuredContent);
    showStatus();
  }
};
app.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => {
  if (params.uri === STATE_URI) void sync();
});
function theme(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.onhostcontextchanged = theme;
try {
  await app.connect(); theme(app.getHostContext());
  connected = true;
  await sync();
} catch { $('#status').textContent = '暂时无法连接项目'; }
