import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
export async function buildPlugin(destination, args = ['--project', '.']) {
  // Leave MCP cwd unset: Codex starts each connection in its conversation directory.
  // Absolute --source/--scratch arguments are only for the disposable probe package.
  destination = resolve(destination);
  await mkdir(join(destination, '.codex-plugin'), { recursive: true });
  await mkdir(join(destination, 'skills', 'milestone'), { recursive: true });
  await build({ entryPoints: [join(here, 'server.mjs')], outfile: join(destination, 'server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['esbuild'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const script = (await build({ entryPoints: [join(here, 'app.mjs')], bundle: true, platform: 'browser', format: 'esm', write: false })).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = (await readFile(join(here, 'app.html'), 'utf8')).replace('/* APP_BUNDLE */', () => script);
  await writeFile(join(destination, 'panel.html'), html);
  await writeFile(join(destination, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'milestone-codex-probe', version: '0.3.0', description: 'Project plans, deliverables and progress', mcpServers: './.mcp.json', skills: './skills/', interface: { displayName: 'Milestone', shortDescription: 'Project plans through conversation' } }, null, 2));
  // CLI 0.169 does not expand plugin-root placeholders in the compatibility
  // manifest. Pin this local package's own path, never the source checkout.
  await writeFile(join(destination, '.mcp.json'), JSON.stringify({ mcpServers: { milestone_apps: { type: 'stdio', command: 'node', args: [join(destination, 'server.mjs'), ...args], ...(args.includes('--scratch') ? { env: { TMPDIR: tmpdir() } } : {}) } } }, null, 2));
  await writeFile(join(destination, 'skills', 'milestone', 'SKILL.md'), await readFile(join(here, 'SKILL.md'), 'utf8'));
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('--out is required');
  console.log(await buildPlugin(values.out));
}
