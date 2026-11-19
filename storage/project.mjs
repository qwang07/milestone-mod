import { mkdir, readdir, readFile, lstat, realpath, rename, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as M from '../core/model.ts';

const missing = error => error.code === 'ENOENT';
const runtimeFile = name => name === 'run.json' || name === 'drafts.json';

/** One local project, shared by cooperating Node adapters. No automatic lock stealing. */
export class ProjectStore {
  constructor(root) {
    this.root = root;
    this.goals = join(root, '.goals');
    this.runtime = join(root, '.milestone-runtime');
    this.projectFile = join(this.goals, 'project.json');
    this.queue = Promise.resolve();
  }

  async directory(path, create = false) {
    if (create) await mkdir(path, { recursive: true });
    if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) throw new Error(`Refused linked directory: ${path}`);
  }

  async text(path) {
    const stat = await lstat(path).catch(error => { if (!missing(error)) throw error; });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refused non-regular file: ${path}`);
    return readFile(path, 'utf8');
  }

  async atomic(path, text) {
    await this.text(path);
    const pending = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(pending, text, { flag: 'wx', mode: 0o600 });
      await rename(pending, path);
    } finally { await unlink(pending).catch(error => { if (!missing(error)) throw error; }); }
  }

  async readGoals() {
    await this.directory(this.goals);
    const goals = [], errors = [], raw = {};
    for (const name of (await readdir(this.goals)).filter(name => M.idOfFile(name) !== undefined).sort()) {
      const text = await this.text(join(this.goals, name));
      if (text === null) throw new Error('Goal files changed during reading; refresh and retry');
      raw[name] = text;
      const goal = M.parseGoal(text, name);
      if (M.isError(goal)) errors.push(goal); else goals.push(goal);
    }
    goals.sort((a, b) => a.id - b.id);
    const revision = createHash('sha256').update(JSON.stringify(Object.entries(raw))).digest('hex');
    return { goals, errors, raw, revision };
  }

  async recover() {
    const text = await this.text(join(this.runtime, 'transaction.json'));
    if (text === null) return;
    const journal = JSON.parse(text);
    if (journal.version !== 1 || !Array.isArray(journal.entries)) throw new Error('Unrecognized Milestone transaction; inspect it before continuing');
    // Validate every target before replaying any file. Never overwrite an outside edit.
    for (const entry of journal.entries) {
      if (!runtimeFile(entry.name) && M.idOfFile(entry.name) === undefined) throw new Error('Invalid transaction target');
      if (typeof entry.after !== 'string' || !(entry.before === null || typeof entry.before === 'string')) throw new Error('Invalid transaction contents');
      const path = join(runtimeFile(entry.name) ? this.runtime : this.goals, entry.name);
      const current = await this.text(path);
      if (current !== entry.before && current !== entry.after) throw new Error('An external edit conflicts with an unfinished transaction; inspect it before continuing');
    }
    for (const entry of journal.entries) {
      const path = join(runtimeFile(entry.name) ? this.runtime : this.goals, entry.name);
      if (await this.text(path) !== entry.after) await this.atomic(path, entry.after);
    }
    await unlink(join(this.runtime, 'transaction.json'));
  }

  locked(action) {
    const result = this.queue.then(() => this.withLock(action));
    this.queue = result.catch(() => {});
    return result;
  }

  async withLock(action) {
    await this.directory(this.root);
    await this.directory(this.goals, true);
    await this.directory(this.runtime, true);
    const ignore = join(this.runtime, '.gitignore');
    if (await this.text(ignore) === null) await writeFile(ignore, '*\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const lock = join(this.runtime, 'lock');
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(lock); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (attempt >= 50) throw new Error('Milestone is busy or has an interrupted writer. Refresh and retry; inspect the runtime lock if it persists.');
        await delay(10);
      }
    }
    try {
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, created: new Date().toISOString() }), { flag: 'wx' });
      return await action();
    } finally {
      await unlink(join(lock, 'owner.json')).catch(error => { if (!missing(error)) throw error; });
      await rmdir(lock);
    }
  }

  async loadProject() {
    const text = await this.text(this.projectFile);
    if (text !== null) {
      await this.finishMigration();
      const project = JSON.parse(text);
      if (project.version !== 1 || !Array.isArray(project.goals) || !project.drafts ||
          typeof project.drafts !== 'object' || Array.isArray(project.drafts) || !('run' in project)) {
        throw new Error('Invalid .goals/project.json');
      }
      const ids = new Set();
      for (const goal of project.goals) {
        if (!Number.isSafeInteger(goal.id) || ids.has(goal.id) ||
            M.isError(M.parseGoal(M.serializeGoal(goal), M.fileName(goal.id)))) throw new Error('Invalid project goal');
        ids.add(goal.id);
      }
      return project;
    }
    await this.recover();
    const pool = await this.readGoals();
    if (pool.errors.length) throw new Error('Cannot migrate unreadable goals: ' + JSON.stringify(pool.errors));
    const run = JSON.parse(await this.text(join(this.runtime, 'run.json')) ?? 'null');
    const drafts = JSON.parse(await this.text(join(this.runtime, 'drafts.json')) ?? '{}');
    if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) throw new Error('Invalid legacy drafts');
    const project = { version: 1, goals: pool.goals, run, drafts };
    const originals = { ...pool.raw };
    for (const name of ['run.json', 'drafts.json']) {
      const content = await this.text(join(this.runtime, name));
      if (content !== null) originals[name] = content;
    }
    if (Object.keys(originals).length) {
      const backup = join(this.runtime, 'before-project-json');
      await this.directory(backup, true);
      for (const [name, content] of Object.entries(originals)) {
        const target = join(backup, name);
        const previous = await this.text(target);
        if (previous !== null && previous !== content) throw new Error('Legacy backup conflicts with ' + name);
        if (previous === null) await this.atomic(target, content);
      }
      await this.atomic(join(this.runtime, 'migration.json'), JSON.stringify(Object.keys(originals)));
    }
    await this.atomic(this.projectFile, JSON.stringify(project, null, 2) + '\n');
    await this.finishMigration();
    return project;
  }

  async finishMigration() {
    const marker = join(this.runtime, 'migration.json');
    const pending = await this.text(marker);
    if (pending === null) return;
    const backup = join(this.runtime, 'before-project-json');
    await this.directory(backup);
    for (const name of JSON.parse(pending)) {
      if (!runtimeFile(name) && M.idOfFile(name) === undefined) throw new Error('Invalid migration entry');
      const path = join(runtimeFile(name) ? this.runtime : this.goals, name);
      const current = await this.text(path);
      if (current === null) continue;
      if (current !== await this.text(join(backup, name))) throw new Error('Legacy file changed during migration: ' + name);
      await unlink(path);
    }
    await unlink(marker);
  }

  asPool(project) {
    return { goals: project.goals, errors: [], run: project.run, drafts: project.drafts,
      revision: createHash('sha256').update(JSON.stringify(project.goals)).digest('hex') };
  }

  async snapshot() {
    return this.locked(async () => this.asPool(await this.loadProject()));
  }

  async change(revision, calculate) {
    return this.locked(async () => {
      const project = await this.loadProject();
      const pool = this.asPool(project);
      if (revision !== undefined && revision !== pool.revision) throw new Error('Conflict: project changed; refresh and review the current state');
      const change = await calculate(pool, project.run, project.drafts);
      const next = { ...project, goals: M.applyChange(pool, change.write ?? []).goals,
        run: 'run' in change ? change.run : project.run, drafts: 'drafts' in change ? change.drafts : project.drafts };
      if (JSON.stringify(await this.loadProject()) !== JSON.stringify(project)) throw new Error('Conflict: project changed during the operation');
      await this.atomic(this.projectFile, JSON.stringify(next, null, 2) + '\n');
      return { ...this.asPool(next), message: change.message ?? '', ...(change.extra ?? {}) };
    });
  }
}
