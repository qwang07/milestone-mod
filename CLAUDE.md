# Milestone

Milestone records a project's goals, deliverables, acceptance and progress through conversation. One MCP server and one conversation skill serve three hosts, each with a live read-only panel.

## Layout

- `core/model.ts`: business rules (goal parsing, plans, task marks, tree order). Pure: no I/O.
- `storage/project.mjs`: `.goals/project.json` storage with the shared lock, revision checks, transaction recovery and legacy migration.
- `codex/server.mjs`: the MCP server every host runs. Adapter only: rules stay in `core/`, storage in `storage/`.
- `codex/view.mjs`: the panel's view model (labels, states, ordering), shared by every panel. Change display rules here.
- `codex/render.mjs`, `codex/app.*`: the MCP Apps HTML panel (Codex, and Antigravity through its Sidecar).
- `antigravity/`: Antigravity Sidecar host for the HTML panel.
- `claude/`: Claude Code hooks module (`hooks/register.tsx`), its state contract (`types/index.d.ts`) and pane tests. The pane reads `read_panel` and redraws on FileChanged for `.goals/project.json` and on Milestone tool results. No polling.
- `codex/SKILL.md`: the conversation workflow for every host. `skillFor` in `codex/build.mjs` swaps only the panel lines for Claude Code.
- `codex/build.mjs`: builds a host package with `--host codex|antigravity|claude`.

## Commands

Use Node.js 22.18 or later. Run from `codex/`:

```sh
npm ci
npm test                                            # model, server, panel and build tests
npm run build -- --host claude --out /abs/path/pkg  # or --host antigravity, or the Codex default
```

Check the Claude Code package after building it:

```sh
claude plugin validate /abs/path/pkg
claude plugin test /abs/path/pkg
```

Run filesystem event tests outside a sandbox that suppresses `fs.watch`.
`codex/node_modules` holds a platform-specific esbuild: run `npm ci` again on another OS.

## Rules

- Never edit `.goals/` or `.milestone-runtime/` by hand. This repository tracks its own goals there; change them only through the Milestone tools.
- Keep the three packages on the same `server.mjs` and `panel.html`. CI compares them.
- A hooks module calls `$` only from top-level functions or hooks, never from a helper defined inside a hook.
- Keep user-facing panel text in Chinese, matching the existing labels.

## Release

Push the release commit to `main`, then push a `vMAJOR.MINOR.PATCH` tag. `.github/workflows/publish-plugin.yml` tests, builds all three packages and publishes them to the `plugin` branch with the Claude Code marketplace file.
