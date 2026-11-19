// Claude CLI hooks delegate migrated writes to the same locked store as Codex.
import { realpath } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { ProjectStore } from './project.mjs';

const { before, write } = JSON.parse(await text(process.stdin));
const store = new ProjectStore(await realpath(process.cwd()));
await store.change(undefined, pool => {
  if (JSON.stringify(pool.goals) !== JSON.stringify(before)) throw new Error('Conflict: retry with the latest project state');
  return { write };
});
