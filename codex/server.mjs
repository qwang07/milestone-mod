// Codex MCP adapter. Business rules and storage are shared modules.
import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, join, parse, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as M from '../core/model.ts';
import { panel } from './panel.mjs';
import { ProjectStore } from '../storage/project.mjs';
import packageInfo from './package.json' with { type: 'json' };

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { source: { type: 'string' }, scratch: { type: 'string' }, project: { type: 'string' } },
});
if (!values.project && Boolean(values.source) !== Boolean(values.scratch)) {
  throw new Error('Use --project, or --source and --scratch for isolated verification');
}
const multiProject = !values.project && !values.source && !values.scratch;
const owner = randomUUID();
const APP_URI = 'ui://milestone/panel.html';
const STATE_URI = 'milestone://panel/state';
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

async function resolveProjectRoot(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || !isAbsolute(input)) {
    throw new Error('project must be an absolute path to an existing directory');
  }
  if (input.split(/[\\/]/).includes('..')) {
    throw new Error('project path must not contain parent traversal segments');
  }
  let canonical;
  try { canonical = await realpath(input); }
  catch { throw new Error('Project directory does not exist'); }
  const stats = await lstat(canonical);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Project path must be an existing directory');
  }
  if (parse(canonical).root === canonical) {
    throw new Error('Project path must not be a filesystem root');
  }
  return canonical;
}

const contexts = new Map();
const eventRoutes = new Map();
const panelRoutes = new Map();

function createContext(root, source = null) {
  const ctx = {
    root,
    source,
    projectName: basename(source ?? root) || '项目',
    store: new ProjectStore(root),
    stateUri: multiProject ? `${STATE_URI}?project=${encodeURIComponent(root)}` : STATE_URI,
    eventId: randomUUID(),
    eventClients: new Set(),
    changeTimer: undefined,
    previousRevision: undefined,
    changeToken: randomUUID(),
    waitingPanels: new Set(),
    watchers: [],
    watching: false,
    subscribedUris: new Set(),
    panelToken: randomUUID(),
  };
  contexts.set(root, ctx);
  eventRoutes.set(`/events/${ctx.eventId}`, ctx);
  return ctx;
}

let defaultContext = null;
if (!multiProject) {
  const scratch = await realpath(values.project ?? values.scratch);
  const source = values.project ? null : await realpath(values.source);
  const temp = await realpath(tmpdir());
  if (source) {
    if (!inside(temp, scratch) || source === scratch || inside(scratch, source) || inside(source, scratch)) throw new Error('The test copy must be a separate directory under the system temp directory');
    const marker = JSON.parse(await readFile(join(scratch, '.milestone-probe.json'), 'utf8'));
    if (marker.source !== source) throw new Error('The test copy marker does not match --source');
  }
  defaultContext = createContext(scratch, source);
  await defaultContext.store.snapshot();
}

async function resolveContext(project) {
  if (!multiProject) {
    if (project === undefined) return defaultContext;
    const canonical = await resolveProjectRoot(project);
    if (canonical !== defaultContext.root) throw new Error('Project path does not match the bound project');
    return defaultContext;
  }
  if (project === undefined) throw new Error('project is required in multi-project mode');
  const canonical = await resolveProjectRoot(project);
  return contexts.get(canonical) ?? createContext(canonical);
}

