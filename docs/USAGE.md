# 使用手册

装好之后怎么用。所有操作都在**你的知识库目录**里开的 DSH 会话中完成。

---

## 一、你不需要记住工具名

正常对话就行：

| 你说 | 背后发生 |
| --- | --- |
| 我之前记过关于缓存穿透的什么？ | 模型调用 `pko_query`，必要时 `pko_read` |
| 把这段结论存进知识库 | 模型走 `pko_capture` 或 `pko_ingest` |
| 继续上次那个方案的思路 | 会话上下文里已有 `hot.md`，模型据此接上 |
| 检查一下知识库健康度 | `pko_lint` |
| 先建个还原点 | `pko_checkpoint` |

工具是给模型的，不是给你的——你只需要正常提问。

---

## 二、8 个技能（斜杠命令）

输入 `/` 会看到这些命令。它们各自是一段固定的工作流程。

| 命令 | 对应 pko-vault 命令 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `/pko-daily` | `/daily-start` | 读 north-star 与 hot、准备今日日记、列待办与 Inbox、给 3 条建议 | 每天开工 |
| `/pko-ingest` | `/ingest` | 取来源（或处理 Inbox）→ 原件存 `.raw/` → 蒸馏成页 → 更新索引与 MOC | 看到好文章/论文 |
| `/pko-save` | `/save` | 按内容类型路由到固定目录 → 更新 MOC → 追加今日日记 | 聊出结论后 |
| `/pko-query` | `/wiki-query` | hot → index → HOME → MOC → 具体页，带来源回答 | 想查自己的积累 |
| `/pko-weekly` | `/weekly-digest` | 生成本周周报（对外版 + 个人版），归档到产出与日历 | 周五/周日 |
| `/pko-moc` | `/moc-update` | 孤立笔记、MOC 死链、近 7 天归档建议、覆盖率 | 每周一次 |
| `/pko-wrap-up` | `/wrap-up` | 追加日记、重写 hot.md、更新 brain 记忆层 | 收工前 |
| `/pko-canvas` | `/canvas` | 在 Obsidian Canvas 上建可视化知识板 | 整理关系时 |

### 例子

```
/pko-ingest https://example.com/article
```

```
/pko-query 我之前研究过哪些向量检索方案？
```

```
/pko-daily
```

> 技能是**人类命令**：它们默认不进模型的自动技能目录（`disable-model-invocation: true`），
> 所以不会干扰模型自己的判断。想要的话删掉那行 frontmatter 即可。

---

## 三、材料怎么进库（与 pko-vault 一致）

```
新材料 → 00-Inbox/（第一落点）
   ↓ /pko-ingest
原件 → .raw/YYYY-MM-DD-<标题>.md（一字不改，此后不可修改）
蒸馏页 → 50-Wiki/<主题>.md 或 40-Resources/...
索引 → 50-Wiki/index.md 与 10-Atlas/moc-*.md 加链接
日志 → 50-Wiki/log.md 自动追加
```

写入路由（`/pko-save` 与 `/pko-ingest` 共用）：

| 内容 | 目标目录 |
| --- | --- |
| 技术方案 / 操作步骤 | `40-Resources/how-to/` |
| 概念 / 原理 | `40-Resources/concepts/` + `80-Cards/` |
| 工作决策 | `20-Projects/work/<项目>/` |
| LLM / AI | `30-Areas/work/llm/` |
| 量化 | `30-Areas/work/quant/` |
| 生活类 | `30-Areas/life/<子目录>/` |
| 日记 | `70-Calendar/daily/YYYY-MM-DD.md` |
| 周报 | `60-Outputs/weekly-reports/YYYY-WNN.md` + `70-Calendar/weekly/` |

目录的完整对照见 **[一致性核验](CONFORMANCE.md)**。

## 四、10 个工具（模型自动调用）

| 工具 | 作用 |
| --- | --- |
| `pko_query` | 分层检索，返回候选与命中原因 |
| `pko_read` | 读整页（id / 文件名 / 相对路径都行） |
| `pko_context` | 取一段可注入的上下文 |
| `pko_capture` | 记一页，默认落 `00-Inbox/` |
| `pko_ingest` | 批量写入，同内容自动跳过 |
| `pko_lint` | 健康检查 |
| `pko_normalize` | 补齐缺失的 frontmatter |
| `pko_status` | 检查当前目录是不是知识库、缺什么 |
| `pko_init` | 当前目录还不是知识库时，一键搭好骨架 |
| `pko_checkpoint` | 还原点：create / list / restore |

### 第一次用：先建库

如果当前目录还不是知识库，会话开始时会收到一条提示，模型会**先问你建在哪**，不会擅自创建：

```
[知识库] 当前目录不是 PKO 知识库。如果用户想在这里建立知识库：
 1. 先问用户要把库建在哪个目录
 2. 用户确认后调用 pko_init(path)
 3. 再调用 pko_status 确认
```

所以正常对话是：

```
你：帮我建个知识库
模型：要建在哪个目录？默认可以用当前目录 <路径>，也可以给别的路径。
你：用 ~/Documents/my-vault
模型：调用 pko_init(path: "~/Documents/my-vault")
     → 返回「库已就绪，无需再检查：结构完整（0 缺失）」
     → 直接告诉用户建好了，不再跑 status / lint 复查
```

