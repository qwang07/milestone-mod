---
name: milestone
description: The project goal pool protocol. Use when the user brings up a new problem, need, goal or milestone (anything with several steps), when a prompt starts with "[milestone]", or when .goals/, /ms- commands, goals or tasks come up. Says how to record goals, plan them, split them and run their tasks one at a time.
---

# milestone protocol

The project's goals live in `.goals/<id>.md`. Issues, goals and milestones are all "goals"; a goal is split one of two ways: into sub-goals, or into tasks.

## Ground rules

- **Change goals only through the tools**: `mcp__milestone__create_goal`, `plan_goal`, `focus_goal`, `move_goal`, `start_task`, `finish_task`, `add_task`. Don't edit files under `.goals/` with Edit/Write, and don't track these goals' tasks with TaskCreate/TodoWrite. Reading the files is fine.
- When a tool refuses, tell the user the reason as given; don't work around it.
- Talking to the user, name a goal by its title; the panel and `/ms-status` show no numbers. Numbers stay for tool calls and commit messages.
- One task per turn: move one task forward each turn, and end the turn when it is done.

## The user's commands

The user types these slash commands; they don't take your turn. When you suggest a next step, use their exact names:

| Command | What it does |
|---|---|
| `/ms-new <title> [--under <goal>]` | Record an idea |
| `/ms-plan <goal>` | Ask you to plan and split a goal |
| `/ms-focus <goal>` | Make a planned goal that is split into tasks the active goal |
| `/ms-next` | Ask you to run the active goal's next task |
| `/ms-auto [n\|all]` | Run tasks one after another, stopping at the first failure |
| `/ms-skip` | Skip the current task |
| `/ms-add <description>` | Ask you to propose a new task |
| `/ms-done [goal]` | Complete a goal split into sub-goals (a goal split into tasks completes when its last task ends) |
| `/ms-drop <goal>` | Drop a goal |
| `/ms-status`, `/ms-panel` | Text overview, open the panel |

`<goal>` is a number or part of the goal's title, so suggest commands with the title (`/ms-done csv export`).

Order: once its plan is confirmed a goal is planned; it must become active (the user says "start #N", or sends `/ms-focus <goal>`) before its tasks run. Only the active goal's tasks can start.

## A new goal

When the user brings up a new problem or a goal with several steps: record it with `create_goal` (status idea), tell the user its number, and ask whether to plan it now. A simple one-step request is just done, not recorded.

## Planning (`[milestone] plan #N`, or the user asks for a plan)

1. Read `.goals/N.md` and the code involved. This stage is **read-only**: call no tool that changes a file.
2. Propose: a description, acceptance criteria (checkable), an approach, the decisions made, and a split: into tasks (each with a title and an acceptance) or into sub-goals. Name the risks and the open questions.
3. Revise with the user until they **clearly confirm**. No `plan_goal` without that confirmation.
4. Once confirmed, call `plan_goal`. For a split into tasks, tell the user to say "start #N" or send `/ms-focus N`; for a split into sub-goals, tell them to `/ms-plan` each sub-goal.

## Making a goal active (the user says "start #N", "switch to #N" and the like)

Call `focus_goal` only when the user **clearly asks** to start or switch to a goal; never because you think it is time, and never in passing while running a task. The previously active goal goes back to planned, and any auto run stops.

- The user wants to start working ("start #N", "do #N"): after `focus_goal`, run the next task in the same turn as "Running a task" says.
- The user only wants to switch ("switch to #N", "make #N current"): after `focus_goal`, report the result and start no task.

## Reordering (the user says "move X before Y", "put X last" and the like)

Call `move_goal` with the goal and the sibling to put it in front of, or no `before` to put it last. Only goals under the same parent can be reordered; to move a goal under another parent, say it can't be done yet.

## Running a task (`[milestone] run #N T<k>`)

1. `start_task` to mark it started.
2. Do this one task. Before anything risky (deleting, overwriting, force-pushing, migrating a database, sending something out), stop and ask.
3. Check the task against its acceptance point by point, with evidence (commands and their output).
4. Passed → `finish_task`. Failed → no `finish_task`; say where it failed.
5. Report: what you did, how the check went, which task is next; then end the turn.
6. If something comes up that the plan doesn't cover, stop and say so; don't widen the scope on your own.
7. The goal completes when its last task ends, so for the last task step 3 also checks the **goal's** acceptance criteria point by point; if they don't pass, don't call `finish_task`. Report the result of each.

## Adding a task (`[milestone] add task #N: …`)

Propose the task's title and acceptance, and call `add_task` only after the user agrees.
