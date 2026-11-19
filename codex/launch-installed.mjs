import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [marketplace, plugin, version, ...args] = process.argv.slice(1);
// The legacy Codex manifest preserves the conversation cwd but does not
// interpolate the plugin root in stdio arguments.
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const server = join(codexHome, 'plugins', 'cache', marketplace, plugin, version, 'server.mjs');
process.argv = [process.execPath, server, ...args];
await import(pathToFileURL(server).href);
