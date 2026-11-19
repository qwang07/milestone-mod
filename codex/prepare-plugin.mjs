// Generate a disposable local marketplace, without changing global settings.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from './build.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(execFileSync(process.execPath, [join(here, 'verify.mjs'), '--prepare-only'], { encoding: 'utf8' }));
const root = await mkdtemp(join(tmpdir(), 'milestone-apps-marketplace-'));
const plugin = join(root, 'plugins', 'milestone-codex-probe');
await mkdir(join(root, '.agents', 'plugins'), { recursive: true });
await writeFile(join(root, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
  name: 'milestone-local-probe', interface: { displayName: 'Milestone Local Probe' },
  plugins: [{ name: 'milestone-codex-probe', source: { source: 'local', path: './plugins/milestone-codex-probe' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
}, null, 2));
await buildPlugin(plugin, ['--source', fixture.source, '--scratch', fixture.scratch]);
console.log(JSON.stringify({ marketplace: root, plugin, ...fixture }, null, 2));
console.log(`\nInstall this local probe:\ncodex plugin marketplace add '${root}' --json\ncodex plugin add milestone-codex-probe@milestone-local-probe --json`);
