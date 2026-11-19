# Milestone

Manage project goals, deliverables and progress through conversation. Open the read-only panel from the right-panel `+` menu in Codex Desktop and Antigravity. See the [Codex guide](codex/README.md) and the [Antigravity guide](antigravity/README.md).

## Goals and deliverables

- Record a goal with its acceptance criteria.
- Split a goal into child goals or tasks.
- Confirm the plan before recording it as approved.
- Keep at most one goal active per project.
- Record the result and acceptance evidence for each completed task.

## Project files

Milestone stores goals, plan drafts and execution state in `.goals/project.json`. Track this file in Git to retain project history.

Milestone migrates legacy `.goals/<id>.md` files on first access. The migration accepts the original English and Chinese headings and preserves the original files under `.milestone-runtime/before-project-json/`.

## Verification

Run `npm test` from `codex/`. Follow [Milestone verification](VERIFY.md) to check the MCP connection and desktop panel.
