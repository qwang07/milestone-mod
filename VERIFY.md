# End-to-end check

Walk milestone through a real session in a scratch project. Each step says how to tell it passed.

## Setup

```bash
mkdir -p /tmp/ms-trial && cd /tmp/ms-trial && git init -q
cat /path/to/milestone-mod/CLAUDE.md.snippet >> CLAUDE.md
claude --plugin-dir /path/to/milestone-mod
```

## Steps

| # | Do | Passes when |
|---|---|---|
| 0 | `/ms-status` | It answers "No goals yet"; command completion lists the 12 `/ms-*` commands |
| 1 | Ask Claude "which milestone tools do you have" | It lists the 8 `mcp__milestone__*` tools without a tool search (`isDeferred: false` works) |
| 2 | `/ms-new add a hello script to the project` | `.goals/1.md` appears with `status: idea` |
| 3 | `/ms-plan 1` | 1.md turns `status: planning`; Claude proposes a plan and waits; `git status` shows no file changed but `.goals/1.md` |
| 4 | Reply "confirmed" | Claude calls `plan_goal`; 1.md has `status: planned` and numbered tasks under `## Tasks` |
| 5 | `/ms-focus 1` | The panel opens with `▶ #1` highlighted, its tasks below |
| 6 | `/ms-next` | Claude does T1 only, `start_task` → check → `finish_task`, reports and stops; T1 is `[x]` in 1.md and in the panel |
| 7 | Note whether the first tool call asks for permission | Record the result; if it asks, record the allow rule needed |
| 8 | Leave the session and start `claude --plugin-dir …` again in the same folder | The panel opens by itself; Claude says nothing and waits |
| 9 | `/ms-auto 2` | Two tasks run back to back, then it stops with a notification: "no runs left" or "the goal is done" |
| 10 | `/ms-add a check that fails`, agree, then `/ms-next` it with an acceptance that cannot pass (say "the command `false` exits 0") | 1.md is unchanged before you agree; afterwards Claude does not call `finish_task`; under `/ms-auto` the notification says "T<k> was not finished" and nothing more is submitted |
| 11 | Finish or `/ms-skip` the last task | 1.md turns `status: done` without `/ms-done`; the panel shows `done` |
| 12 | `/ms-new sub-goal --under 1` | Refused (#1 is split into tasks); after `/ms-new parent`, `/ms-new child --under <its number>` works and the parent has `split: goals` |
| 13 | Break a goal file by hand (say `status: open`) | The panel and `/ms-status` flag "Cannot read" with the reason; commands on it are refused and the file is left as it is |
| 14 | Start a second session on the same project in another terminal and `/ms-new A` there | The first session's panel shows A within 5 seconds |
| 15 | Record three goals, then tell Claude "move the third before the first" | Claude calls `move_goal`; the panel and `/ms-status` show the new order; each file has `order:` |
| 16 | In the panel (terminal or desktop app), point at a row, then drag it above its first sibling | A `⠿` handle shows on the row under the pointer; the row moves as you drag, only among its siblings; after letting go the order stays and the files' `order:` match it |
| 17 | Click Keep going, then Pause after task | The current task finishes; no following task starts; the panel shows the stop reason |
| 18 | Click Next task | One task runs; continuation stops after its turn |
| 19 | Ask Claude to continue for one task | Claude calls `control_run` with action `continue` and count 1; one scheduled task runs |

## Record

v0.1.0, 2026-10-11, Claude Code 2.1.295 / 2.1.296, macOS.

| Item | Result | Evidence |
|---|---|---|
| Permission prompt on the first tool call | None in auto mode | Session `permissionMode: "auto"`; `plan_goal` and `start_task` went straight through. "Ask every time" mode not tested |
| Panel sync across two sessions | In sync | After `/ms-new` in a second session (`claude -p`), the first session's panel showed the new goal; the goal later `/ms-drop`ped had `status: dropped` |
| Commands Claude names in a new session | Accurate | A new session named `/ms-new`, `/ms-plan`, `/ms-focus`, `/ms-next` in turn; the commands it mentioned were exactly the 11 real ones |
| Panel notice in a narrow terminal | Shown | In a terminal about 50 columns wide, reopening a session with an active goal showed the notification pointing to `/ms-panel` |

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

### Local terminal verification, 2026-11-16

Run Claude Code 2.1.325 in a real interactive terminal at 180 columns and 48 rows.
Load this checkout with `--plugin-dir`.
Use an isolated temporary project with one active goal and three pending tasks.

| Check | Result |
|---|---|
| Load the plugin and render the goal panel | Passed |
| Click Next task | Submitted the task prompt |
| Click Keep going | Submitted the task prompt in automatic mode |
| Handle a failed model request | Stopped execution and displayed `Stopped: the turn failed` |
| Run `/ms-pause` | Displayed `Stopped: paused by the user` |
| Preserve the original project goals | All seven file hashes remained unchanged |
| Complete a task and continue automatically | Blocked by Claude subscription rejection |
| Click Pause after task during task execution, then resume | Unverified; requires a successful model request |
| Operate the native desktop panel | Unverified |

Claude rejected the model requests because it could not use the current subscription.
The response suggested renewing billing or using an Anthropic API key.
The exact account cause remains unverified.
Check the account's subscription status before repeating the model checks.
All three fixture tasks remained pending.
No fixture output files were created.

The temporary project is `/private/var/folders/5m/pfrq2m_j2r946vgxzvyy2zpc0000gn/T/milestone-live-check-qqlwzp6g`.
The project contains `live-verification.json` with the recorded checks.
The local debug log is `/private/tmp/milestone-live-unsandboxed.log`.

### Commands

```bash
claude plugin validate /path/to/milestone-mod
claude plugin test /path/to/milestone-mod
```

validate passes; every test passes.

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
