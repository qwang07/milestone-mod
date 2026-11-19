# Milestone for Antigravity

Use Antigravity App 2.33.0 or later and Node.js 22.18 or later.
Make `node` available to the Antigravity process.
Set `MILESTONE_NODE` to the absolute Node.js executable path in the Sidecar environment when the desktop app cannot find `node`.

## Install the panel

Install the Antigravity plugin directory from Customizations.
Enable Milestone in Customizations.
Enable the `milestone/panel` Sidecar in `~/.gemini/config/config.json` if Antigravity does not start it.
Set `sidecars["milestone/panel"].enabled` to `true`.

Open a conversation with one local Milestone workspace.
Open the right-side `+` menu.
Select Extensions and then Milestone.
Close the Milestone tab to stop the connection.
Reopen the tab to load the latest project state.

The panel reads `.goals/project.json` from the conversation workspace.
The Sidecar hosts the same MCP Apps HTML as Codex.

## Connect the conversation tools

Add the bundled `server.mjs` as a local MCP server in the workspace's `.agents/mcp_config.json`.
Use an absolute path to the installed `server.mjs`.
Pass `--project` followed by the absolute workspace path.
Use a distinct server key per workspace to avoid reusing a connection from another workspace.

```json
{
  "mcpServers": {
    "milestone_my_project": {
      "command": "node",
      "args": ["/absolute/plugin/path/server.mjs", "--project", "/absolute/workspace/path"]
    }
  }
}
```

Call `list_goals` with `dataset=project` to initialize or inspect the workspace.

## Build

Run the following commands from `codex/`.

```sh
npm ci
npm run build -- --host antigravity --out /absolute/path/to/antigravity-plugin
```

See [Google's Sidecar configuration](https://antigravity.google/docs/sidecars/).
