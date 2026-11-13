---
name: pko-setup
description: 安装引导：从零开始装好 pko-engine，并把知识库目录建好或补齐
user-invocable: true
disable-model-invocation: true
---

# /pko-setup — 安装引导

用户在 DSH 里让你"安装这个项目"时，走这套流程。

**原则：一步步来，每步都要用户确认。不要替用户直接创建目录，不要生成 demo / 示例库。**

## 第 1 步：确认环境

```bash
node --version    # 需要 >= 22.18
dsh --version     # 需要 >= 0.2.2-rc.1
```

任一不满足就停下来，告诉用户要升级什么。不要跳过检查继续装。

## 第 2 步：安装插件

先问用户用哪种方式，再执行（不要替用户选）：

| 方式 | 命令 | 适合 |
| --- | --- | --- |
| 本地链接 | `dsh plugin --profile web add link:<仓库路径>/packages/dsh` | 自己改代码 |
| 本地 tgz | `npm run pack:dsh` 后 `dsh plugin --profile web add <tgz 路径>` | 稳定使用 |
| Git | `dsh plugin --profile web add "git+https://github.com/muou55555/pko-engine#path:packages/dsh"` | 已发布版本 |

装完提醒用户：**重启 DSH 才会生效**。

## 第 3 步：确认知识库目录

先问：**新建一个库，还是把已有目录补齐？**

### 3a. 新建

1. 建议一个路径（例如 `~/Documents/pko-vault`），但由用户最终决定
2. 调用 `pko_init(path, plan: true)` 预览，把目录与文件清单展示给用户
3. 用户同意后调用 `pko_init(path)` 执行
4. 不要跳过预览直接创建

### 3b. 已有目录

1. 调用 `pko_status` 看现状（是不是库、缺哪些标准目录、健康度）
2. 把缺失清单展示给用户，说明只会补缺、不会覆盖已有文件
3. 用户同意后调用 `pko_init(path)` 补齐
4. 补齐后再跑一次 `pko_status`，确认 `missingDirs` 为 0

## 第 4 步：验证

```
pko_status  → isVault: true，missingDirs: 0
```

再让用户看两件事：

- 库根目录的 `AGENTS.md`（这个库的操作手册）
- `50-Wiki/hot.md` 与 `brain/north-star.md`（会话开始时会被自动注入）

## 第 5 步：第一次使用

建议用户按顺序试：

1. `/pko-daily` —— 开工，看看建议
2. 往 `00-Inbox/` 丢一个文件，再 `/pko-ingest` —— 看摄入库
3. `/pko-query <问题>` —— 查自己的积累
4. `/pko-wrap-up` —— 收尾

## 禁止事项

- ❌ 不要自动创建任何示例库 / demo 目录
- ❌ 不要在用户确认前写任何文件
- ❌ 不要跳过环境检查
- ❌ 不要替用户决定库放在哪
