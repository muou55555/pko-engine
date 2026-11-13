# 与 pko-vault 的一致性核验

对照参考库 `pko-vault` 核验：**业务层的知识管理流程与习惯必须一致**，
只有触发方式（Claude Code 斜杠命令 → DSH 技能）和操作手段（obsidian CLI → 文件读写 + pko_* 工具）可以不同。

核验由 `tests/conformance.test.ts` 自动把关：目录、模板、MOC、技能流程要素缺失会直接失败。

---

## 一、目录对照

参考库的每个目录都出现在 `pko init` 生成的骨架里，并且都有明确的写入者。

| 目录 | 用途 | 由什么产生 |
| --- | --- | --- |
| `00-Inbox/` | 所有新内容第一落点 | `/pko-ingest` 处理来源、`/pko-save` 落新页；用户手动放文件 |
| `10-Atlas/` | MOC 导航层 | `pko init` 生成 HOME + 9 个领域 MOC；`/pko-save`、`/pko-moc` 维护链接 |
| `20-Projects/` | 有截止日期的项目 | `/pko-save` 路由工作决策；`/pko-daily` 读 `status: active` |
| `30-Areas/` | 长期领域（work/life 各 4–5 个子域） | `/pko-save`、`/pko-ingest` 按领域路由 |
| `40-Resources/` | 原子笔记（concepts/how-to/references/clips） | `/pko-ingest`、`/pko-save` |
| `50-Wiki/` | 结构化 Wiki（index/log/hot） | `pko_*` 写入自动追加 `log.md`；`/pko-wrap-up` 重写 `hot.md`；`/pko-ingest` 维护 `index.md` |
| `60-Outputs/` | 产出物 | `/pko-weekly` 写 `weekly-reports/`；`/pko-canvas` 写 `canvases/` |
| `70-Calendar/` | 日记/周记/月记 | `/pko-daily` 创建当日、`/pko-save` 与 `/pko-wrap-up` 追加、`/pko-weekly` 同步周记 |
| `80-Cards/` | Zettelkasten 永久笔记 | `/pko-save` 的概念内容 |
| `90-Archive/` | 归档（不删除） | 所有"删除"动作改为移到此处（闸门强制） |
| `brain/` | 记忆层 | `/pko-daily` 读 north-star、`/pko-wrap-up` 更新 memories 等 |
| `_templates/` | Obsidian 模板（8 套） | `pko init` 生成，技能写入时按模板结构落内容 |
| `_attachments/` | 附件（images/pdfs，各有 canvas 子目录） | `/pko-canvas` 引用 |
| `00-Inbox/` | 新材料第一落点 + 原件存放 | 用户投放、`/pko-ingest` 把原件存成 `YYYY-MM-DD-<标题>.md`；摄取后原地保留、不改不删 |

---

## 二、命令对照

| pko-vault 命令 | pko-engine 技能 | 业务行为 |
| --- | --- | --- |
| `/daily-start` | `/pko-daily` | 读 north-star + hot → 准备今日日记 → 待办 → Inbox → 活跃项目 → 3 条建议 |
| `/ingest` | `/pko-ingest` | 取来源（或 Inbox）→ 原件存 `00-Inbox/` → 判类型 → 蒸馏成页 → 更新 index/MOC → 质量标准 |
| `/save` | `/pko-save` | 识别内容 → 按路由表落到固定目录 → 更新 MOC → 追加今日日记 → 更新 log/hot |
| `/wiki-query` | `/pko-query` | hot → index → HOME → MOC → 具体页；带来源；查不到明说 |
| `/weekly-digest` | `/pko-weekly` | 本周日记 + 项目 + log 新增 → 对外版与个人版 → `60-Outputs/weekly-reports/` 与 `70-Calendar/weekly/` |
| `/moc-update` | `/pko-moc` | 孤立笔记、MOC 死链、近 7 天归档建议、覆盖率报告 |
| `/wrap-up` | `/pko-wrap-up` | 追加今日日记 → 重写 hot → 更新 brain → Inbox 提醒 → 会话摘要 |
| `/canvas` | `/pko-canvas` | JSON Canvas 1.0 画布与附件目录管理 |

---

## 三、约定对照

| 约定 | 参考库 | 本引擎 |
| --- | --- | --- |
| 原始材料落点 | 新内容与原件统一放 `00-Inbox/` | **相同**：技能步骤 1–2 明确要求；不使用 `.raw/` |
| 原件不可修改 | 约定 | `00-Inbox` 中原件由技能约束不改；历史 `.raw/` 仍被闸门强制拦截 |
| 日志只追加 | `log.md` append-only | **强制**：拒绝整体覆写 |
| 永不删除 | 只归档到 `90-Archive/` | **强制**：含 `rm` 的命令被拦 |
| 文件命名 | 日记/周记/月记/项目/卡片/MOC/会议各有格式 | 写进 `AGENTS.md` 种子与技能 |
| 写入路由 | 内容类型 → 固定目录 | 写进 `/pko-save` 路由表 |
| 链接规则 | 只链接已存在文件，不写死链 | 写进 `/pko-ingest`、`/pko-save`、`/pko-moc` |
| 矛盾标注 | `> ⚠️ 待确认：…` | 写进 `/pko-ingest` |
| 检索顺序 | hot → index → HOME → MOC → 文件 | 写进 `/pko-query`，`pko_query` 工具按同样分层实现 |

---

## 四、有意保留的差异

| 差异 | 原因 |
| --- | --- |
| 触发方式：斜杠命令 → 技能 | DSH 的技能就是这个位置；名字统一加 `pko-` 前缀 |
| 操作手段：`obsidian daily:append` / `tasks` / `open` → 文件读写 | DSH 不驱动 Obsidian；`hot.md` 由引擎直接写，任务从日记文件解析 |
| 抓取：`defuddle` → `web_fetch` | 不引入额外依赖；Markdown 来源直接读 |
| MCP filesystem 服务 → 工具内置 | 引擎自带 vault 内路径校验 |

---

## 五、核验结果

```
tests/conformance.test.ts
✔ 参考库的每个目录都在初始化骨架里
✔ 八套模板与十个 MOC 都会生成
✔ AGENTS.md 写进了目录、命名、路由与安全规则
✔ 每个技能都覆盖它在 vault 里对应的流程
✔ 技能都是人类命令（不自动触发）
```