const publicRun = run => run ? { ...run, owner: undefined, owned: run.owner === owner } : null;
const publicPool = ({ raw, ...pool }) => ({ ...pool, ...('run' in pool ? { run: publicRun(pool.run) } : {}) });
const busyRun = run => run && ['queued', 'running'].includes(run.status);
const checked = outcome => { if (M.refused(outcome)) throw new Error(outcome.error); return outcome; };
const day = () => new Date().toLocaleDateString('en-CA');
async function readPool(root) {
  const dir = join(root, '.goals');
  if ((await realpath(dir)) !== dir || !(await lstat(dir)).isDirectory()) throw new Error('Refused linked .goals directory');
  const canonical = await new ProjectStore(root).text(join(dir, 'project.json'));
  if (canonical !== null) {
    const data = JSON.parse(canonical);
    return { goals: data.goals, errors: [], revision: createHash('sha256').update(canonical).digest('hex') };
  }
  const pool = { goals: [], errors: [] };
  const hash = createHash('sha256');
  for (const name of (await readdir(dir)).filter(n => M.idOfFile(n) !== undefined).sort()) {
    const path = join(dir, name);
    if (!(await lstat(path)).isFile() || (await realpath(path)) !== path) throw new Error(`Refused linked goal ${name}`);
    const text = await readFile(path, 'utf8');
    hash.update(JSON.stringify([name, text]));
    const goal = M.parseGoal(text, name);
    if (M.isError(goal)) pool.errors.push(goal); else pool.goals.push(goal);
  }
  pool.goals.sort((a, b) => a.id - b.id);
  return { ...pool, revision: hash.digest('hex') };
}

