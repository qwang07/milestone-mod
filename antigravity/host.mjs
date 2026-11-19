import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import packageInfo from '../codex/package.json' with { type: 'json' };

const status = document.querySelector('#status');
const frame = document.querySelector('iframe');
const sidecar = window.sidecar;
let connection;
let visible = false;

async function post(path, data, options = {}) {
  const response = await sidecar.fetch(path, {
    ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('无法连接 Antigravity Sidecar。');
  return response.json();
}

function close() {
  const previous = connection;
  connection = undefined;
  if (!previous) return;
  void previous.bridge?.close();
  frame.hidden = true;
  frame.removeAttribute('src');
  if (previous.id) closeSession(previous.id);
}

function closeSession(id) {
  void post('/api/close', { id }, { keepalive: true }).catch(() => {});
}

async function open() {
  if (connection || !visible || document.hidden) return;
  const current = {};
  connection = current;
  status.hidden = false;
  status.textContent = '正在打开 Milestone…';
  try {
    const result = await post('/api/session', { workspaceUris: await sidecar.getWorkspaceUris() });
    if (result.error) throw new Error(result.error);
    if (connection !== current) {
      closeSession(result.id);
      return;
    }
    current.id = result.id;
    const bridge = new AppBridge(null, { name: 'Milestone for Antigravity', version: packageInfo.version },
      { serverTools: {} }, {
        hostContext: {
          theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'],
        },
      });
    current.bridge = bridge;
    bridge.oncalltool = ({ name, arguments: args }, { signal }) =>
      post('/api/tool', { id: current.id, name, after: args?.after }, { signal });
    bridge.oninitialized = () => { status.hidden = true; };
    await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
    if (connection === current) {
      frame.hidden = false;
      frame.src = 'panel.html';
    }
  } catch (error) {
    if (connection !== current) return;
    close();
    status.textContent = error.message;
  }
}

// Antigravity can retain the outer page when the user closes the side-panel tab.
const observer = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  if (visible) void open();
  else close();
});
observer.observe(document.documentElement);
window.addEventListener('pagehide', close);
window.addEventListener('pageshow', () => void open());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) close();
  else void open();
});
