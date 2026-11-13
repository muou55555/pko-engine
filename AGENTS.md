# AGENTS.md — pko-engine 开发手册

> 在这个仓库里干活前先读这一份。它说明项目结构、铁律、命令和发布流程。

## 项目是什么

把 Obsidian 知识库变成 Agent 能可靠使用的一等公民：

```
packages/core      @pko/core     纯引擎（零宿主依赖）：schema / 检索 / 写协议 / 治理 / 骨架
packages/dsh       @pko/dsh      DeepSeek Harness 适配层：10 个工具 + 3 个事件锚点
packages/skills    9 个 pko-* 技能（纯 Markdown，被插件投放到知识库）
docs/              安装 / 使用 / 开发 / 架构 / 一致性核验
tests/             单元、集成、功能、并发、崩溃、性能、文档、一致性
```

## 四条铁律

1. **core 零宿主依赖**：`packages/core` 只 import `node:*` 和自身模块。
   出现 `@deepseek-ai/*` 就是设计事故——插件的 `lib/` 会被装进 profile，那里解析不到宿主包。
2. **产物提交进仓库**：`packages/dsh/lib/` 纳入版本控制。
   原因：pnpm 默认拦截 git 依赖的 `prepare` 构建，提交产物才能让 git 安装零额外步骤。
   改完源码必须 `npm run build:dsh` 并提交 `lib/`，否则 git 安装拿到旧产物。
3. **技能是数据不是代码**：`packages/skills/*/SKILL.md` 是业务知识，改它等于改产品行为；
   它们必须与 `pko-vault` 的知识管理流程一致（见 `docs/CONFORMANCE.md`）。
4. **测试串行跑**：`npm test` 带 `--test-concurrency=1`。并行会让性能/并发/文档测试互相争 CPU 而偶发失败。

## 常用命令

```sh
pnpm install            # 首次
npm test                # 全量测试（串行，约 16 秒）
npm run typecheck       # core + dsh 类型检查
npm run hygiene         # 代码卫生（无 any / console / 行尾空格，两个包都查）
npm run build:dsh       # 构建产物（tsc + 把技能复制进 lib）
npm run check:pack      # 打包内容校验（必需文件齐全、不含 tests/src、体积上限）
npm run pack:dsh        # 产出 dist/pko-dsh-<版本>.tgz

npm run test:e2e        # 真实 DSH 会话 E2E（需要模型路由）
npm run test:install    # 验证 tgz 与 git 两种安装方式
npm run dev:dsh         # 开发模式：tsc --watch + 技能自动同步（改完仍需重启 DSH）
npm run test:all        # 测试 + 卫生 + 类型 + 打包校验
```

## 改代码时要知道的

| 位置 | 注意 |
| --- | --- |
| `packages/core/src/writer.ts` | 写协议是 10 步（锁 → 版本校验 → 归一化 → 原子写 → 日志 → manifest），不要绕过 |
| `packages/core/src/policy.ts` | 只做判定不做执行；`.raw`（历史目录）允许新建、拒绝修改；`log.md` 只追加 |
| `packages/core/src/scaffold.ts` | 初始化只补缺、不覆盖；目录与 `pko-vault` 对齐 |
| `packages/dsh/src/events.ts` | 只有 `agent/created`、`agent/pre-step`、`tools/pre-execute` 三个锚点；`fs/write-intent` **没有拒绝语义**，硬拦截只能走 `tools/pre-execute` |
| `packages/dsh/src/tools.ts` | 工具契约：`parameters` 是 JSON Schema，`output.render` 必须存在 |
| 任何 TS 文件 | `erasableSyntaxOnly: true`——不能用参数属性（`constructor(readonly x: string)`） |

## 文档规则

- 改动影响用法 → 同步更新对应文档；`tests/docs.test.ts` 会校验文档里的 `npm run X` 与站内链接是否真实存在
- 文档之间互相链接，不复制大段内容
- `docs/CONFORMANCE.md` 是"与知识管理规范一致"的事实来源；改技能或骨架时一起改它和 `tests/conformance.test.ts`

## 提交与发布节奏（重要）

**默认只做本地提交，不碰远端。**

| 动作 | 是否需要用户明确授权 |
| --- | --- |
| `git add` + `git commit`（本地） | ✅ 可以直接做 |
| `git push` 到远端 | ❌ **必须用户明确说"推到 GitHub / 提交到远端"** |
| `git tag` / `gh release create` | ❌ **必须用户明确说"打 tag / 发版"** |

也就是说：

- 写代码、跑测试、更新文档 → 本地 commit 即可，不要推送
- 用户说"提交到我的 github" → 才 push（通常连 tag 和 Release 一起）
- 不要因为"改完了"就自动打 tag、发 Release、升版本号

发版是**用户决定的动作**，不是开发流程的收尾动作。

## 发布流程（仅在用户要求发版时执行）

```sh
# 1. 改版本（三处保持一致）
#    package.json / packages/core/package.json / packages/dsh/package.json
pnpm install                 # 同步 lockfile
npm run build:dsh            # 产物与源码一致
npm test && npm run check:pack

# 2. 提交并打 tag
git add -A && git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "pko-engine vX.Y.Z"
git push origin main && git push origin vX.Y.Z

# 3. 建 GitHub Release
gh release create vX.Y.Z --title "pko-engine vX.Y.Z" --generate-notes
```

不要移动已发布的 tag（重写 tag 会破坏依赖它的安装）。

## 不要做的事

- ❌ 在 `packages/core` 里 import 宿主包
- ❌ 提交 `dist/` 或 `node_modules/`
- ❌ 手动改 `packages/dsh/lib/`（那是构建产物，改源码后重建）
- ❌ 为了让测试过而放宽断言——先确认是产品行为错了还是测试过时了
- ❌ 在 `packages/skills` 里写与 `pko-vault` 冲突的知识管理流程
