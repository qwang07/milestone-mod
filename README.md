# Milestone

Manage project goals, deliverables and progress through conversation. Open the read-only panel from the right-panel `+` menu in Codex Desktop and Antigravity, or with `/milestone-panel` in Claude Code. See the [Codex guide](codex/README.md), the [Antigravity guide](antigravity/README.md) and the [Claude Code guide](claude/README.md).

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

## Publish a version

Push the release commit to `main`.
Create a version tag in the form `vMAJOR.MINOR.PATCH` on that commit.
Push the tag.

```sh
git tag v0.4.1
git push origin v0.4.1
```

Check the [Publish Milestone plugin workflow](https://github.com/qwang07/milestone-mod/actions/workflows/publish-plugin.yml).
GitHub Actions takes the package version from the tag.
GitHub Actions tests the tagged source and builds the Codex, Antigravity and Claude Code packages.
GitHub Actions updates the [`plugin` branch](https://github.com/qwang07/milestone-mod/tree/plugin/plugins/milestone) in one commit after all packages pass validation, together with the Claude Code marketplace file.
Run the workflow manually to test and build without publishing.
