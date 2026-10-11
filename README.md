# milestone

Claude Code 插件：项目里的目标池，用来代替 GitHub issue / milestone。

记下一个目标，和 Claude 一起找方案、拆成子目标或 tasks，然后一个 task 一个 task 地做。进度在侧边面板里实时可见；换了会话也能接着做。数据就是项目 `.goals/` 下的 Markdown 文件，可以进 git。

## 概念

issue、goal、milestone 在这里是同一种东西：**目标**。

- 目标可以挂在另一个目标下面，层级不限。
- 拆解时二选一：拆成**子目标**（像 milestone，进度由子目标汇总），或拆成 **tasks**（可以逐个执行）。
- 同一时刻只有一个目标处于「执行中」。

## 目标的状态

| 值 | 显示 | 含义 |
|---|---|---|
| `idea` | 想法 | 刚记下，还没有方案 |
| `planning` | 找方案 | 正在和 Claude 讨论方案 |
| `planned` | 已计划 | 方案已确认，已拆解 |
| `active` | 执行中 | 正在执行它的 tasks；全项目至多一个 |
| `done` | 完成 | |
| `dropped` | 放弃 | |

## 目标文件

每个目标一个文件：`.goals/<id>.md`，`id` 是正整数，新目标取现有最大值 + 1。

```markdown
---
id: 12
title: CSV 导出
status: active
parent: 3
split: tasks
created: 2026-10-11
---
## 描述
## 验收标准
## 方案
## 已定决策
## Tasks
- [x] T1 | 定义导出字段 | 验收: 字段表经确认
- [~] T2 | 流式写出 | 验收: 10 万行内存不超 200MB
- [ ] T3 | 编码与 BOM | 验收: Excel 打开不乱码
```

- frontmatter 键：`id`、`title`、`status`、`parent`（父目标 id，顶层为空）、`split`（空、`tasks` 或 `goals`）、`created`（`YYYY-MM-DD`）。
- 正文按上面的顺序含二级标题；`## Tasks` 只在 `split: tasks` 时出现。
- task 行：`- [<符号>] T<n> | <标题> | 验收: <文本>`。符号 `[ ]` 待办、`[~]` 进行中、`[x]` 完成、`[-]` 跳过；编号从 T1 起连续。
- 子目标不写在父目标文件里，由子目标的 `parent` 决定。
- 文件可以手改。解析不了的文件在面板里标出原因，工具和命令拒绝修改它，直到修好。

## 规则

插件在每次修改前检查，违反即拒绝并说明原因：

1. 全项目至多一个目标为 `active`，且它的 `split` 为 `tasks`。
2. 一个目标里至多一个 task 为 `[~]`。
3. `split` 在拆解时确定，之后不变；`split: tasks` 的目标不能有子目标。在一个还没拆解的目标下记子目标时，它的 `split` 随即定为 `goals`。
4. 完成一个目标前：`split: tasks` 的所有 task 都已结束（`[x]` 或 `[-]`）；`split: goals` 的所有子目标都已完成或放弃。
5. 子目标的 `parent` 在创建时确定，之后不变。

## 命令

命令立即生效，不占用 Claude 的回合；标「开启一轮」的会提交一条提示，让 Claude 开始新的一轮。`<目标>` 写 `12` 或 `#12`。

| 命令 | 作用 | |
|---|---|---|
| `/ms-new <标题> [--under <目标>]` | 记一个想法 | |
| `/ms-plan <目标>` | 状态改为「找方案」，请 Claude 提出方案与拆解 | 开启一轮 |
| `/ms-focus <目标>` | 设为执行中；原来执行中的目标回到「已计划」 | |
| `/ms-next` | 执行当前目标的下一个 task（优先继续 `[~]` 的那个），做完停下 | 开启一轮 |
| `/ms-auto [n\|all]` | 连续执行 n 个 task，不写就是全部 | 开启多轮 |
| `/ms-skip` | 把当前 task 标为跳过 | |
| `/ms-add <描述>` | 请 Claude 提议追加一个 task，你同意后才写入 | 开启一轮 |
| `/ms-done [目标]` | 确认完成，不写就是当前执行中的目标 | |
| `/ms-drop <目标>` | 放弃 | |
| `/ms-status` | 文字版总览 | |
| `/ms-panel` | 打开面板 | |