const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const guarded = fn => async args => {
  try { return result(await fn(args)); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
};
const { version } = packageInfo;
const server = new McpServer({ name: 'milestone-codex-probe', version });
let appHtml;
try { appHtml = await readFile(new URL('./panel.html', import.meta.url), 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const { build } = await import('esbuild');
  const appScript = (await build({ entryPoints: [fileURLToPath(new URL('./app.mjs', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false })).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  appHtml = (await readFile(new URL('./app.html', import.meta.url), 'utf8')).replace('/* APP_BUNDLE */', () => appScript);
}
// Each project context gets its own isolated change channel. Only a change signal crosses HTTP.
let eventServer;
let eventBase;
function ensureEventServer() {
  eventBase ??= new Promise((resolve, reject) => {
    const listener = createServer((req, res) => {
      const ctx = req.method === 'GET' ? eventRoutes.get(req.url) : undefined;
      if (!ctx || req.headers.host !== `127.0.0.1:${listener.address().port}`) {
        res.writeHead(404).end(); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
      res.write(': connected\n\n');
      ctx.eventClients.add(res);
      res.once('close', () => ctx.eventClients.delete(res));
    });
    eventServer = listener;
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${listener.address().port}`));
  }).catch(() => null);
  return eventBase;
}
async function panelEvents(ctx) {
  const base = await ensureEventServer();
  if (!base) return null;
  return new URL(ctx ? `${base}/events/${ctx.eventId}` : base);
}
server.registerResource('milestone-panel', APP_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => {
  const endpoint = await panelEvents(defaultContext);
  return { contents: [{ uri: APP_URI, mimeType: 'text/html;profile=mcp-app', text: appHtml,
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: endpoint ? [endpoint.origin] : [], resourceDomains: [] } } } }] };
});
function stopWatchers(ctx) {
  clearTimeout(ctx.changeTimer);
  for (const watcher of ctx.watchers) watcher.close();
  ctx.watchers = [];
  ctx.watching = false;
}
function ensureWatchers(ctx) {
  if (ctx.watching) return;
  const dirs = [...(ctx.source ? [join(ctx.source, '.goals')] : []), ctx.store.goals, ctx.store.runtime];
  const attached = [];
  try {
    for (const dir of dirs) {
      const watcher = watch(dir, (_event, name) => {
        if (name !== null && M.idOfFile(String(name)) === undefined && String(name) !== 'project.json') return;
        clearTimeout(ctx.changeTimer);
        ctx.changeTimer = setTimeout(() => { void notifyChanged(ctx); }, 75);
      });
      watcher.on('error', () => {
        stopWatchers(ctx);
        void notifyChanged(ctx);
      });
      attached.push(watcher);
    }
  } catch {
    for (const watcher of attached) watcher.close();
    return;
  }
  ctx.watchers = attached;
  ctx.watching = true;
}
async function panelState(ctx) {
  const [existing, test] = await Promise.all([ctx.source ? readPool(ctx.source) : Promise.resolve({ goals: [], errors: [], revision: '' }), ctx.store.snapshot()]);
  ensureWatchers(ctx);
  const rows = pool => M.treeOrder(pool).filter(x => x.goal.status !== 'dropped').map(({ goal, depth }) =>
    ({ id: goal.id, status: goal.status, title: goal.title, depth, label: M.labelOf(goal) }));
  const revision = createHash('sha256').update(JSON.stringify([existing.revision, test.revision, test.run, test.drafts])).digest('hex');
  return { version, source: ctx.source, scratch: ctx.root, project: ctx.root, projectName: ctx.projectName, revision, stateUri: ctx.stateUri, existing: { ...existing, rows: rows(existing) }, test: { ...publicPool(test), rows: rows(test) }, run: publicRun(test.run) };
}
async function readPanelState(ctx) {
  const data = await panelState(ctx);
  if (ctx.previousRevision === undefined) ctx.previousRevision = data.revision;
  return data;
}
function parseStateUri(rawUri) {
  let url;
  try { url = new URL(rawUri); } catch { return null; }
  if (`${url.protocol}//${url.host}${url.pathname}` !== STATE_URI) return null;
  return url;
}
if (multiProject) {
  server.registerResource('milestone-state', new ResourceTemplate(`${STATE_URI}{?project}`, { list: undefined }), { mimeType: 'application/json' }, async (uri, variables) => {
    const project = uri.searchParams.get('project') ?? (typeof variables.project === 'string' ? variables.project : undefined);
    const ctx = await resolveContext(project);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readPanelState(ctx)) }] };
  });
} else {
  server.registerResource('milestone-state', STATE_URI, { mimeType: 'application/json' }, async () => ({
    contents: [{ uri: STATE_URI, mimeType: 'application/json', text: JSON.stringify(await readPanelState(defaultContext)) }],
  }));
}
server.server.registerCapabilities({ resources: { subscribe: true } });
server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
  if (!multiProject) {
    if (params.uri !== STATE_URI) throw new Error('Unknown subscription resource');
    defaultContext.subscribedUris.add(STATE_URI);
    return {};
  }
  const url = parseStateUri(params.uri);
  const project = url?.searchParams.get('project') ?? undefined;
  if (!url || !project) throw new Error('Unknown subscription resource');
  const ctx = await resolveContext(project);
  await readPanelState(ctx);
  ctx.subscribedUris.add(params.uri);
  return {};
});
server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
  if (!multiProject) {
    if (params.uri !== STATE_URI) throw new Error('Unknown subscription resource');
    defaultContext.subscribedUris.delete(STATE_URI);
    return {};
  }
  const url = parseStateUri(params.uri);
  if (!url) throw new Error('Unknown subscription resource');
  for (const ctx of contexts.values()) ctx.subscribedUris.delete(params.uri);
  return {};
});
function wakePanels(ctx) {
  ctx.changeToken = randomUUID();
  for (const finish of ctx.waitingPanels) finish();
}
async function notifyChanged(ctx) {
  try {
    const data = await panelState(ctx);
    const revision = data.revision;
    if (revision === ctx.previousRevision) return;
    ctx.previousRevision = revision;
    wakePanels(ctx);
    for (const client of ctx.eventClients) client.write('data: changed\n\n');
    for (const uri of ctx.subscribedUris) await server.server.sendResourceUpdated({ uri });
  } catch {
    // Let the panel read and display the error, including a removed goals directory.
    wakePanels(ctx);
    for (const uri of ctx.subscribedUris) await server.server.sendResourceUpdated({ uri }).catch(() => {});
  }
}
if (defaultContext) {
  ensureWatchers(defaultContext);
  await notifyChanged(defaultContext);
}

const projectSchema = z.string().min(1).describe('Absolute path to the workspace directory');
const modelProjectField = multiProject ? projectSchema : projectSchema.optional();
const panelProjectField = projectSchema.optional();

