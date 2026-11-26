import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import packageInfo from './package.json' with { type: 'json' };

const here = fileURLToPath(new URL('.', import.meta.url));
const antigravity = join(here, '..', 'antigravity');
const claude = join(here, '..', 'claude');
const inline = script => script.replace(/<\/script/gi, '<\\/script');
const CODEX_PANEL = 'Open the persistent panel from `+` → `More tools…` → `Plugins and MCPs` → `Milestone` in the right panel.';
const CODEX_INLINE = 'Use `open_app` when the user wants to see Milestone in the conversation.';
/** The conversation workflow is shared; only where the panel lives differs by host. */
export function skillFor(host, skill) {
  if (host !== 'claude') return skill;
  if (!skill.includes(CODEX_PANEL) || !skill.includes(CODEX_INLINE)) throw new Error('SKILL.md panel lines changed; update skillFor');
  return skill
    .replace(CODEX_PANEL, 'The Milestone pane beside the conversation shows goals and progress and updates live. The user opens it with `/milestone-panel`.')
    .replace(CODEX_INLINE, 'Use `open_app` when the user wants to see Milestone; in Claude Code it opens the Milestone pane.');
}

export async function buildPlugin(destination, args = ['--project', '.'], host = 'codex', marketplace) {
  if (!['codex', 'antigravity', 'claude'].includes(host)) throw new Error('Use --host codex, --host antigravity or --host claude');
  destination = resolve(destination);
  await mkdir(join(destination, 'skills', 'milestone'), { recursive: true });
  await build({ entryPoints: [join(here, 'server.mjs')], outfile: join(destination, 'server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['esbuild'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const script = (await build({ entryPoints: [join(here, 'app.mjs')], bundle: true, platform: 'browser', format: 'esm', write: false })).outputFiles[0].text;
  const html = (await readFile(join(here, 'app.html'), 'utf8')).replace('/* APP_BUNDLE */', () => inline(script));
  await writeFile(join(destination, 'panel.html'), html);
  const { version } = packageInfo;
  const description = 'Project plans, deliverables and progress';
  if (host === 'antigravity') {
    await writeFile(join(destination, 'plugin.json'), JSON.stringify({ name: 'milestone', displayName: 'Milestone', version, description }, null, 2));
    await writeFile(join(destination, 'mcp_config.json'), JSON.stringify({
      mcpServers: {
        milestone: {
          command: 'node',
          args: ['${PLUGIN_ROOT}/server.mjs'],
        },
      },
    }, null, 2));
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
  } else if (host === 'claude') {
    await mkdir(join(destination, '.claude-plugin'), { recursive: true });
    await mkdir(join(destination, 'hooks'), { recursive: true });
    await mkdir(join(destination, 'types'), { recursive: true });
    await writeFile(join(destination, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'milestone', version, description,
      author: { name: 'Quan Wang', url: 'https://github.com/qwang07' },
      types: './types/index.d.ts',
    }, null, 2));
    await writeFile(join(destination, '.mcp.json'), JSON.stringify({
      mcpServers: { milestone: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs', '--model-read-panel'] } },
    }, null, 2));
    await writeFile(join(destination, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.tsx'] }, null, 2));
    await copyFile(join(claude, 'hooks', 'register.tsx'), join(destination, 'hooks', 'register.tsx'));
    await copyFile(join(here, 'view.mjs'), join(destination, 'hooks', 'view.mjs'));
    await writeFile(join(destination, 'hooks', 'view.d.mts'), "import type { PanelView } from '../types'\n\nexport function panelView(data: unknown): PanelView\n");
    await copyFile(join(claude, 'types', 'index.d.ts'), join(destination, 'types', 'index.d.ts'));
    await copyFile(join(claude, 'README.md'), join(destination, 'README.md'));
    await mkdir(join(destination, 'tests'), { recursive: true });
    await copyFile(join(claude, 'tests', 'pane.test.tsx'), join(destination, 'tests', 'pane.test.tsx'));
  } else {
    await mkdir(join(destination, '.codex-plugin'), { recursive: true });
    const name = marketplace ? 'milestone' : 'milestone-codex-probe';
    await writeFile(join(destination, '.codex-plugin', 'plugin.json'), JSON.stringify({ name, version, description, mcpServers: './.mcp.json', skills: './skills/', interface: { displayName: 'Milestone', shortDescription: 'Project plans through conversation' } }, null, 2));
    const launch = marketplace
      ? ['--input-type=module', '--eval', await readFile(join(here, 'launch-installed.mjs'), 'utf8'), '--', marketplace, name, version]
      : [join(destination, 'server.mjs')];
    await writeFile(join(destination, '.mcp.json'), JSON.stringify({ mcpServers: { milestone_apps: { type: 'stdio', command: 'node', args: [...launch, ...args], ...(args.includes('--scratch') ? { env: { TMPDIR: tmpdir() } } : {}) } } }, null, 2));
  }
  await writeFile(join(destination, 'skills', 'milestone', 'SKILL.md'), skillFor(host, await readFile(join(here, 'SKILL.md'), 'utf8')));
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, host: { type: 'string' }, project: { type: 'string' }, marketplace: { type: 'string' } } });
  if (!values.out) throw new Error('--out is required');
  console.log(await buildPlugin(values.out, values.project ? ['--project', values.project] : undefined, values.host, values.marketplace));
}
