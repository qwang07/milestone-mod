# milestone

A Claude Code plugin: a goal pool inside the project, in place of GitHub issues / milestones.

Record a goal, plan it with Claude, split it into sub-goals or tasks, then work through it one task at a time. Progress shows live in a side panel, and a new session picks up where the last one left off. The data is plain Markdown under the project's `.goals/`, so it can go into git.

## Concepts

Issues, goals and milestones are one thing here: a **goal**.

- A goal can sit under another goal, to any depth.
- A goal is split one of two ways: into **sub-goals** (like a milestone, its progress is its sub-goals'), or into **tasks** (run one at a time).
- At most one goal is active at a time.

## Goal status

| Value | Meaning |
|---|---|
| `idea` | Just recorded, no plan yet |
| `planning` | Being planned with Claude |
| `planned` | Plan confirmed and split |
| `active` | Its tasks are being run; at most one in the project |
| `done` | |
| `dropped` | |

## Goal files

One file per goal: `.goals/<id>.md`, where `id` is a positive integer; a new goal takes the highest one plus 1.

```markdown
---
id: 12
title: CSV export
status: active
parent: 3
split: tasks
created: 2026-10-11
---
## Description
## Acceptance
## Approach
## Decisions
## Tasks
- [x] T1 | Define the export fields | acceptance: field list confirmed
- [~] T2 | Stream the output | acceptance: 100k rows under 200MB of memory
- [ ] T3 | Encoding and BOM | acceptance: opens in Excel without garbled text
```

- Frontmatter keys: `id`, `title`, `status`, `parent` (the parent goal's id, empty at the top level), `order` (optional: its place among its siblings), `split` (empty, `tasks` or `goals`), `created` (`YYYY-MM-DD`).
- Siblings show in `order`. A group never reordered has no `order` and shows in creation order; the first reorder sets `order` on every goal in the group, and a goal added later goes last.
- The body has the level-two headings above, in that order; `## Tasks` appears only with `split: tasks`.
- A task line: `- [<mark>] T<n> | <title> | acceptance: <text>`. Marks: `[ ]` to do, `[~]` in progress, `[x]` done, `[-]` skipped; numbers run from T1 without gaps.
- Sub-goals are not listed in the parent's file; a sub-goal's `parent` places it.
- Files can be edited by hand. A file that cannot be read is flagged in the panel with the reason, and tools and commands refuse to change it until it is fixed.
- Files written by earlier versions, with Chinese headings (`## 描述`, `## 验收标准`, `## 方案`, `## 已定决策`) and `| 验收: ` in task lines, are read as well; the next write puts them in English.

## Rules

The plugin checks every change first, and refuses one that breaks a rule, with the reason:

1. At most one goal in the project is `active`, and its `split` is `tasks`.
2. At most one task of a goal is `[~]`.
3. `split` is set when the goal is split and never changes; a `split: tasks` goal cannot have sub-goals. Recording a sub-goal under a goal not yet split sets its `split` to `goals`.
4. A goal split into tasks completes on its own when its last task ends (`[x]` or `[-]`). A goal split into sub-goals is completed with `/ms-done` once all its sub-goals are done or dropped.
5. A sub-goal's `parent` is set when it is created and never changes.

## Commands

Commands take effect at once and don't take Claude's turn; those marked "starts a turn" submit a prompt that starts a new turn for Claude. `<goal>` is a number (`12` or `#12`) or part of a goal's title, case ignored (`/ms-done csv export`); a whole title wins over titles that only contain it, and when several goals match the command lists them instead of guessing. Dropped goals are matched by number only.

| Command | What it does | |
|---|---|---|
| `/ms-new <title> [--under <goal>]` | Record an idea | |
| `/ms-plan <goal>` | Set it to planning and ask Claude for a plan and split | starts a turn |
| `/ms-focus <goal>` | Make it active; the previously active goal goes back to planned | |
| `/ms-next` | Run the active goal's next task (the `[~]` one first), then stop | starts a turn |
| `/ms-auto [n\|all]` | Run n tasks one after another; all when n is left out | starts turns |
| `/ms-skip` | Mark the current task skipped | |
| `/ms-add <description>` | Ask Claude to propose a task; it is written only once you agree | starts a turn |
| `/ms-done [goal]` | Complete a goal split into sub-goals; the active goal when none is named | |
| `/ms-drop <goal>` | Drop it | |
| `/ms-status` | Text overview | |
| `/ms-panel` | Open the panel | |

`/ms-focus`, `/ms-done` and `/ms-drop` stop a running auto. You can also just tell Claude "start #12" or "switch to #12", which does what `/ms-focus` does; the first also goes on to the first task.

## auto mode

Each turn runs one task. When a turn ends with that task `[x]`, runs left and tasks to do, the next one is submitted. It stops, with a notification saying why, when:

- the task did not become `[x]` (its check failed, Claude stopped to ask you, or you sent something else in between);
- the turn was interrupted or failed;
- no runs are left;
- the active goal's tasks have all ended; the goal is then done. Claude checks the goal's acceptance criteria before finishing the last task.

The number of runs left lasts for the current session; a new session starts back in step mode.

## Tools Claude uses

Claude does not edit files under `.goals/` directly, only through the tools the plugin registers:

| Tool | What it does |
|---|---|
| `mcp__milestone__create_goal` | Record an idea, optionally under a parent goal |
| `mcp__milestone__plan_goal` | Write the description, acceptance criteria, approach, decisions and split (tasks or sub-goals), and set it to planned; called only once you clearly confirm the plan |
| `mcp__milestone__focus_goal` | Make a goal active, as `/ms-focus` does; called only when you clearly say to start or switch to a goal |
| `mcp__milestone__move_goal` | Move a goal among its siblings, before another or to the end; called when you ask to reorder |
| `mcp__milestone__start_task` | Mark one of the active goal's tasks `[~]` |
| `mcp__milestone__finish_task` | Mark the `[~]` task `[x]`; called only after its check passes. The last task completes the goal, so its check covers the goal's acceptance criteria too |
| `mcp__milestone__add_task` | Add a task; called only once you agree |

The prompts the plugin submits to Claude all start with `[milestone]`: `plan #N`, `run #N T<k>`, `add task #N: …`. The `milestone` skill (`skills/milestone/SKILL.md`) says what Claude does with each.

## The panel

The top half is the goal tree, by title alone; goal numbers are not shown. Each row has one label on the right: `idea`, `planning` or `planned` until the goal is active; `k/n` while it is active, k the task in progress or next (so `3/3` means the last task is under way); `done` once it is done. A goal split into sub-goals shows its status; its sub-goals show their own progress. The active goal is highlighted. The bottom half is the active goal's acceptance criteria and tasks. The panel rereads `.goals/` every 5 seconds, so several sessions on one project stay in sync.

The order of goals under the same parent is yours to set: tell Claude ("move CSV export before Import", "put Import last"), or, in the terminal and the desktop app, drag it in the panel. The pointer on a row shows a `⠿` handle; press, drag and the row moves among its siblings as you go, its sub-goals with it; let go and the new order is written to the goal files. A drag stays within its sibling group; moving a goal under another parent is not supported. Other surfaces (the phone app) show the tree without dragging. Apart from that the panel only shows; it changes nothing.

When a session starts with an active goal, the plugin only asks for the panel to open and submits no prompt to Claude, so it never cuts into the conversation (a session reopened after a long idle included). Watch progress in the panel, or send `/ms-status` (no model involved); for a summary from Claude, just ask. It opens once per session, and only where there is an interface: an interactive terminal session, or one with an interface at its start, opens it at the start; any other session opens it when its first interface attaches, and not again on a later one (a phone connecting remotely, say). A headless session (`claude -p`, the SDK) never opens it. Claude Code places such a panel on its own only in a terminal at least 144 columns wide; where it doesn't fit, a notification says so, and `/ms-panel` opens it by hand at any width.

## Safety

The plugin reads and writes only files named `<digits>.md` in `.goals/` at the project root, judged by their resolved real path. It makes no network calls, reads no environment variables, starts no processes and reads no transcripts.

## Install

In Claude Code (2.1.275 or later), one step, for the terminal and the desktop app alike:

```
/plugin install milestone --marketplace qwang07/milestone-mod
```

This repository is also a plugin folder, so a clone loads as it is (use one or the other, not both):

- To try it once: `claude --plugin-dir /path/to/milestone-mod`
- To keep it (desktop app included): add this folder's absolute path to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

In each project that uses it, append [`CLAUDE.md.snippet`](CLAUDE.md.snippet) to the project's CLAUDE.md. `.goals/` is created when the first goal is recorded. Claude Code's own Task tools are not needed.

## Checks

- `claude plugin validate .`: the plugin's structure and what the engine would refuse.
- `claude plugin test .`: the cases in `tests/*.test.ts`.
- End to end: walk through [`VERIFY.md`](VERIFY.md) in a scratch project.
