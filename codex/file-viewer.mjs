import { applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { EmptyResultSchema, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { renderPanel } from './render.mjs';

export async function connectFileViewer(app, document) {
  const status = document.querySelector('#status');
  let uri, sequence = 0, subscribed = false;
  async function read() {
    const request = ++sequence;
    try {
      const { contents } = await app.readServerResource({ uri });
      if (request !== sequence) return;
      const content = contents.find(item => item.uri === uri) ?? contents[0];
      const json = content.text ?? new TextDecoder().decode(Uint8Array.from(atob(content.blob), c => c.charCodeAt(0)));
      const progress = JSON.parse(json);
      if (progress.format !== 'milestone-progress-v1') throw new Error('Invalid progress file');
      renderPanel(document, progress);
      status.textContent = subscribed ? '实时同步' : '文件订阅未连接';
    } catch {
      if (request === sequence) status.textContent = '无法读取项目进度文件';
    }
  }
  const subscription = (method, file) => app.request({ method, params: { uri: file } }, EmptyResultSchema);
  app.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => {
    if (params.uri === uri) void read();
  });
  app.ontoolinput = async ({ arguments: args }) => {
    const file = args?.file?.resourceUri;
    if (!file || file === uri) return;
    const prior = uri;
    uri = file;
    ++sequence;
    subscribed = false;
    if (prior) void subscription('resources/unsubscribe', prior).catch(() => {});
    try {
      await subscription('resources/subscribe', file);
      if (file !== uri) return;
      subscribed = true;
    } catch { if (file !== uri) return; }
    await read();
  };
  function theme(context) {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  }
  app.onhostcontextchanged = theme;
  try { await app.connect(); theme(app.getHostContext()); }
  catch { status.textContent = '无法连接文件查看器'; }
}
