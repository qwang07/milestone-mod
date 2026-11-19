import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));
const antigravity = join(here, '..', 'antigravity');
const inline = script => script.replace(/<\/script/gi, '<\\/script');
export async function buildPlugin(destination, args = ['--project', '.'], host = 'codex', marketplace) {
  if (!['codex', 'antigravity'].includes(host)) throw new Error('Use --host codex or --host antigravity');
  destination = resolve(destination);
  await mkdir(join(destination, 'skills', 'milestone'), { recursive: true });
  await build({ entryPoints: [join(here, 'server.mjs')], outfile: join(destination, 'server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['esbuild'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const script = (await build({ entryPoints: [join(here, 'app.mjs')], bundle: true, platform: 'browser', format: 'esm', write: false })).outputFiles[0].text;
  const html = (await readFile(join(here, 'app.html'), 'utf8')).replace('/* APP_BUNDLE */', () => inline(script));
  await writeFile(join(destination, 'panel.html'), html);
  const version = '0.4.0';
  const description = 'Project plans, deliverables and progress';
  if (host === 'antigravity') {
    await writeFile(join(destination, 'plugin.json'), JSON.stringify({ name: 'milestone', displayName: 'Milestone', version, description }, null, 2));
    await copyFile(join(antigravity, 'README.md'), join(destination, 'README.md'));
    const sidecar = join(destination, 'sidecars', 'panel');
    const nodePaths = [join(here, 'node_modules')];
    await mkdir(sidecar, { recursive: true });
    await build({
      entryPoints: [join(antigravity, 'sidecar.mjs')], outfile: join(sidecar, 'main.mjs'),
      bundle: true, platform: 'node', format: 'esm', target: 'node22', nodePaths,
      external: ['sidecar_sdk'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    const hostScript = (await build({
      entryPoints: [join(antigravity, 'host.mjs')], bundle: true, platform: 'browser',
      format: 'esm', write: false, nodePaths,
    })).outputFiles[0].text;
    const hostHtml = (await readFile(join(antigravity, 'host.html'), 'utf8')).replace('/* HOST_BUNDLE */', () => inline(hostScript));
    await writeFile(join(sidecar, 'host.html'), hostHtml);
    await copyFile(join(antigravity, 'sidecar.json'), join(sidecar, 'sidecar.json'));
  } else {
    await mkdir(join(destination, '.codex-plugin'), { recursive: true });
    const name = marketplace ? 'milestone' : 'milestone-codex-probe';
    await writeFile(join(destination, '.codex-plugin', 'plugin.json'), JSON.stringify({ name, version, description, mcpServers: './.mcp.json', skills: './skills/', interface: { displayName: 'Milestone', shortDescription: 'Project plans through conversation' } }, null, 2));
    const launch = marketplace
      ? ['--input-type=module', '--eval', await readFile(join(here, 'launch-installed.mjs'), 'utf8'), '--', marketplace, name, version]
      : [join(destination, 'server.mjs')];
    await writeFile(join(destination, '.mcp.json'), JSON.stringify({ mcpServers: { milestone_apps: { type: 'stdio', command: 'node', args: [...launch, ...args], ...(args.includes('--scratch') ? { env: { TMPDIR: tmpdir() } } : {}) } } }, null, 2));
  }
  await writeFile(join(destination, 'skills', 'milestone', 'SKILL.md'), await readFile(join(here, 'SKILL.md'), 'utf8'));
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, host: { type: 'string' }, project: { type: 'string' }, marketplace: { type: 'string' } } });
  if (!values.out) throw new Error('--out is required');
  console.log(await buildPlugin(values.out, values.project ? ['--project', values.project] : undefined, values.host, values.marketplace));
}
