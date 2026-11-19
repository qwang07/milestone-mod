# Milestone verification

Run `npm test` from `codex/` to check the goal model, workflow, storage and panel.
Run the filesystem event tests outside a sandbox that suppresses `fs.watch` or loopback listeners.
Run `npm run verify -- --apps` from `codex/` to check the thread entrypoint and HTML resource in a temporary project.
Open Milestone from `+` → `More tools…` → `Plugins and MCPs` in a Codex Desktop test chat.
Change a goal while the panel stays open.
Check that the panel updates without pressing refresh.
Close the tab.
Reopen it from the same menu and check that it shows the latest state.
Use two test projects to verify project isolation.

## Codex thread entrypoint, 2026-11-19

Passed all 49 automated tests.
Verified live event delivery and view teardown in the automated tests.
Verified that the app-server bundled with Codex Desktop discovers the installed 0.3.1 thread entrypoint.
Read the bundled HTML and called `open_app` with empty arguments through that app-server.
Verified that the regular package and the isolated test package read their respective projects.
Opened the native test tab from the menu in a chat that was already active before plugin installation.
Observed `unknown MCP server 'milestone_thread_check'` when the desktop tried to read the HTML and call the opening tool.
Restarted Codex and opened the test tab in the same chat.
Verified that the native view showed the isolated project's initial goal.
Observed that a test goal change did not refresh the 0.3.1 view.
Confirmed that Codex blocked loopback access from the sandbox and rejected the custom subscription URI.
Changed 0.3.2 to subscribe to the generated progress file through the host.
Passed all 50 automated tests and the isolated app-server check with 0.3.2.
Opened the 0.3.2 native tab after restarting Codex.
Confirmed that Codex rejected the local plugin's file subscription.
Changed 0.3.3 to wait for filesystem events through an app-only MCP tool.
Passed all 51 automated tests and the isolated app-server check with 0.3.3.
Verified that a pending tool call wakes after a separate MCP connection changes the project.
Verified that the panel cancels its wait on teardown in the automated test.
Installed 0.3.3 in the normal and isolated local packages.
Opened 0.3.3 from the native right-panel menu in the original Codex chat after restart.
Created goal 2 directly in the isolated project at 13:55:58.205 China Standard Time.
Observed the pending native `wait_panel` request finish at 13:55:58.339.
Observed the same panel automatically finish its next `read_panel` at 13:55:58.348.
Confirmed that the user saw the new goal in the open panel.
Observed Codex tear down the view at 13:56:27 and open a new view at 13:56:31.
Observed the old view stop renewing its wait.
Observed the last server wait expire after 25 seconds because the host did not forward cancellation.
Confirmed that the user saw the updated goal after reopening the panel.
Verified that the original project's `.goals/project.json` kept its pre-test SHA-256.

## File entrypoint removal, 0.3.4

Removed the Codex file entrypoint.
Stopped generating the progress file.
Passed all 50 remaining automated tests.
Verified that the installed plugin registers only the `thread` entrypoint in a fresh Codex app-server connection.
Verified that an independent project write still wakes the panel's pending MCP request.
Verified that the original project's `.goals/project.json` kept its pre-test SHA-256.
Use the 0.3.3 record for the desktop click-through.

## Antigravity feasibility check, 2026-11-19

Built the Codex and Antigravity 0.4.0 packages from the same sources.
Verified that the two packages contain byte-identical panel HTML.
Verified that Antigravity App 2.33.0 calls the Milestone MCP tool in an isolated workspace.
Observed Antigravity launch its MCP process with `/` as the working directory.
Passed an explicit `--project` path and used distinct server keys for the two isolated workspaces.
Observed Antigravity discover `open_app` with the documented `aux_pane` metadata.
Observed the host omit the MCP Apps capability during the legacy handshake and in a separate modern protocol probe.
Observed no Milestone entry in the right-panel menu in either probe.
Checked the published Google settings and MCP documentation for an MCP Apps enablement option.
Checked General, Advanced, and Application settings in the installed app.
Found no documented or visible switch for MCP Apps.
The MCP Apps probe did not reach desktop opening, closing, or automatic refresh in Antigravity.
Passed all 50 automated tests and the Codex app-server verifier with 0.4.0.
See the Sidecar desktop verification below for the subsequent Codex desktop test.

## Antigravity Sidecar desktop verification, 2026-11-19

