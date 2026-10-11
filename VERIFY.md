# 端到端验证

在一个临时项目里，用真实会话把 milestone 走一遍。每一步写明怎么判定通过。

## 准备

```bash
mkdir -p /tmp/ms-trial && cd /tmp/ms-trial && git init -q
cat /path/to/milestone-mod/CLAUDE.md.snippet >> CLAUDE.md
claude --plugin-dir /path/to/milestone-mod
```

## 步骤

| # | 操作 | 通过的判定 |
|---|---|---|
| 0 | `/ms-status` | 回复「还没有目标」；命令补全里能看到 `/ms-*` 共 11 个 |
| 1 | 问 Claude「你有哪些 milestone 工具」 | 不经工具搜索就能列出 5 个 `mcp__milestone__*`（验证 `isDeferred: false` 生效） |
| 2 | `/ms-new 给项目加一个 hello 脚本` | 生成 `.goals/1.md`，`status: idea` |
| 3 | `/ms-plan 1` | 1.md 变为 `status: planning`；Claude 给出方案后停下等待；`git status` 显示除 `.goals/1.md` 外没有文件被改 |
| 4 | 回复「确认」 | Claude 调用 `plan_goal`；1.md 为 `status: planned`，`## Tasks` 下有编号连续的 task |
| 5 | `/ms-focus 1` | 面板打开，`▶ #1` 高亮，下方列出 tasks |
| 6 | `/ms-next` | Claude 只做 T1，`start_task` → 自检 → `finish_task`，汇报后停下；1.md 中 T1 为 `[x]`，面板同步 |
| 7 | 记下第一次调用工具时是否弹权限确认 | 记录结果；如果弹，记下需要的允许规则 |
| 8 | 退出会话，在同一目录重新 `claude --plugin-dir …` | Claude 先发一段不超过五句话的汇报，然后停下等待 |
| 9 | `/ms-auto 2` | 连续做完两个 task 后停下，弹出通知「次数用完」或「task 已全部结束」 |
| 10 | `/ms-add 写一个失败的检查`，同意后用 `/ms-next` 执行它，并让验收标准故意无法满足（例如「命令 `false` 退出码为 0」） | 同意前 1.md 不变；执行后 Claude 不调用 `finish_task`；再用 `/ms-auto` 时通知「T<k> 没有完成」，不再提交下一步 |
| 11 | `/ms-done` | 还有未结束 task 时被拒绝并列出编号；`/ms-skip` 后 `/ms-done` 成功，`status: done` |
| 12 | `/ms-new 子目标 --under 1` | 被拒绝（#1 已拆成 tasks）；`/ms-new 父目标` 后再 `/ms-new 子 --under <新编号>` 成功，父目标 `split: goals` |
| 13 | 手动把某个目标文件改坏（例如 `status: open`） | 面板和 `/ms-status` 标出「无法解析」及原因；对它的命令被拒绝，文件未被改写 |
| 14 | 另开一个终端在同一项目启动第二个会话，在其中 `/ms-new 甲` | 第一个会话的面板在 5 秒内出现 #甲 |

## 结构检查

```bash
claude plugin validate /path/to/milestone-mod
claude plugin test /path/to/milestone-mod
```

validate 通过；test 全部通过。
