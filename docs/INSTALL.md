# 安装手册

面向第一次使用的人。照着做，不需要先理解内部实现。

> 在 DSH 会话里直接说「帮我安装 pko-engine」，会走 `/pko-setup` 引导流程：
> 先检查环境，再问你要新建还是补齐目录，每一步都会让你确认，不会擅自创建。

---

## 一、你会得到什么

装好后，在 DSH 里打开你的知识库目录，就能：

- 输入 `/pko-daily`、`/pko-query` 这类命令
- 让模型查知识库（它会自动调用 `pko_query`）
- 会话开始时自动带上你的近期上下文（`hot.md`）
- 模型想删除文件、覆写操作日志时被拦下来

---

## 二、前置条件

| 需要 | 版本 | 检查方式 |
| --- | --- | --- |
| Node.js | ≥ 22.18 | `node --version` |
| pnpm | 任意近期版本 | `pnpm --version` |
| DeepSeek Harness | ≥ 0.2.2-rc.1 | `dsh --version` |
| 一个 Obsidian 知识库 | — | 有 `50-Wiki/` 目录即可 |

`dsh` 还没装？

```sh
npm install -g @deepseek-ai/dsh
dsh --version
```

### 你的知识库需要有什么

只要有一个 `50-Wiki/` 目录（或 `.pko/`）就能被识别为知识库。引擎不绑定其余目录名。

**还没有库？一条命令生成标准骨架：**

```sh
node packages/core/src/cli.ts init --vault ~/my-pko-vault
```

它会生成与参考库一致的结构：

```
你的库/
├── AGENTS.md            ← 给 Agent 的操作手册（目录、写入规范、安全规则）
├── purpose.md           ← 这个库服务什么
├── 00-Inbox/            ← 新内容第一落点
├── 10-Atlas/            ← HOME + moc-work + moc-life 导航
├── 20-Projects/{work,personal}/
├── 30-Areas/{work,life}/
├── 40-Resources/{concepts,how-to,references,clips}/
├── 50-Wiki/{index,hot,log}.md
├── 60-Outputs/{articles,weekly-reports,presentations,canvases}/
├── 70-Calendar/{daily,weekly,monthly}/
├── 80-Cards/  90-Archive/  _attachments/  _templates/  brain/
```

- **只补缺**：已存在的目录和文件一律不覆盖，可以反复执行
- **初始化后体检是 0 error / 0 warning**，可以直接开始写
- 目录非空又不像知识库时，会要求加 `--force`，避免污染现有项目

引擎不会替你自动建库：`pko init` 需要你给出目录并确认。
在 DSH 会话里说「帮我安装」会走 `/pko-setup` 引导流程。

---

## 三、安装（四种方式，选一个）

| 方式 | 适合谁 | 需要发布到 npm 吗 |
| --- | --- | --- |
| A. 源码 `link:` | 自己开发、改代码 | 否 |
| B. 本地 tgz | 自己长期使用、版本固定 | 否 |
| C. Git 仓库 | 分发给别人 | 否 |
| D. npm 包 | 公开发布后 | 是 |

### 方式 A：源码 link（开发推荐）

```sh
git clone https://github.com/muou55555/pko-engine.git pko-engine
cd pko-engine
pnpm install
npm run build:dsh

dsh plugin --profile web add link:"$PWD/packages/dsh"
```

`link:` 是指向源码的符号链接——之后改代码、重新构建、重启 DSH 即可。

日常开发循环（自动重编译 + 技能自动同步）见 **[开发文档](DEVELOPMENT.md)**。

### 方式 B：本地 tgz（稳定使用推荐）

```sh
cd pko-engine
pnpm install            # 首次需要，用于构建
npm run pack:dsh        # 产出 dist/pko-dsh-<版本>.tgz

dsh plugin --profile web add "$PWD"/dist/pko-dsh-*.tgz
```

tgz 是快照：之后改源码不影响已装的版本；要更新就重新打包安装。

### 方式 C：Git 仓库（不发布 npm 也能分发）

```sh
dsh plugin --profile web add "git+https://github.com/muou55555/pko-engine.git#path:packages/dsh"
```

锁定到某个 tag（推荐）：

```sh
dsh plugin --profile web add "git+https://github.com/muou55555/pko-engine.git#v0.1.0&path:packages/dsh"
```

说明：

- `#<ref>&path:<子目录>` 是 pnpm 的语法；省略 ref 表示默认分支最新提交
- 仓库**已提交构建产物**（`packages/dsh/lib/`），所以 git 安装不需要额外构建，也不会被 pnpm 的 `allowBuilds` 拦截
- 如果你 fork 后改了源码，需要本地 `npm run build:dsh` 并提交 `lib/`，否则装到的是旧产物
- 本地测试可以用 `git+file:///绝对路径/pko-engine#path:packages/dsh`

### 方式 D：npm 包

```sh
dsh plugin --profile web add @pko/dsh
```

> 需要该包已发布到 npm。未发布时用 A / B / C。

### 安装后

**重启 DSH**（关掉正在跑的 `dsh web`，重新启动）。

