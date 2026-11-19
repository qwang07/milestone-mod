---
name: milestone
description: Initialize Milestone in the current project (“初始化 Milestone”), open its progress viewer, and manage project goals and deliverables.
---

Milestone records WHAT the project must deliver. The conversation manages HOW to deliver it.
For “初始化 Milestone” or “打开 Milestone”, use the project file viewer.
Initialization uses the existing project store: an empty project starts with zero goals, and an existing project retains its recorded plan. Create a goal only when the user supplies one.
Resolve the calling project's working directory. Before opening the viewer, verify the returned file belongs to that project.
Call list_goals(dataset=project) to ensure the current project's progress file exists.
Pass its absolute progressFile to mcp__codex_app__open_in_codex with target.type="file" and placement="right" in the calling thread.
For migrated projects, open .goals/progress.milestone under the current project working directory. If an old connection returns the legacy path, use the migrated file and reconnect the plugin before writing.
Use this file-opening flow instead of the legacy open_app and open_panel tools. Do not ask the user to locate the file.
Read list_goals(dataset=project) before updating project state.
Use project tasks for independently verifiable deliverables, not commands, files to read or implementation steps.
Use the host's conversation planning tools for implementation steps when available.
Never duplicate those steps into the project task list.

Discuss goals and acceptance through conversation.
Record an agreed project goal with manage_goal(action=create).
Save proposals with manage_goal(action=propose); show the proposal in the conversation and wait for confirmation.
Read and supply an existing draftId before replacing a proposal.
Confirm the reviewed draft with manage_goal(action=plan, draftId=..., confirmed=true).
Treat “the plan is fine” as plan confirmation only.
Treat “do it according to this plan” as confirmation and authorization to work within that scope.

Focus a goal only when the user asks to start or switch it.
Claim the authorized project task with start_task(id, task, revision) before work.
Keep the returned runId for reporting results.
Organize implementation, tools and verification in the conversation.
Milestone does not schedule turns, send execution prompts or automatically start another task.
Complete additional project tasks only when the user authorized that broader scope.

Finish a task only after checking acceptance, with a concrete summary and evidence.
Check the whole goal before finishing its last remaining task; supply goalAcceptanceChecked=true.
Record a normal pause or handoff with report_task(action=pause) after stopping current work.
Record an actual obstacle with report_task(action=block, reason=...). Do not mark failed work complete.
A tool records state; it cannot interrupt an already running external command.
Before resuming an interrupted assignment, inspect the work and verify the previous conversation stopped.
Use report_task(action=resume, confirmed=true) only after explicit user confirmation.
Never take over a running assignment automatically.

For changes to scope, deliverables or acceptance, discuss a revised project plan.
Pause current work before confirming a revision.
Supply all existing tasks with their n identifiers in a revised draft.
Keep completed and cancelled tasks unchanged. Preserve existing task order. Append new tasks without n.
Cancel unwanted pending tasks explicitly with manage_goal(action=skip, id, task, confirmed=true).
Cancellation does not complete the goal. Use action=done only after checking goal acceptance, with evidence and goalAcceptanceChecked=true.
Routine implementation choices do not require a project plan revision.

Use the panel only to inspect goals, tasks, progress and results.
Stop and explain tool refusals; never bypass them or directly edit .goals or .milestone-runtime.
