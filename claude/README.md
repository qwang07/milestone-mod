# Milestone for Claude Code

Manage project goals, deliverables and progress through conversation, with a live Milestone pane beside the chat.

## Install

```sh
/plugin marketplace add https://github.com/qwang07/milestone-mod.git#plugin
/plugin install milestone@milestone-mod
```

Use Node.js 22.18 or later. Make `node` available on the `PATH` of the Claude Code process.

## Use

- Talk about goals and acceptance in the conversation. Claude records them with the Milestone tools.
- Run `/milestone-panel` to open the pane. It opens on its own at session start when the window is wide enough.
- The pane is read-only. Expand a goal or task with its button to read acceptance, plans and evidence.

## How the pane stays current

The plugin bundles the same MCP server and panel data as the Codex and Antigravity packages, in multi-project mode.
The pane reads `read_panel` for the session's project root.
It redraws on events only:

- At session start the hooks module asks Claude Code to watch `.goals/project.json` (`watchPaths` on SessionStart). Every change to that file, from this session, another conversation or another host, arrives as a FileChanged event.
- A Milestone tool call in this session redraws as soon as its result is in.

There is no polling. When a read fails the pane shows the reason and a refresh button.

## Build

Run from `codex/`:

```sh
npm ci
npm run build -- --host claude --out /absolute/path/to/claude-plugin
claude plugin validate /absolute/path/to/claude-plugin
claude plugin test /absolute/path/to/claude-plugin
```

Load a local build while developing with `claude --plugin-dir /absolute/path/to/claude-plugin`.