server.registerTool('open_app', {
  title: 'Milestone',
  description: 'Show Milestone goals, deliverables and progress. Open Milestone from the side panel for a persistent view, or call this tool for an inline view. All changes happen through conversation.',
  inputSchema: { project: modelProjectField }, annotations: { readOnlyHint: true },
  _meta: {
    ui: { resourceUri: APP_URI },
    'openai/ui': { entrypoints: [{ type: 'thread' }] },
  },
}, guarded(async ({ project } = {}) => {
  const ctx = await resolveContext(project);
  const after = ctx.changeToken;
  return { ...await readPanelState(ctx), changeToken: after };
}));
server.registerTool('read_panel', {
  description: 'Read live goal data for the Milestone panel.',
  inputSchema: { project: panelProjectField }, annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ['app'] } },
}, guarded(async ({ project } = {}) => {
  const ctx = await resolveContext(project);
  const after = ctx.changeToken;
  return { ...await readPanelState(ctx), changeToken: after, eventUrl: (await panelEvents(ctx))?.href };
}));
server.registerTool('wait_panel', {
  description: 'Wait for a project change or renew the wait without reading project data.',
  inputSchema: { after: z.uuid(), project: panelProjectField }, annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ['app'] } },
}, async ({ after, project }, { signal }) => {
  let ctx;
  try { ctx = await resolveContext(project); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  if (after === ctx.changeToken && !signal.aborted) {
    await new Promise(resolve => {
      function finish() {
        clearTimeout(timeout);
        ctx.waitingPanels.delete(finish);
        signal.removeEventListener('abort', finish);
        resolve();
      }
      // Return before Codex's tool timeout so the view can renew an idle wait.
      const timeout = setTimeout(finish, 25000);
      ctx.waitingPanels.add(finish);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
  return result({ changeToken: ctx.changeToken });
});
server.registerTool('list_goals', {
  description: 'Read the current project goals, content revision and execution state with dataset=project. The optional existing reference project is read-only. test is a legacy alias for project.',
  inputSchema: { dataset: z.enum(['project', 'existing', 'test']), project: modelProjectField },
  annotations: { readOnlyHint: true },
}, guarded(async ({ dataset, project }) => {
  const ctx = await resolveContext(project);
  const snapshot = dataset === 'existing' && ctx.source ? await readPool(ctx.source) : await ctx.store.snapshot();
  if (!(dataset === 'existing' && ctx.source)) ensureWatchers(ctx);
  return { dataset, ...publicPool(snapshot) };
}));

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive();
const taskInput = z.object({ n: positive.optional(), title: z.string().min(1), acceptance: z.string().min(1) });
const changed = async (project, revision, fn) => {
  const ctx = await resolveContext(project);
  const data = await ctx.store.change(revision, fn);
  ensureWatchers(ctx);
  void notifyChanged(ctx);
  return { ...publicPool(data), panelEvent: { type: 'project-changed', project: ctx.root, revision: data.revision } };
};
function projectPlan(pool, args) {
  const goal = pool.goals.find(g => g.id === args.id);
  if (!goal || ['idea', 'planning'].includes(goal.status)) return M.planGoal(pool, { ...args, split: 'tasks', today: day() });
  if (!['planned', 'active'].includes(goal.status) || goal.split !== 'tasks') throw new Error('Only an unfinished task plan can be revised');
  if (goal.tasks.some(t => t.mark === '~')) throw new Error('Pause or report the current task before revising its plan');
  const validated = checked(M.planGoal({ ...pool, goals: pool.goals.map(g => g.id === goal.id ? { ...g, status: 'planning' } : g) }, { ...args, split: 'tasks', today: day() }));
  const used = new Set();
  let next = Math.max(0, ...goal.tasks.map(t => t.n));
  const tasks = args.tasks.map(t => {
    if (t.n === undefined) return { ...t, n: ++next, mark: ' ' };
    const old = goal.tasks.find(x => x.n === t.n);
    if (!old || used.has(t.n)) throw new Error('Each retained task must have a unique existing n');
    used.add(t.n);
    if (old.mark !== ' ' && (old.title !== t.title || old.acceptance !== t.acceptance)) throw new Error('Completed or cancelled tasks cannot be rewritten');
    return { ...old, title: t.title.trim(), acceptance: t.acceptance.trim() };
  });
  if (tasks.some((t, i) => t.n !== i + 1)) throw new Error('Keep existing task order and append new tasks; task numbers must remain consecutive');
  if (goal.tasks.some(t => !used.has(t.n))) throw new Error('Retain every existing task by n; cancel unwanted tasks explicitly before revising');
  return { ...validated, write: [{ ...validated.write[0], status: goal.status, tasks }] };
}
server.registerTool('manage_goal', {
  description: 'Record a goal, propose a reviewable plan draft, confirm a plan, focus, add a task, skip, complete, drop or reorder goals. Use action=propose to save a draft without changing the goal Markdown, then ask the user to review it. Use action=plan with its draftId and confirmed=true only after clear user confirmation. Add, skip, done and drop also require confirmed=true. Revisions retain all existing tasks by n and preserve completed tasks; new deliverables omit n. Skip cancels an explicit pending task and does not complete its goal.',
  inputSchema: {
    action: z.enum(['create', 'planning', 'propose', 'plan', 'focus', 'add', 'skip', 'done', 'drop', 'move']),
    revision: revisionSchema, project: modelProjectField, id: positive.optional(), title: z.string().optional(), parent: positive.optional(),
    description: z.string().optional(), acceptance: z.string().optional(), approach: z.string().optional(), decisions: z.string().optional(),
    tasks: z.array(taskInput).optional(), before: positive.optional(), confirmed: z.boolean().optional(), draftId: z.string().optional(), task: positive.optional(), goalAcceptanceChecked: z.boolean().optional(), evidence: z.string().trim().min(1).optional(),
  }, annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ui: { resourceUri: APP_URI, visibility: ['model'] } },
}, guarded(args => changed(args.project, args.revision, (pool, run, drafts) => {
  if (['plan', 'add', 'skip', 'done', 'drop'].includes(args.action) && args.confirmed !== true) throw new Error('Confirm the proposed change with the user before saving it');
  if (busyRun(run) && !['create', 'planning', 'propose'].includes(args.action)) throw new Error('A task is scheduled or running. Pause and wait for the current task before changing the plan or active goal.');
  if (args.action !== 'create' && !args.id) throw new Error('id is required');
  if (args.action === 'propose') {
    const previous = drafts[args.id];
    if (previous ? previous.id !== args.draftId : args.draftId !== undefined) throw new Error('The draft changed; read its current draftId before replacing it');
    checked(projectPlan(pool, { ...args, acceptance: args.acceptance ?? '', approach: args.approach ?? '' }));
    const goal = pool.goals.find(g => g.id === args.id);
    const draft = { id: randomUUID(), goal: args.id, base: M.serializeGoal(goal), description: args.description, acceptance: args.acceptance, approach: args.approach, decisions: args.decisions, tasks: args.tasks, createdAt: new Date().toISOString() };
    return { drafts: { ...drafts, [args.id]: draft }, message: 'Plan draft saved for review; the goal Markdown is unchanged', extra: { instruction: 'Show the draft to the user and wait for confirmation. Do not start work or save a confirmed plan yet.' } };
  }
  let plan = args;
  if (args.action === 'plan' && drafts[args.id] && args.draftId === undefined) throw new Error('Review the current draft and provide its draftId before confirming');
  if (args.action === 'plan' && args.draftId !== undefined) {
    const draft = drafts[args.id];
    if (!draft || draft.id !== args.draftId) throw new Error('This plan draft has changed; review the current draft before confirming');
    const goal = pool.goals.find(g => g.id === args.id);
    if (!goal || M.serializeGoal(goal) !== draft.base) throw new Error('The goal changed after this draft was proposed; propose and review a new draft');
    plan = { ...draft, id: args.id };
  }
  let out;
  switch (args.action) {
    case 'create': out = M.createGoal(pool, { title: args.title ?? '', parent: args.parent, description: args.description, today: day() }); break;
    case 'planning': out = M.startPlanning(pool, args.id); break;
    case 'plan': out = projectPlan(pool, { ...plan, acceptance: plan.acceptance ?? '', approach: plan.approach ?? '' }); break;
    case 'focus': out = M.focusGoal(pool, args.id); break;
    case 'add': out = M.addTask(pool, args.id, args.title ?? '', args.acceptance ?? ''); break;
    case 'skip': {
      const goal = pool.goals.find(g => g.id === args.id);
      const task = goal?.tasks.find(t => t.n === args.task);
      if (!task || task.mark !== ' ') throw new Error('Choose an explicit pending task to cancel');
      out = { write: [{ ...goal, tasks: goal.tasks.map(t => t.n === task.n ? { ...t, mark: '-' } : t) }], message: 'Task cancelled; goal acceptance still required' };
      break;
    }
    case 'done':
      if (!args.goalAcceptanceChecked || !args.evidence) throw new Error('Verify goal acceptance and provide evidence before completion');
      out = M.completeGoal(pool, args.id); break;
    case 'drop': out = M.dropGoal(pool, args.id); break;
    case 'move': out = M.moveGoal(pool, args.id, args.before); break;
  }
  const outcome = checked(out);
  const nextDrafts = { ...drafts };
  if (['plan', 'drop', 'done'].includes(args.action)) delete nextDrafts[args.id];
  return { ...outcome, ...(['plan', 'drop', 'done'].includes(args.action) ? { drafts: nextDrafts } : {}), ...(['focus', 'skip', 'done', 'drop'].includes(args.action) ? { run: { ...run, status: 'stopped', reason: args.action === 'done' ? '目标已验收完成' : '项目计划已更新', ...(args.action === 'done' ? { receipts: [...(run?.receipts ?? []), { goal: args.id, summary: '目标已验收完成', evidence: args.evidence, finishedAt: new Date().toISOString() }] } : {}), owner } } : {}) };
})));

const taskUpdates = (run, id, task, value) => { const updates = { ...(run?.updates ?? {}) }; if (value) updates[`${id}:${task}`] = value; else delete updates[`${id}:${task}`]; return updates; };

server.registerTool('report_task', {
  description: 'Report project task progress: pause for a normal handoff, block with a concrete obstacle, or resume after checking the previous conversation stopped. This records state only; it does not control or schedule a conversation.',
  inputSchema: { action: z.enum(['pause', 'block', 'resume']), id: positive, task: positive, runId: z.string(), revision: revisionSchema, project: modelProjectField, reason: z.string().trim().min(1), confirmed: z.boolean().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ui: { resourceUri: APP_URI, visibility: ['model'] } },
}, guarded(args => changed(args.project, args.revision, (pool, run) => {
  if (!run || run.id !== args.runId || run.goal !== args.id || run.task !== args.task) throw new Error('Task assignment changed; read the current state');
  const goal = pool.goals.find(g => g.id === args.id);
  const task = goal?.tasks.find(t => t.n === args.task);
  if (args.action === 'resume') {
    if (!args.confirmed) throw new Error('Check that the previous conversation stopped and obtain explicit confirmation before resuming');
    if (!['paused', 'blocked', 'running', 'queued'].includes(run.status) || !task || ![' ', '~'].includes(task.mark)) throw new Error('This task cannot be resumed');
    const out = checked(M.startTask(pool, args.id, args.task));
    return { ...out, run: { id: randomUUID(), owner, goal: args.id, task: args.task, status: 'running', reason: '', updates: taskUpdates(run, args.id, args.task), receipts: run.receipts ?? [], startedAt: new Date().toISOString() }, message: 'Task reassigned; organize implementation steps in the conversation' };
  }
  if (run.owner !== owner || run.status !== 'running') throw new Error('Only the owning conversation can report a running task');
  return { write: [{ ...goal, tasks: goal.tasks.map(t => t.n === args.task ? { ...t, mark: ' ' } : t) }], run: { ...run, status: args.action === 'block' ? 'blocked' : 'paused', updates: taskUpdates(run, args.id, args.task, { status: args.action === 'block' ? 'blocked' : 'paused', reason: args.reason }), reason: args.reason }, message: 'Project progress recorded; no work scheduled' };
})));

server.registerTool('start_task', {
  description: 'Claim an explicitly authorized project deliverable before work. Returns an assignment runId for reporting results. Manage implementation steps in the conversation. Never schedules another task.',
  inputSchema: { id: positive, task: positive, revision: revisionSchema, project: modelProjectField },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, _meta: { ui: { resourceUri: APP_URI, visibility: ['model'] } },
}, guarded(args => changed(args.project, args.revision, (pool, run) => {
  if (busyRun(run)) throw new Error('Another task is assigned; inspect and explicitly resume or pause it first');
  const task = pool.goals.find(g => g.id === args.id)?.tasks.find(t => t.n === args.task);
  if (task?.mark === '~') throw new Error('An unfinished assignment needs explicit review before resuming');
  const out = checked(M.startTask(pool, args.id, args.task));
  return { ...out, run: { id: randomUUID(), owner, goal: args.id, task: args.task, status: 'running', updates: taskUpdates(run, args.id, args.task), receipts: run?.receipts ?? [], startedAt: new Date().toISOString(), reason: '' } };
})));

server.registerTool('finish_task', {
  description: 'Finish an owned running task only after checking its acceptance. Include a concrete summary and verification evidence. The last task also requires goalAcceptanceChecked=true. Record only this deliverable. Further project work requires authorization from the conversation; no next task is scheduled. Never finish a failed task.',
  inputSchema: { id: positive, task: positive, runId: z.string(), revision: revisionSchema, project: modelProjectField, summary: z.string().trim().min(1), evidence: z.string().trim().min(1), goalAcceptanceChecked: z.boolean().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ui: { resourceUri: APP_URI, visibility: ['model'] } },
}, guarded(args => changed(args.project, args.revision, (pool, run) => {
  if (run?.owner !== owner || run?.id !== args.runId || run?.goal !== args.id || run?.task !== args.task || run?.status !== 'running') throw new Error('Only the owning executor can finish the current task; the ticket is stale or paused');
  const out = checked(M.finishTask(pool, args.id, args.task));
  const goal = out.write.find(g => g.id === args.id);
  if (goal.status === 'done' && args.goalAcceptanceChecked !== true) throw new Error('Verify the goal acceptance before finishing its last task');
  const receipts = [...(run.receipts ?? []), { goal: args.id, task: args.task, runId: run.id, summary: args.summary, evidence: args.evidence, finishedAt: new Date().toISOString() }];
  return { ...out, run: { ...run, status: 'stopped', updates: taskUpdates(run, args.id, args.task), receipts, reason: goal.status === 'done' ? '目标已验收完成' : '任务已完成' }, extra: { instruction: 'Project progress saved. Decide further work from the user-authorized scope in the conversation.' } };
})));

let http;
let panelBase;
server.registerTool('open_panel', {
  description: 'Return the live read-only Milestone panel URL. Open it in the Codex right browser panel.',
  inputSchema: { project: modelProjectField }, annotations: { readOnlyHint: true },
}, guarded(async ({ project } = {}) => {
  const ctx = await resolveContext(project);
  panelRoutes.set(`/${ctx.panelToken}`, ctx);
  if (!http) {
    http = createServer(async (req, res) => {
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      const target = req.method === 'GET' ? panelRoutes.get(req.url) : undefined;
      if (!target || req.headers.host !== new URL(panelBase).host) {
        res.writeHead(404, headers).end('Not found'); return;
      }
      try {
        const [existing, test] = await Promise.all([target.source ? readPool(target.source) : Promise.resolve({ goals: [], errors: [] }), target.store.snapshot()]);
        res.writeHead(200, headers).end(panel({ source: target.source, scratch: target.root, existing, test }));
      } catch (error) { res.writeHead(500, headers).end('Unable to read goal files'); }
    });
    await new Promise((ok, fail) => { http.once('error', fail); http.listen(0, '127.0.0.1', ok); });
    panelBase = `http://127.0.0.1:${http.address().port}`;
  }
  return { url: `${panelBase}/${ctx.panelToken}`, placement: 'right', refreshSeconds: 2 };
}));

const transport = new StdioServerTransport();
await server.connect(transport);
const close = () => {
  for (const ctx of contexts.values()) stopWatchers(ctx);
  eventServer?.close();
  http?.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
process.stdin.once('end', close);