DSH 会自动把 `@pko/dsh` 写进 `dsh.profile.bundles`，不需要手改配置。

---

## 四、验证

### 1. 插件被登记

```sh
dsh --profile web --dump-config | grep -A3 pko-engine
```

期望看到：

```yaml
- id: pko-engine
  name: '@pko/dsh'
  config:
    vault: null
```

### 2. 插件真的加载了

启动 DSH 时留意 stderr，**不应出现**：

```
dsh: warning: N entry did not activate
pko-engine (@pko/dsh): ...
```

出现上面这类警告说明插件没加载成功，见第七节排错。

### 3. 技能被投放

在**你的知识库根目录**开一个会话，然后：

```sh
ls ~/你的库/.dsh/skills
```

期望看到 8 个目录：`pko-canvas`、`pko-daily`、`pko-ingest`、`pko-moc`、`pko-query`、`pko-save`、`pko-weekly`、`pko-wrap-up`。

### 4. 一条命令跑完安装验证

```sh
npm run test:install        # 自动验证 tgz 与 git 两种安装方式
```

### 5. 工具可用

在会话里输入：

```
用 pko_query 查一下「缓存」
```

模型应调用工具并返回候选页面；若库是空的，会得到"没有命中"而不是报错。

---

## 五、配置

### 在 Web 设置页里配置（推荐）

装好并重启后，打开 **设置 → 插件 → pko-engine**，会看到自动生成的表单：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `vault` | 文本 | 固定知识库路径；留空按会话目录查找 |
| `sessionContext` | 开关 | 会话开始注入 hot.md 与 north-star（默认关） |
| `trigger` | 开关 | 提问时召回相关页面（默认关） |
| `guard` | 开关 | 写入闸门 |
| `installSkills` | 开关 | 会话开始投放技能 |
| `maxInjectTokens` | 数字 | 注入预算 |

表单由插件导出的 `Config` schema 自动生成，改动会写回该 profile 的
`cordis.patch.yml`——和你手改文件是同一个位置。

### 配置文件方式


默认配置通常够用。要改的话，在 profile 的 patch 文件里覆盖（推荐）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: pko-engine
  name: '@pko/dsh'
  config:
    vault: /Users/你/你的库      # 固定 vault 路径；null 表示按会话目录找
    sessionContext: false       # 会话开始注入 hot.md（默认关）
    trigger: false              # 任务级自动召回（默认关）
    guard: true                 # 写入闸门
    installSkills: true         # 会话开始投放技能
    maxInjectTokens: 400        # 会话注入预算
```

改完重启 DSH。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `vault` | `null` | `null` = 从会话工作目录向上找 `.pko/` 或 `50-Wiki/` |
| `trigger` | `false` | 提问时按最新用户消息召回相关知识（默认关，需要时打开） |
| `guard` | `true` | 拦截 `rm` 与 `log.md` 覆写（历史 `.raw/` 目录同样保护） |
| `installSkills` | `true` | 把随包技能补进 `<vault>/.dsh/skills`（只补缺，不覆盖） |
| `sessionContext` | `false` | 会话开始时注入 `hot.md` + `north-star`（默认关，需要时打开） |
| `maxInjectTokens` | `400` | 单次注入预算 |

---

## 六、卸载

```sh
dsh plugin --profile web remove @pko/dsh
```

重启 DSH。知识库不会被删，`.dsh/skills` 里已投放的技能也会保留（可以手动删）。

---

## 七、排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `N entry did not activate` + `@pko/dsh` | 产物没构建 | `npm run build:dsh` 后重启 |
| `Cannot find package '@pko/dsh'` | 路径写错或用了相对路径 | 用绝对路径重新 `dsh plugin add` |
| 工具报 `当前会话目录不在任何 PKO vault 内` | 会话目录不在库里 | 在该目录跑 `pko init`，或切到知识库目录开会话 |
| 技能没出现在 `/` 菜单 | 没重启，或 vault 没识别 | 重启 DSH；确认 `<vault>/.dsh/skills` 存在 |
| 模型能删文件 / 覆写日志 | `guard: false`，或会话目录不在库内 | 检查配置；确认 vault 被识别 |
| `headless` 跑不起来、提示缺少凭据 | headless 默认只带 `llm-deepseek-account` | 见下方"用 headless 跑自动化" |

### 用 headless 跑自动化

headless profile 默认缺少凭据层与 account 服务，补三行后可用（实测有效）：

```yaml
- insert:
    - id: credentials
      name: '@deepseek-ai/dsh-credentials-local'
    - id: authorization
      name: '@deepseek-ai/dsh-authorization'
    - id: deepseek-account
      name: '@deepseek-ai/dsh-deepseek-account-platform'
      config: { desktopPlatform: null }
```

然后用 `--patch` 传进去。完整例子见 `tests/e2e/dsh-session.mjs`。

---

## 八、卸载后想彻底清理

```sh
rm -rf ~/.dsh/profiles/web/node_modules/@pko    # 删掉包
rm -rf ~/你的库/.dsh                             # 删掉投放的技能与状态
```

知识库的 Markdown 内容不受影响。
