# @pko/dsh

PKO 知识引擎的 DeepSeek Harness 适配层。

它不实现知识管理，只把 `@pko/core` 的能力翻译成 DSH 能调用的接口。

## 安装

```sh
# 开发期（符号链接，改源码即时生效）
dsh plugin --profile web add link:/path/to/pko-engine/packages/dsh

# 发布后
dsh plugin --profile web add @pko/dsh
```

DSH 会自动把 `@pko/dsh` 登记进 `dsh.profile.bundles`，不需要手改配置。重启后生效。

## 能力

### 10 个工具

| 工具 | 作用 |
| --- | --- |
| `pko_query` | 分层检索：index → 标题/标签/摘要 → 正文 → 双链邻居 |
| `pko_read` | 读整页（接受 id / 文件名 / vault 内相对路径） |
| `pko_context` | 三档上下文：会话档 / 任务档 / 整页档 |
| `pko_capture` | 快速记录一页，默认落 `00-Inbox/` |
| `pko_ingest` | 批量写入，contentHash 增量跳过 |
| `pko_lint` | 健康检查（缺字段 / 断链 / 孤儿页 / 重复 id） |
| `pko_normalize` | 补齐 frontmatter（默认只报告） |
| `pko_status` | 检查目录是不是知识库、缺什么 |
| `pko_init` | 初始化知识库骨架（只补缺，不覆盖） |
| `pko_checkpoint` | 还原点：create / list / restore（git ref） |

### 3 个事件锚点

| 事件 | 行为 |
| --- | --- |
| `agent/created` | 投放随包技能 + 注入 `hot.md` 与 north-star |
| `agent/pre-step` | 按**最新一条用户消息**召回相关知识（同一任务不重复注入） |
| `tools/pre-execute` | 写入治理：`log.md` 只追加、`rm` 拦截（历史 `.raw/` 目录仍受保护） |

> 为什么写闸门不用 `fs/write-intent`：那个 seam 的返回值是版本守卫，
> `undefined` 表示无条件写入，**没有拒绝语义**。硬拦截只能走 `tools/pre-execute`。

## 配置

```yaml
- id: pko-engine
  name: '@pko/dsh'
  config:
    vault: null            # null = 按会话工作目录向上查找
    trigger: true          # 任务级召回
    guard: true            # 写入闸门
    installSkills: true    # 会话开始投放到 <vault>/.dsh/skills
    initPrompt: true       # 不是知识库时提示用户初始化（会先要求确认目录）
    maxInjectTokens: 400   # 会话注入预算
```

vault 识别标记：`.pko/` 或 `50-Wiki/` 目录（后者保证"还没建索引的新库"也能认出来）。

## 零运行时依赖

产物只 import `node:*` 和自带模块：插件被装进 profile 后，无法解析宿主的
`@deepseek-ai/*` 包。CI 有一条检查：

```sh
! grep -rE "from ['\"]@deepseek-ai" packages/dsh/lib --include=*.js
```

## 开发

```sh
npm run build:dsh     # tsc + 把 packages/skills 复制进 lib
npm test              # 92 例
npm run test:e2e      # 真实 DSH 会话 E2E（需可用模型路由）
```
