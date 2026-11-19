import { readFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SidecarApp, Response } from 'sidecar_sdk';
import packageInfo from '../codex/package.json' with { type: 'json' };

const here = name => new URL(name, import.meta.url);
const sessions = new Map();
const serverPath = fileURLToPath(here('../../server.mjs'));
const app = new SidecarApp();

function touch(session) {
  clearTimeout(session.expiry);
  session.expiry = setTimeout(() => close(session), 45000);
  session.expiry.unref();
}

function close(session) {
  sessions.delete(session.id);
  clearTimeout(session.expiry);
  void session.client.close().catch(() => {});
}

app.page('/', () => readFileSync(here('./host.html'), 'utf8'));
app.api('/panel.html', () => new Response(readFileSync(here('../../panel.html'), 'utf8'), {
  contentType: 'text/html; charset=utf-8',
}), 'GET');

app.api('/api/session', async ({ workspaceUris } = {}) => {
  if (!Array.isArray(workspaceUris) || workspaceUris.length !== 1 || typeof workspaceUris[0] !== 'string') {
    return { error: '请选择只包含一个本地工作区的聊天。' };
  }
  let project;
  try {
    project = await realpath(fileURLToPath(workspaceUris[0]));
    if (!(await stat(join(project, '.goals', 'project.json'))).isFile()) throw new Error();
  } catch {
    return { error: '当前工作区没有 Milestone 项目。' };
  }
  const id = randomUUID();
  const client = new Client({ name: 'milestone-antigravity', version: packageInfo.version });
  const transport = new StdioClientTransport({
    command: process.env.MILESTONE_NODE ?? 'node', args: [serverPath, '--project', project], cwd: project,
  });
  try {
    await client.connect(transport, { timeout: 5000 });
  } catch (error) {
    console.error('Milestone MCP startup failed:', error.message);
    await client.close().catch(() => {});
    return { error: '无法连接当前工作区的 Milestone MCP 服务。' };
  }
  const session = { id, client };
  sessions.set(id, session);
  touch(session);
  return { id };
});

app.api('/api/tool', async ({ id, name, after } = {}) => {
  const session = sessions.get(id);
  if (!session || !['read_panel', 'wait_panel'].includes(name)) {
    return { isError: true, content: [{ type: 'text', text: 'Milestone 面板连接已关闭。' }] };
  }
  touch(session);
  try {
    return await session.client.callTool(
      { name, arguments: name === 'wait_panel' ? { after } : {} }, undefined, { timeout: 30000 },
    );
  } catch {
    return { isError: true, content: [{ type: 'text', text: '无法读取 Milestone MCP 服务。' }] };
  }
});

app.api('/api/close', ({ id } = {}) => {
  const session = sessions.get(id);
  if (session) close(session);
  return {};
});

app.run();