`/ms-focus`、`/ms-done`、`/ms-drop` 会停止正在进行的 auto。

## auto 模式

每一轮只做一个 task。一轮结束时，如果刚才那个 task 变成了 `[x]`，且还有剩余次数和待办 task，就提交下一个。以下任一情况会停下，并弹出通知说明原因：

- 刚才那个 task 没有变成 `[x]`（自检没过、Claude 停下来问你、你在中途发了别的消息）；
- 这一轮被中断或出错；
- 次数用完；
- 当前目标的 tasks 全部结束。这时 Claude 会对照验收标准汇报，由你用 `/ms-done` 确认。

auto 的剩余次数只在当前会话里有效，重开会话后回到逐步模式。

## Claude 用的工具

Claude 不直接改 `.goals/` 下的文件，只通过插件注册的工具修改：

| 工具 | 作用 |
|---|---|
| `mcp__milestone__create_goal` | 新建一个想法，可以指定父目标 |
| `mcp__milestone__plan_goal` | 写入描述、验收标准、方案、决策和拆解（tasks 或子目标），状态改为「已计划」；只在你明确确认方案之后调用 |
| `mcp__milestone__start_task` | 把执行中目标的某个 task 标为 `[~]` |
| `mcp__milestone__finish_task` | 把 `[~]` 的 task 标为 `[x]`；只在对照验收自检通过后调用 |
| `mcp__milestone__add_task` | 追加一个 task；只在你同意之后调用 |

插件提交给 Claude 的提示都以 `[milestone]` 开头：`找方案 #N`、`执行 #N T<k>`、`追加 task #N：…`、`恢复 #N`。`milestone` 技能（`skills/milestone/SKILL.md`）规定 Claude 收到每一种提示时怎么做。

## 面板

上半部分是目标树：每行显示状态和进度，执行中的目标高亮，有子目标的目标显示已完成子目标数。下半部分是执行中目标的验收标准和 tasks。面板每 5 秒重读 `.goals/`，同一项目开着几个会话也会同步。面板只显示，不修改。

会话开始时如果有执行中的目标，插件会请 Claude 用不超过五句话汇报进度后等待（插件设置里的 `autoResume` 可以关掉），并请求打开面板。每个会话只汇报一次，而且只在有界面时汇报：终端交互会话、开始时已有界面的会话在开始时汇报；其他会话等第一个界面接入时汇报，之后再有界面接入（例如手机远程连接）不重复。桌面版要发出第一条消息才会创建会话，界面也在这时接入，所以汇报出现在第一条消息之后；想先看汇报，第一条消息发 `/ms-status`（它不经过模型）。无界面会话（`claude -p`、SDK）从头到尾没有界面接入，所以不汇报。Claude Code 只在终端至少 144 列宽时才放置这种自动打开的面板；放不下时会弹出通知，用 `/ms-panel` 手动打开即可，手动打开不受宽度限制。

## 安全边界

插件只读写项目根目录下 `.goals/` 里名为 `<数字>.md` 的文件，路径按解析后的真实路径判定。不联网，不读环境变量，不启动子进程，不读会话记录。

## 安装

在 Claude Code（2.1.275 或更新）里一步安装，终端和桌面版都可用：

```
/plugin install milestone --marketplace qwang07/milestone-mod
```

本仓库也是插件目录，clone 下来可以直接加载（和上面的安装二选一，不要同时用）：

- 试用一次：`claude --plugin-dir /path/to/milestone-mod`
- 长期使用（含桌面版）：把本目录的绝对路径加进 `~/.claude/settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS`。

在要用的项目里，把 [`CLAUDE.md.snippet`](CLAUDE.md.snippet) 的内容追加到项目的 CLAUDE.md。`.goals/` 目录会在记下第一个目标时自动创建。不需要打开 Claude Code 自带的 Task 工具。

## 验证

- `claude plugin validate .`：插件结构与引擎拒绝项。
- `claude plugin test .`：`tests/*.test.ts` 中的用例。
- 端到端：在临时项目中按 [`VERIFY.md`](VERIFY.md) 走一遍。
