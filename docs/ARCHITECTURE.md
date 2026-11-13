# 架构与设计取舍

给想改代码或理解行为边界的人。

---

## 一、分层与依赖方向

```
@pko/core          纯 Node 库：不认识任何宿主（DSH / Claude Code / CLI）
    ↑
├── @pko/cli       把 core 变成命令行
├── @pko/dsh       把 core 变成 DSH 插件（工具 + 事件锚点）
└── packages/skills  纯 Markdown 技能，被插件投放进 vault
```

**铁律**：适配器依赖 core，core 不认识适配器。core 里出现 `@deepseek-ai/*` 就是设计事故。

`@pko/dsh` 的构建产物是**自包含**的：`tsc` 的 `rootDir` 是 `packages/`，一次编译把 core 与 dsh 一起输出到
`packages/dsh/lib/`，所以插件装进 profile 后不依赖宿主的任何包（profile 的 `node_modules` 里也没有它们）。

---

## 二、数据契约

### 页面 frontmatter

```yaml
id: 稳定标识（默认等于文件名）
title: 标题
type: note | card | wiki | project | ...   # 见 PAGE_TYPES
status: seed | developing | mature | evergreen | active | draft | done | archived
confidence: extracted | inferred | ambiguous
tier: core | supporting | peripheral        # 检索加权 1.3 / 1.0 / 0.7
tags: [...]
source: URL / 路径 / session:<id>
summary: 一句话摘要（检索的摘要层依赖它）
created / updated
```

- `category` **不落盘**，由目录派生（`40-Resources/concepts/` → `concepts`）
- 写入时补齐缺失字段；**未知字段原样保留**（剪藏工具的 `author`、`description` 不会被抹掉）

### 状态目录 `.pko/`

| 文件 | 作用 |
| --- | --- |
| `lock.json` | 跨进程写锁（pid + host + TTL + token） |
| `manifest.json` | 来源 → contentHash → 产出页面（增量去重） |
| `activity.json` | 最近一次写入时间（判断 hot.md 是否需要刷新） |

`.pko/` 是点目录，Obsidian 默认不索引。历史版本曾用 `.raw/` 存放原件，现已改为存放在 `00-Inbox/`。

---

## 三、写入协议

```
拿锁 → 读旧版本 → 校验 expectedHash → 归一化 → 原子写 → 追加 log.md → 记 activity → 更新 manifest → 释放锁
```

- **原子写**：同目录 `tmp` + `rename`（跨目录 rename 在多数平台不原子）
- **冲突**：期望哈希与实际不符时抛 `ConflictError`，**不静默覆盖**
- **锁**：`O_EXCL` 创建；同主机且进程存活则不抢；跨主机或进程已死则按 TTL 接管
- **更新语义**：内容变化才刷新 `updated`；`normalize` 子命令只补缺失字段，不改既有时间戳

---

## 四、检索与上下文

```
L1 index.md 行匹配        （最便宜）
L2 标题 / 标签 / 摘要     命中即停（成本护栏）
L3 正文扫描               截 200 字片段
L4 正文命中页的双链邻居
```

- 打分：`基础分 × tier 权重 × 连线度微调`
- 护栏**按规模启用**（默认 >500 页）：小库扫正文只要几百毫秒，没必要牺牲召回
- 中文按 2 字滑窗切 bigram（门槛是 2 不是 3，「时区」这类词才不会被切掉）
- `index.md` / `log.md` / `hot.md` 是元数据工件，不进检索面

上下文三档：会话档 400 token（hot.md + north-star）、任务档 200 token（命中前 3 页）、整页档 1200 token。

---

## 五、适配器契约

核心只暴露两种入口：

1. **工具**：`pko_query` 等 8 个函数
2. **事件**：`agent/created`（会话注入 + 投技能）、`agent/pre-step`（任务召回）、`tools/pre-execute`（写入闸门）

适配器只做映射，不做业务。

### 为什么闸门不用 `fs/write-intent`

那个事件的返回值是**版本守卫**（`createIfAbsent` / `replaceIfVersion`），`undefined` 表示无条件写入——
**没有"拒绝"语义**。硬拦截只能走 `tools/pre-execute`，它才有 `{ kind: 'deny', reason }`。

### 为什么会话注入挂在 `agent/created`

DSH 0.2.2 没有 `agent/session-start` 事件。挂错事件名不会报错，只会静默不执行。

### 为什么召回只看最新一条用户消息

决策里可能带累积对话；用全文召回会让每一步都命中前面聊过的话题，同一个提示被反复注入。

---

## 六、其它取舍

| 决策 | 原因 |
| --- | --- |
| 不自动重建 `50-Wiki/index.md` | 它是人工维护的目录，重建是破坏性的 |
| 语义检索先不做 | 先用词面 + 未命中日志判断需不需要 |
| 还原点用 git ref | vault 本来是 git 仓库，快照天然增量，比复制目录便宜 |
| 提交 `packages/dsh/lib/` | pnpm 拦截 git 依赖的 `prepare`，提交产物让 git 安装零额外步骤 |
| 无自建 UI | Obsidian 就是 UI |

---

## 七、已知限制

- 恢复还原点只覆盖快照内存在的文件；之后新增的文件不会被删除
- 还原点 id 用 UTC 时间，本地看会差时区偏移
- 并发冲突的粒度是文件级；同一文件的两处独立修改不会自动合并
- 不监听外部编辑：非经本引擎的写入，索引与 manifest 只有下次扫描才更新
