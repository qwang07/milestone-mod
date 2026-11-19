import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { EmptyResultSchema, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectFileViewer } from './file-viewer.mjs';
import { renderPanel } from './render.mjs';
const app = new App({ name: 'Milestone', version: '0.3.0' });
if (document.body?.dataset.syncMode === 'project-file') {
  await connectFileViewer(app, document);
} else {
  const $ = selector => document.querySelector(selector);
  const STATE_URI = 'milestone://panel/state';
  let renderedRevision, latestRead = 0, connected = false, inFlight = false, pending = false, pushConnected = false, toolEventsReceived = false, currentProject;
  let stream, subscriptionFailed = false;
  function connectEvents(url) {
    if (!subscriptionFailed || !url || stream?.url === url) return;
    stream?.close();
    stream = new EventSource(url);
    stream.onopen = () => {
      pushConnected = true;
      void sync(); // Catch changes during initial connection or reconnection.
    };
    stream.onmessage = () => { void sync(); };
    stream.onerror = () => {
      pushConnected = false;
      $('#status').textContent = '事件连接中断';
      $('#refresh').hidden = false;
    };
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
      if (read !== latestRead) return;
      if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text ?? '读取失败');
      render(result.structuredContent);
      connectEvents(result.structuredContent.eventUrl);
      $('#status').textContent = stream && pushConnected ? '实时同步' : pushConnected || toolEventsReceived ? '' : '等待操作更新';
      $('#refresh').hidden = pushConnected || toolEventsReceived;
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
    if (!document.hidden) void sync();
  });
  window.addEventListener('pagehide', () => { connected = false; stream?.close(); stream = undefined; });
  window.addEventListener('pageshow', () => { if (app.getHostContext()) { connected = true; void sync(); } });
  // Read only on opening, visibility changes, explicit retry, or a pushed event.
  app.ontoolresult = result => {
    if (result.isError) return;
    const event = result.structuredContent?.panelEvent;
    if (event?.type === 'project-changed') {
      if (currentProject && event.project !== currentProject) return;
      toolEventsReceived = true;
      // Invalidate an older read before requesting the committed state.
      ++latestRead;
      void sync();
      return;
    }
    if (result.structuredContent?.test) {
      ++latestRead;
      render(result.structuredContent);
      $('#status').textContent = stream && pushConnected ? '实时同步' : pushConnected || toolEventsReceived ? '' : '等待操作更新';
      $('#refresh').hidden = pushConnected || toolEventsReceived;
    }
  };
  app.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => { if (params.uri === STATE_URI) void sync(); });
  function theme(context) {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  }
  app.onhostcontextchanged = theme;
  try {
    await app.connect(); theme(app.getHostContext());
    connected = true;
    try {
      await app.request({ method: 'resources/subscribe', params: { uri: STATE_URI } }, EmptyResultSchema, { timeout: 5000 });
      pushConnected = true;
    } catch {
      // Do not substitute polling when the host cannot forward subscriptions.
      subscriptionFailed = true;
    }
    await sync();
  } catch { $('#status').textContent = '暂时无法连接项目'; }
}
