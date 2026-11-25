# Milestone for Antigravity

Use Antigravity App 2.33.0 or later and Node.js 22.18 or later.
Make `node` available to the Antigravity process.
Set `MILESTONE_NODE` to the absolute Node.js executable path in the Sidecar environment when the desktop app cannot find `node`.

## Install the plugin

Install the Antigravity plugin directory from Customizations.
Enable Milestone in Customizations.
Enable the `milestone/panel` Sidecar in `~/.gemini/config/config.json` if Antigravity does not start it.
Set `sidecars["milestone/panel"].enabled` to `true`.

The plugin bundles `mcp_config.json` and starts the Milestone MCP server automatically in multi-project mode.
Do not create a per-project `.agents/mcp_config.json` file.

## Use Milestone in a workspace

Open a conversation with a local workspace.
Call `list_goals` with `dataset=project` and `project` set to the workspace absolute path to initialize or inspect the workspace.
Pass `project` set to the workspace absolute path when calling Milestone conversation tools (`list_goals`, `manage_goal`, `start_task`, `report_task`, `finish_task`, `open_app`, `open_panel`).
Each workspace keeps isolated state, file watchers, and panel updates under its own `.goals/project.json`.

Open the right-side `+` menu to use the persistent panel.
Select Extensions and then Milestone.
Close the Milestone tab to stop the Sidecar connection.
Reopen the tab to load the latest workspace state.

The Sidecar launches `server.mjs --project <workspace>` for the active conversation workspace.
The Sidecar hosts the same MCP Apps HTML as Codex.

## Build

Run the following commands from `codex/`.

```sh
npm ci
npm run build -- --host antigravity --out /absolute/path/to/antigravity-plugin
```

See [Google's Sidecar configuration](https://antigravity.google/docs/sidecars/).
