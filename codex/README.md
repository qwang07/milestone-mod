# Milestone for Codex

Manage project plans through conversation.
Use Milestone for project goals, deliverables, acceptance and progress.
Use the conversation for implementation steps and execution.
Ask Codex to open Milestone to view the current project’s progress file in the right panel.

## Workflow

1. Discuss a goal and its acceptance in the conversation.
2. Save a plan draft with `manage_goal(action=propose)`.
3. Present the draft in the conversation.
4. Save the reviewed draft after user confirmation.
5. Claim an authorized project task with `start_task`.
6. Organize implementation steps in the conversation.
7. Record the result and evidence with `finish_task`.

Treat plan confirmation separately from authorization to work.
Accept a single instruction that explicitly confirms and starts the plan.
Continue to other project tasks only within the user's authorized scope.
Milestone does not schedule model turns or generate execution prompts.

Record normal pauses with `report_task(action=pause)`.
Record obstacles with `report_task(action=block)` and a concrete reason.
Inspect unfinished work before resuming it.
Verify that the previous conversation stopped before confirming a reassignment.
State reporting does not interrupt external commands.

## Plan changes

Propose revisions through the same draft review process.
Retain every existing task with its `n` identifier.
Preserve completed and cancelled tasks unchanged.
Preserve existing task order.
Append new tasks without `n`.
Cancel unwanted pending tasks explicitly before revising the plan.
Confirm a revised plan only after current work has stopped.
Reject stale drafts and changed goal content.
Require goal acceptance evidence when completing a goal after cancellation.

## Tools

| Tool | Purpose |
|---|---|
| `open_app` | Open the legacy conversation card |
| `list_goals` | Read project plans, drafts and assignments |
| `manage_goal` | Record, propose, confirm, revise, focus, cancel and reorder project work |
| `start_task` | Claim an explicit project task |
| `report_task` | Record pause, obstacle or confirmed reassignment |
| `finish_task` | Save an accepted deliverable and evidence |
| `read_panel` | Read display data for the panel |
| `open_panel` | Open the legacy read-only diagnostic view |

## Panel

Show the current project goal and its completed task count.
Show deliverable titles and statuses beneath it.
Highlight the task in progress in blue.
Show other goals below the current goal.
Collapse completed and cancelled goals.
Expand a goal or task to inspect acceptance, plans and evidence.
Do not count cancelled tasks as completed tasks.
Keep project paths and execution controls out of the normal view.

Accept host tool-result updates and forwarded resource notifications.
Associate each model-only modification tool with the panel's resource URI.
Return a `panelEvent` only after a successful transaction.
Read `read_panel` once when the panel receives that result through `ontoolresult`.
Ignore failed results and results from another project.
Do not generate a change event from `read_panel`.
Preserve expanded task details during background updates.
Do not poll or retry reads on a timer.
Read once when opening the panel or returning to it.
Read after a forwarded resource event or an explicit refresh request.
Show an honest disconnected status when the host rejects resource subscriptions.
Show `等待操作更新` before receiving the first successful tool event when resource subscriptions are unavailable.
Do not claim live push delivery based on service-side notifications alone.
Verify desktop forwarding by changing a task with the panel open.
Check that the panel updates without pressing refresh.

## Storage and compatibility

Use the conversation working directory as the project directory.
The standard package launches with `--project .` and no fixed MCP working directory.
Codex supplies the working directory when it creates the conversation's MCP connection.
Read the panel name from that directory's basename.
Share goals and progress between conversations using the same directory.
Keep different directories isolated, including separate Git worktrees.
Do not reuse a fixed `--source` / `--scratch` verification package for normal project work.
Existing connections retain their original directory until Codex reconnects them.

Store goals, drafts and execution records in `.goals/project.json`.
Open the generated `.goals/progress.milestone` for live updates.
Find original migration inputs in `.milestone-runtime/before-project-json/`.
Preserve the shared lock, revision checks and transaction recovery.
Treat assignment identifiers as internal concurrency protection.
Do not automatically take over legacy queued or running assignments.
Use explicit reassignment after verifying the previous executor stopped.

The Claude adapter retains its existing execution behavior.
The shared goal format remains compatible.
The Claude CLI adapter uses the shared writer for migrated projects.

## Build and verify

Use Node.js 22.18 or later.
Run these commands from `codex/`:

```sh
npm ci
npm test
npm run build -- --out /absolute/path/to/package
npm run verify -- --apps
```

Run filesystem event checks outside a sandbox that suppresses `fs.watch`.
Use `prepare-plugin.mjs` to generate an isolated local marketplace.
Inspect the returned project path before writing test data.
Keep original project goals read-only during verification.

Version 0.3.0 removes `control_run` and the 0.2 model execution loop.
Use the packaged `SKILL.md` for the conversation workflow.
The earlier real-model execution evidence applies only to 0.2.0.
Existing desktop connections retain their loaded service and panel.
Verify the version returned by a fresh connection after updating the package.
Do not infer a loaded version from files on disk.
