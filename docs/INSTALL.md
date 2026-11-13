# 安装手册

面向第一次使用的人。照着做，不需要先理解内部实现。

---

## 一、你会得到什么

装好后，在 DSH 里打开你的知识库目录，就能：

- 输入 `/pko-daily`、`/pko-query` 这类命令
- 让模型查知识库（它会自动调用 `pko_query`）
- 会话开始时自动带上你的近期上下文（`hot.md`）
- 模型想改 `.raw/` 里的原始材料时被拦下来

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

最小的可用结构（没有也能跑，但工具会提示"不在任何 PKO vault 内"）：

```
你的库/
├── 50-Wiki/          ← 必须有这个目录（vault 识别标记）
│   ├── index.md      ← 可选，检索的 L1 层
│   └── hot.md        ← 可选，会话开始时注入的近期上下文
└── 40-Resources/     ← 可选，知识页默认落点之一
```

已经有 Obsidian 库就直接用，不需要改目录结构。

---

## 三、安装（三种方式，选一个）

### 方式 A：从源码安装（推荐，改动即时生效）

```sh
git clone <本仓库> pko-engine
cd pko-engine
pnpm install
npm run build:dsh

dsh plugin --profile web add link:"$PWD/packages/dsh"
```

`link:` 是指向源码的符号链接——之后改代码、重新 `npm run build:dsh`、重启 DSH 即可。

### 方式 B：打包安装（不保留源码链接）

```sh
cd pko-engine
npm run build:dsh
cd packages/dsh && npm pack        # 产出 pko-dsh-0.1.0.tgz

dsh plugin --profile web add /绝对路径/pko-dsh-0.1.0.tgz
```

### 方式 C：从 npm 安装

```sh
dsh plugin --profile web add @pko/dsh
```

> 需要该包已发布到 npm。未发布时用方式 A 或 B。

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

### 4. 工具可用

在会话里输入：

```
用 pko_query 查一下「缓存」
```

模型应调用工具并返回候选页面；若库是空的，会得到"没有命中"而不是报错。

---

## 五、配置

默认配置通常够用。要改的话，在 profile 的 patch 文件里覆盖（推荐）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: pko-engine
  name: '@pko/dsh'
  config:
    vault: /Users/你/你的库      # 固定 vault 路径；null 表示按会话目录找
    trigger: true               # 任务级自动召回
    guard: true                 # 写入闸门
    installSkills: true         # 会话开始投放技能
    maxInjectTokens: 400        # 会话注入预算
```

改完重启 DSH。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `vault` | `null` | `null` = 从会话工作目录向上找 `.pko/` 或 `50-Wiki/` |
| `trigger` | `true` | 提问时按最新用户消息召回相关知识 |
| `guard` | `true` | 拦截对 `.raw/` 的修改、`rm`、`log.md` 覆写 |
| `installSkills` | `true` | 把随包技能补进 `<vault>/.dsh/skills`（只补缺，不覆盖） |
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
| 工具报 `当前会话目录不在任何 PKO vault 内` | 会话目录不在库里 | 在知识库根目录开会话，或配置 `vault` |
| 技能没出现在 `/` 菜单 | 没重启，或 vault 没识别 | 重启 DSH；确认 `<vault>/.dsh/skills` 存在 |
| 模型改 `.raw/` 没被拦 | `guard: false`，或会话目录不在库内 | 检查配置；确认 vault 被识别 |
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
