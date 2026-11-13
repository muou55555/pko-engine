# 开发模式：从源码安装并调试

适合：改插件源码、调试工具行为、给本项目提 PR。

---

## 一、一次性设置

```sh
git clone https://github.com/muou55555/pko-engine.git pko-engine
cd pko-engine
pnpm install
npm run build:dsh        # 生成 packages/dsh/lib（含内联 core 与技能）

dsh plugin --profile web add link:"$PWD/packages/dsh"
```

**为什么用 `link:`**：它在 profile 里建一个指向源码的符号链接，之后重新构建就即时反映，
不需要每次重新安装。`file:` 则是复制快照，改源码不生效。

装完重启一次 DSH。

---

## 二、日常循环

```sh
npm run dev:dsh
```

它会同时做两件事：

| 监听 | 动作 |
| --- | --- |
| `packages/dsh/src/` 与 `packages/core/src/` | `tsc --watch` 增量重编译到 `lib/` |
| `packages/skills/*/SKILL.md` | 自动重新同步到 `lib/dsh/skills/` |

> **改完源码后要重启 DSH 才生效**——DSH 不热加载插件代码，rebuild 只更新磁盘上的产物。

不想常驻 watch 的话，改完手动跑一次：

```sh
npm run build:dsh
```

---

## 三、不重启 DSH 也能验证的部分

大部分逻辑其实不用经过 DSH：

```sh
# 直接调引擎（Node 直接跑 TypeScript）
node packages/core/src/cli.ts query 缓存穿透 --vault ~/你的库
node packages/core/src/cli.ts doctor --vault ~/你的库
node packages/core/src/cli.ts context --vault ~/你的库 --task "接下来做什么"

# 单元 / 集成 / 功能测试
npm test

# 只看某个模块
node --test tests/dsh-events.test.ts

# 真实 DSH 会话（需要模型路由）
npm run test:e2e
```

也可以直接在 Node 里 import 调用：

```sh
node --input-type=module -e "
const m = await import('./packages/core/src/retrieve.ts')
console.log(await m.retrieve('/绝对路径/你的库', '缓存穿透'))
"
```

---

## 四、调试清单

### 1. 插件有没有被加载

```sh
dsh --profile web --dump-config | grep -A3 pko-engine    # 组合树里有没有这一行
```

启动 DSH 时留意 stderr，出现下面这行说明**没加载成功**：

```
dsh: warning: 1 entry did not activate
pko-engine (@pko/dsh): failed to import: ...
```

### 2. 工具有没有注册

```sh
dsh --profile headless --patch account.yml --json "用 pko_lint 检查知识库健康度" | grep tool_call
```

事件流里出现 `{"type":"tool_call","tool":"pko_lint"}` 即说明工具可见且被调用。

### 3. 事件有没有触发

事件本身看不到，但**副作用看得到**：

| 想验证的事件 | 观察点 |
| --- | --- |
| `agent/created`（会话注入 + 投技能） | `<vault>/.dsh/skills/` 出现 8 个目录 |
| `agent/pre-step`（任务召回） | 模型回答里引用了库内容，且没有反复重复 |
| `tools/pre-execute`（写入闸门） | 让模型改 `.raw/`，文件字节级未变 |

### 4. 日志

`ctx.logger.info` 在默认日志级别下看不到（实测启动只输出一行 URL）。
开发期建议用**副作用**验证（写文件、投放技能），而不是靠日志。

---

## 五、源码与产物对照

`packages/dsh/tsconfig.json` 的 `rootDir` 是 `packages/`，所以一次编译同时产出 core 与 dsh：

```
packages/dsh/src/index.ts    →  packages/dsh/lib/dsh/src/index.js
packages/core/src/*.ts       →  packages/dsh/lib/core/src/*.js
packages/skills/*/SKILL.md   →  packages/dsh/lib/dsh/skills/*/SKILL.md
```

产物是**自包含**的：只 import `node:*` 和上表里的相对路径，不依赖宿主包。

---

## 六、常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 改了源码没生效 | 没重建，或没重启 DSH | `npm run dev:dsh`，然后重启 |
| `ERR_UNSUPPORTED_DIR_IMPORT` | patch 里把**目录**当 `name` | 指到 `lib/dsh/src/index.js` |
| 装了还是旧行为 | 用了 `file:` 装成快照 | 开发期改用 `link:` |
| 别人 git 装到旧版本 | 改了源码没提交 `lib/` | 提交前 `npm run build:dsh` |
| 工具报"不在任何 PKO vault 内" | 会话目录不在库内 | 在库根目录开会话，或配置 `vault` |

---

## 七、测试为什么串行跑

`npm test` 带 `--test-concurrency=1`。原因不是慢，是**确定性**：

- 并行跑时，`performance`（造 600 页库）、`concurrency`（起子进程抢锁）、`docs`（spawn CLI）
  会互相争 CPU，偶发超时（实测约 1/5 概率挂一例，单文件压测 8 轮全过、串行 10 轮全过）
- 串行整轮约 16 秒，换来的是结果稳定，值得

想并行跑（更快、更抖）：

```sh
npm run test:parallel
```

如果你发现某个用例在串行下也不稳定，那才是真问题，按下面的方式定位：

```sh
node --test tests/<某个文件>.test.ts
```

## 八、提交前

```sh
npm run test:all     # 测试 + 代码卫生 + 类型检查
npm run build:dsh    # 产物与源码保持一致
```

如果改的是插件行为，建议顺手跑一次真实会话验证：

```sh
npm run test:e2e
```
