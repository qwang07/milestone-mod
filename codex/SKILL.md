---
name: milestone
description: Initialize Milestone in the current project (“初始化 Milestone”), view progress, and manage project goals and deliverables.
---

Milestone records WHAT the project must deliver. The conversation manages HOW to deliver it.
Open the persistent panel from `+` → `More tools…` → `Plugins and MCPs` → `Milestone` in the right panel.
Use `open_app` when the user wants to see Milestone in the conversation.
Initialize the current project by calling `list_goals(dataset=project)`.
Create a goal only when the user supplies one.
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