Opened Milestone from the right-panel `+` menu and Extensions in Antigravity App 2.33.0.
Verified that an out-of-band write to workspace B appeared without a manual refresh.
Closed the tab and observed that its MCP child process exited after the visibility cleanup.
Reopened the tab and verified the latest goal remained visible.
Opened workspace A and verified that it displayed its own goals.
Compared the Codex and Antigravity `panel.html` files byte for byte.
Used the same isolated workspace B for both desktop tests.
Installed the temporary Codex 0.4.0 plugin `milestone-codex-qa@milestone-sidecar-check-local` for the desktop regression.
Confirmed the restarted Codex chat loaded the temporary MCP server.
Passed the 50 automated Codex tests and the 0.4.0 app-server check again after the Sidecar changes.
Verified that the Codex catalog launcher found the installed server and preserved the workspace.
Verified native Codex opening, automatic refresh, closing, and reopening with 0.4.0.
Observed the panel read the new state about 140 milliseconds after an independent write to workspace B.
Observed the closed view stop renewing its wait.
Observed the remaining wait expire after 25 seconds.
Published both packages to [qwang07/plugins](https://github.com/qwang07/plugins/commit/361a2cbad6482d02921a6033ab0ae64f198018de).
Installed Codex from the published catalog.
Verified that the catalog installation opens workspace A and workspace B independently in fresh Codex connections.
Verified that the installed Antigravity bundle matches the published bundle.
Removed the temporary Codex and Antigravity plugin entries after verifying the published installations.

## Historical verification records

Use the version listed in each record when interpreting its results.

## Codex plan-review verification, 2026-11-16

Run `node codex/verify.mjs --plan` with the 0.2.0 adapter.
Use an ephemeral Codex context and a temporary copy.

| Check | Result |
|---|---|
| The real model saves a one-task draft and stops | Passed |
| Goal Markdown remains unchanged before confirmation | Passed |
| No task output exists before confirmation | Passed |
| The test harness explicitly confirms the reviewed draft | Passed |
| The real model then claims and completes the task | Passed |
| The model checks the output and completes the goal | Passed |
| All seven original goals remain byte-identical | Passed |
| Draft replacement and external goal edits reject old confirmations | Passed through MCP tests |
| Paired goal/draft transaction recovery | Passed through storage tests |
| Panel review and start buttons in the desktop host | Unverified; no restart was performed |

The model evidence is `/private/var/folders/5m/pfrq2m_j2r946vgxzvyy2zpc0000gn/T/milestone-codex-probe-NdhiMv/verification.json`.
The temporary project contains `reviewed.txt` with the verified output.
The current Codex test suite contains eight protocol, storage and event tests.

## Codex real model verification, 2026-11-16

Run `node codex/verify.mjs --execute` with Codex CLI 0.169.0.
Use an ephemeral app-server context and a temporary project copy.
Keep the original project read-only.

| Check | Result |
|---|---|
| Claim T1 before performing work | Passed through the actual Codex model |
| Write and check first.txt | Passed |
| Pause while T1 is executing | T1 finished; T2 and T3 remained pending |
| Explicitly resume continuous execution | T2 and T3 completed with fresh execution tickets |
| Check final goal acceptance | The goal became done; three completion receipts were saved |
| Preserve the original project | All seven goal files remained byte-identical |
| Current desktop panel buttons and host message bridge | Unverified; the user deferred restarting the host |

The evidence is `/private/var/folders/5m/pfrq2m_j2r946vgxzvyy2zpc0000gn/T/milestone-codex-probe-g5ePS8/verification.json`.
The same temporary project contains the three output files and runtime receipts.
The model test does not establish desktop UI behavior.

## Structure checks

### MCP connection refresh check, 2026-11-16

Run an isolated Codex app-server with a temporary read-only MCP service.
Change the service's startup tool definition.
Call `config/mcpServer/reload`.
Observe that the existing idle connection retains its previous tool definition.
Create a second ephemeral context inside the same app-server process.
Observe that the new connection loads the updated tool definition.

This check demonstrates that a new connection can load updated code without restarting the app-server.
This check does not establish an in-place reconnect action for the desktop chat.
The current desktop chat still reported Milestone 0.1.0 during inspection.
The desktop host exposed no listening control socket for the external CLI proxy.
No current desktop process was restarted or terminated.
The evidence is `/private/var/folders/5m/pfrq2m_j2r946vgxzvyy2zpc0000gn/T/milestone-mcp-reload-0Rx3Oq/verification.json`.

## Codex What / How verification, 2026-11-17

Use the 0.3.0 project workflow for new Codex installations.
Treat the earlier 0.2.0 execution-loop records as historical evidence.
Run `node --test codex/workflow.test.mjs codex/events.test.mjs`.
Check explicit task assignment, evidence recording, cross-connection ownership, pause, blocked work and reassignment.
Check reviewed plan revisions preserve completed task identities and evidence.
Check cancellation cannot complete a goal without goal acceptance.
Check the panel through an actual desktop host after installation.
Desktop forwarding and the 0.3.0 real-model workflow remain unverified.

Passed eight project workflow and storage tests.
Passed the filesystem event test outside the macOS sandbox.
Verified 0.3.0 discovery and MCP Apps resources through an isolated Codex connection.
Verified the read-only layout and disclosures in a 420-pixel browser preview.
Confirmed all seven original goal files retain their SHA-256 values.
Use `/private/tmp/milestone-what-how-0.3.0/verification-summary.json` for this run's evidence.
The browser preview does not establish desktop subscription forwarding.

### Installed 0.3.0 connection, 2026-11-17

Updated `milestone-codex-probe@milestone-local-probe` with `codex plugin add`.
Verified the installed package reports version 0.3.0 through a fresh protocol connection.
Saved protocol evidence in `/var/folders/5m/pfrq2m_j2r946vgxzvyy2zpc0000gn/T/milestone-codex-probe-3a3hSt/verification.json`.
Corrected the installed verifier to allow previously completed tasks.
Confirmed the current desktop conversation subsequently returned version 0.3.0 from `open_app`.
Confirmed its tool inventory exposes `report_task` and omits `control_run`.
Did not restart the desktop application.
Created an isolated verification goal and saved its two-deliverable draft for review.
Actual desktop rendering and progress forwarding remain unverified.
Verify them after opening the panel and confirming the test draft through conversation.
Confirmed the seven original goal hashes remain unchanged.

### Conversation project routing, 2026-11-17

Changed the installed package from fixed verification paths to `--project .`.
Left the MCP working directory unset.
Verified Codex supplies different working directories for two temporary conversation contexts in the same app-server.
Verified the installed plugin reads each directory's own goal and project name.
Verified a third context in the first directory reads the first directory's goal.
Saved evidence in `/private/tmp/milestone-project-routing/installed-results.json`.
These checks use ephemeral protocol contexts without model turns or sidebar chats.
Existing desktop connections still require reconnection before using the new launch configuration.
Actual desktop project switching remains unverified.
Verify it by opening Milestone in conversations belonging to two different project directories.

### Visible panel synchronization, 2026-11-17

Confirmed the restarted desktop connection reads the actual `milestone-mod` directory.
Observed the desktop panel showing the manual-refresh fallback.
Removed the panel's dependency on a proxied `resources/subscribe` request.
Added visible-only reads at three-second intervals.
Added failure backoff, visibility resume and stale-response protection.
Passed all eleven workflow, filesystem event and panel synchronization tests.
Installed the rebuilt package with conversation-relative project routing.
Confirmed all seven original goal files retain their recorded hashes.
Desktop automatic updates remain unverified until the host loads the updated panel.
Reopen the panel and observe a project change without using its refresh button.

### Event-only correction, 2026-11-17

The user rejected timed reads and required event push.
Removed the three-second timer and automatic retry timer.
Reinstalled the event-only panel build.
Passed checks for idle silence, event-triggered reads and stale-response rejection.
The preceding polling implementation is superseded.
End-to-end desktop push remains unverified.
The MCP Apps resource subscription proposal is tracked at https://github.com/modelcontextprotocol/ext-apps/issues/659.

### Tool-result event candidate, 2026-11-17

Associated `manage_goal`, `start_task`, `report_task` and `finish_task` with the same panel resource URI as `open_app`.
Kept modification tools model-only.
Added a project-scoped `panelEvent` to successful transaction results.
Added one `read_panel` call on receipt of that event.
Preserved idle silence and stale-response rejection.
Passed four panel tests and eight workflow tests.
Installed the candidate package.
Observed the existing desktop panel without the new `data-sync-mode` marker.
Desktop event forwarding remains unverified until the user reconnects the host.
After reconnection, verify the marker and perform a test-only goal mutation without pressing refresh or reopening the panel.

### Desktop tool-result observation, 2026-11-17

Confirmed the open desktop panel has `data-sync-mode="tool-result-events"`.
Observed the initial empty current-goal section and `等待操作更新` status.
Called `manage_goal(action=create)` through the current conversation.
Created goal 8, `验证工具结果触发面板更新`.
Received the successful `project-changed` event with the current project path and committed revision.
Observed the same open panel after the call without clicking refresh or changing visibility.
The panel still displayed no current goal and `等待操作更新`.
Confirmed only one MCP Apps panel instance was present.
The new goal title was absent from its DOM.
The existing panel did not automatically update during this observation.
Do not claim that sharing a resource URI guarantees tool-result forwarding to an existing panel.
Turn-end delivery remains unverified.
Retained the test goal for a subsequent observation.
Confirmed all seven original goal files retain their recorded hashes.

### Event routing investigation, 2026-11-17

Observed goal 8 in the panel on the following turn, with status `等待操作更新` and the refresh button focused.
Do not attribute that appearance to tool-result delivery; manual refresh and visibility reads were not excluded between turns.
Changed only goal 8 from `idea` to `planning` through `manage_goal`.
Returned the complete tool result to eliminate abbreviated output as the sole explanation.
Observed the existing panel still displaying `待规划` and `等待操作更新` after the call.
The tools sharing a UI resource did not update the existing view in either observed mutation.
The standard describes tool-result delivery for a tool's associated view; it does not specify broadcast to every existing view using the same resource.
Reference: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
The installed AppBridge SDK exposes host-side `sendToolResult`; the MCP server does not own that host bridge.
The server currently declares an empty `connectDomains` list.
A separate SSE or WebSocket connection requires an explicitly declared endpoint and host permission to reach it.
Reference: https://apps.extensions.modelcontextprotocol.io/api/documents/Patterns.html#configuring-csp-and-cors
A loopback SSE connection is a candidate, not a verified desktop capability.
Verify a single connection and a server-triggered event in the actual MCP Apps sandbox before integrating it with project data.
Do not replace event push with polling or artificial resource-list-change notifications.
