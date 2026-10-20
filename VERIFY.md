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
| 0 | `/ms-status` | It answers "No goals yet"; command completion lists the 11 `/ms-*` commands |
| 1 | Ask Claude "which milestone tools do you have" | It lists the 7 `mcp__milestone__*` tools without a tool search (`isDeferred: false` works) |
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

## Record

v0.1.0, 2026-10-11, Claude Code 2.1.295 / 2.1.296, macOS.

| Item | Result | Evidence |
|---|---|---|
| Permission prompt on the first tool call | None in auto mode | Session `permissionMode: "auto"`; `plan_goal` and `start_task` went straight through. "Ask every time" mode not tested |
| Panel sync across two sessions | In sync | After `/ms-new` in a second session (`claude -p`), the first session's panel showed the new goal; the goal later `/ms-drop`ped had `status: dropped` |
| Commands Claude names in a new session | Accurate | A new session named `/ms-new`, `/ms-plan`, `/ms-focus`, `/ms-next` in turn; the commands it mentioned were exactly the 11 real ones |
| Panel notice in a narrow terminal | Shown | In a terminal about 50 columns wide, reopening a session with an active goal showed the notification pointing to `/ms-panel` |

## Structure checks

```bash
claude plugin validate /path/to/milestone-mod
claude plugin test /path/to/milestone-mod
```

validate passes; every test passes.