只有当初始化后发现仍有缺失时，模型才会继续查。

- **已有部分结构**（比如只有 `50-Wiki/`）：只补齐缺的部分，不重建、不覆盖
- **不想被提示**：配置 `initPrompt: false`

或者自己在终端跑：

```sh
node packages/core/src/cli.ts init --vault ~/my-pko-vault
```

初始化只会补缺，已有的文件和目录一律不动，可以反复执行。

### 强制使用某个工具

直接说：

```
用 pko_query 查一下「充电桩」，把命中的前三条列出来。
```

---

## 五、典型工作流

### 每日开工

```
/pko-daily
```

模型会读 `hot.md` 与 `brain/north-star.md`，列出今日建议、Inbox 待办、活跃项目。

### 摄取一篇资料

```
/pko-ingest https://arxiv.org/abs/xxxx.xxxxx
```

流程：抓取 → 判断类型 → **先查重**（避免重复建页）→ 蒸馏成 1–3 页 → 入库 → 报告。

入库走 contentHash：同一来源内容没变就跳过，不会产生 `-2` 副本。

### 查询自己的积累

```
/pko-query 我之前关于知识库检索的结论是什么？
```

模型会检索、读原文、带来源回答；库里没有时会直说，而不是编。

### 会话收尾

```
/pko-wrap-up
```

它会**完整覆写** `50-Wiki/hot.md`（≤500 字，四个小节），并追加今日日记。
`hot.md` 是下次会话恢复上下文的唯一依赖，收尾时写它比事后补有用。

### 建还原点

```
先建个还原点再批量改。
```

或命令行：

```sh
node packages/core/src/cli.ts checkpoint --vault ~/你的库
node packages/core/src/cli.ts checkpoints --vault ~/你的库
node packages/core/src/cli.ts restore 20261113-015335 --vault ~/你的库
```

还原点用 git ref 实现，**创建时不改动工作区**；恢复只覆盖快照里存在的文件，之后新增的文件不会被删除。

---

## 六、写入规则（会自动执行）

| 规则 | 执行方式 |
| --- | --- |
| `.raw/` 里的原始材料不可修改 | 编辑被拒绝；写同名新文件也被拒绝 |
| `50-Wiki/log.md` 只追加 | 整体覆写被拒绝，改用追加 |
| 永不删除，只归档 | 含 `rm` 的命令被拦截，提示改成 `mv <file> 90-Archive/` |
| frontmatter 必须完整 | 写入时自动补齐 title/type/created/summary |
| 不静默覆盖 | 并发写同一文件时，后写入者收到冲突而不是覆盖 |

被拒绝时，模型会看到原因和建议，它会换一种做法——你不需要手动干预。

---

## 七、上下文是怎么注入的

三档，预算逐级放大：

| 档 | 时机 | 内容 | 预算 |
| --- | --- | --- | --- |
| 会话档 | 会话开始 | `hot.md` + `brain/north-star.md` | 400 token |
| 任务档 | 每次提问 | 命中的前 3 页（标题 + 命中原因） | 200 token |
| 整页档 | 显式要求 | 某页完整正文 | 1200 token |

任务档**只看最新一条用户消息**——不会因为前面聊过什么就一直重复注入旧话题。

命中不到东西时**不说话**（宁可不提示，也不塞噪声）。

---

## 八、命令行参考

不装 DSH 也能用核心能力：

```sh
node packages/core/src/cli.ts doctor    --vault <库> [--json]
node packages/core/src/cli.ts normalize --vault <库> [--apply]
node packages/core/src/cli.ts query <词> --vault <库> [--mode auto|index-only] [--deep] [--json]
node packages/core/src/cli.ts context   --vault <库> [--task "原话"|--page <id>] [--json]
node packages/core/src/cli.ts checkpoint  --vault <库>
node packages/core/src/cli.ts checkpoints --vault <库>
node packages/core/src/cli.ts restore <id> --vault <库>
node packages/core/src/cli.ts hook --vault <库>     # 从 stdin 读宿主事件
```

退出码：`doctor` 发现 error 为 1；用法错误为 2；`hook` 拒绝为 2。

---

## 九、和 Obsidian 的分工

| 用 Obsidian | 用 DSH |
| --- | --- |
| 阅读、浏览、双链跳转、看图谱 | 生成、批量整理、跨文件检索 |
| 手动整理与写作 | 摄取、蒸馏、去重、周报 |
| Dataview / Bases 视图 | 结构化审计与修复 |

两边读写同一份文件，不需要同步。

---

## 十、常见问题

**Q：模型说"不在任何 PKO vault 内"？**
A：会话工作目录不在库内。在库根目录开会话，或配置 `vault: /绝对路径`。

**Q：技能没出现在 `/` 菜单？**
A：先重启 DSH；再确认 `<库>/.dsh/skills/` 有 8 个目录。没有的话让模型跑一次会话即可触发投放。

**Q：模型改不了 `.raw/`，但我确实想改？**
A：这是设计。把内容从 `.raw/` 读出来写到 `40-Resources/` 等目标路径。原始材料保持不变是刻意的。

**Q：想关掉自动召回？**
A：配置 `trigger: false`。工具仍然可用，只是不再自动提示。

**Q：能同时让 Claude Code 和 DSH 用吗？**
A：core 是宿主无关的，Claude Code 适配暂未实现（按计划后置）。
