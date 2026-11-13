# pko-engine

把 Obsidian 知识库变成 Agent 能可靠使用的一等公民：**知识引擎（core）+ 宿主适配层 + 技能包**。

目前提供 **DeepSeek Harness** 适配（`@pko/dsh`），同一个 core 也能通过 CLI 被其它工具复用。

## 它解决什么问题

你的知识库是 Markdown，Agent 能读能写——但"能"不等于"会用"：

- 模型很少主动去查（实测：415 次会话里只有 17 次检索）
- 规矩写在提示词里，靠自觉；`grep rm` 这种判断很容易绕过
- 每次会话都要重新摸索你的目录结构和写作规范

pko-engine 把这些变成确定性能力：**检索、写入、治理、上下文注入**都由代码完成，模型只负责理解与表达。

## 特性

| 能力 | 说明 |
| --- | --- |
| 分层检索 | index → 标题/标签/摘要 → 正文 → 双链邻居，成本逐级递增 |
| 三档上下文 | 会话档 400 / 任务档 200 / 整页档 1200 token，超预算自动裁剪 |
| 写入协议 | 跨进程锁 → 版本校验 → 归一化 → 原子写 → 日志 → manifest |
| 写入治理 | `.raw/` 不可改、`log.md` 只追加、删除一律拦截 |
| 增量入库 | contentHash 相同则跳过，重复摄取不产生副本 |
| 还原点 | 用 git ref 记录快照，创建时不改动工作区 |
| 自动投放技能 | 插件自带 8 个 `pko-*` 技能，会话开始补进 vault |
| 零宿主依赖 | 产物只 import `node:*`，装着就能跑 |

## 架构

```
@pko/core（依赖仅 node:*）
   ↑            ↑
@pko/cli    @pko/dsh（DSH 插件：8 工具 + 3 事件锚点）
   ↓            ↓
       你的 Obsidian vault（PARA · Markdown · YAML · Wikilinks）
```

## 快速开始

```sh
git clone <本仓库> pko-engine
cd pko-engine
pnpm install
npm run build:dsh
dsh plugin --profile web add link:"$PWD/packages/dsh"
```

重启 DSH，在 vault 目录里打开一个会话，输入 `/pko-query` 试试。

不想用源码链接？也可以：

```sh
npm run pack:dsh                        # 打包成 tgz
dsh plugin --profile web add "$PWD/dist/pko-dsh-0.1.0.tgz"

# 或者直接从 Git 仓库安装（需把仓库推到你自己的远端）
dsh plugin --profile web add "git+https://github.com/<你>/pko-engine.git#path:packages/dsh"
```

文档：

- **[安装手册](docs/INSTALL.md)** —— 前置条件、四种安装方式、验证、排错
- **[使用手册](docs/USAGE.md)** —— 技能、工具、工作流、写入规则
- **[开发文档](docs/DEVELOPMENT.md)** —— 源码调试、开发循环、事件观测
- **[架构文档](docs/ARCHITECTURE.md)** —— 分层、数据契约、写入协议、设计取舍

## 常用命令

```sh
npm test             # 单元 / 集成 / 功能测试
npm run test:e2e     # 真实 DSH 会话 E2E（需要可用模型路由）
npm run typecheck    # 类型检查
npm run hygiene      # 代码卫生（无 any / 无 console / 行尾等）
npm run build:dsh    # 构建插件产物（含内联 core 与技能）
```

CLI（不需要 DSH 也能用）：

```sh
node packages/core/src/cli.ts doctor    --vault ~/your-vault
node packages/core/src/cli.ts query 缓存穿透 --vault ~/your-vault
node packages/core/src/cli.ts context --vault ~/your-vault --task "接下来做什么"
node packages/core/src/cli.ts checkpoint --vault ~/your-vault
```

## 目录结构

```
packages/
├── core/     @pko/core   引擎本体（零依赖）
├── dsh/      @pko/dsh    DeepSeek Harness 适配层
└── skills/   8 个 pko-* 技能（Markdown）
docs/         安装与使用手册
tests/        单元 / 集成 / 功能 / 并发 / 性能 / 文档 / E2E
```

## 测试

单元 / 集成 / 功能 / 并发 / 崩溃一致性 / 性能 / 文档测试，外加真实 DSH 会话 E2E。

```sh
npm test              # 本地测试
npm run test:e2e      # 真实会话（需要模型路由）
npm run test:install  # tgz 与 git 两种安装方式
```

## 许可

MIT，见 [LICENSE](LICENSE)。
