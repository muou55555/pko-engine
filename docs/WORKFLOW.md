# 知识库业务逻辑（标准流程）

这份文档回答一个问题：**有了 pko-engine 之后，知识库到底该怎么用。**

它按"内容的一生"和"时间节奏"两条线组织，每一步都写清：谁触发、引擎做什么、产物落在哪、怎么验收。

---

## 一、总览：四个循环

```
┌─ 每日循环 ─────────────────────────────────┐
│  开工 /pko-daily  →  工作中 /pko-save       │
│  收工 /pko-wrap-up                          │
└─────────────────────────────────────────────┘
┌─ 摄取循环（有新资料时）─────────────────────┐
│  丢进 00-Inbox  →  /pko-ingest  →  归档蒸馏 │
└─────────────────────────────────────────────┘
┌─ 每周循环 ─────────────────────────────────┐
│  周五 /pko-weekly  →  周末 /pko-moc         │
└─────────────────────────────────────────────┘
┌─ 随时循环 ─────────────────────────────────┐
│  /pko-query 查  ·  /pko-canvas 画  ·  改前 /pko_checkpoint │
└─────────────────────────────────────────────┘
```

---

## 二、内容的一生（七个阶段）

| 阶段 | 触发 | 发生了什么 | 产物 | 验收 |
| --- | --- | --- | --- | --- |
| 1. 捕获 | 你随手丢文件 / 说"记一下" | 新材料进 `00-Inbox/` | `00-Inbox/*.md` | 文件存在，没被加工 |
| 2. 判定 | `/pko-ingest` 或 `/pko-save` | 判断类型：技术 / 会议 / 工具 / 生活 | 口头的分类结论 | 能说出该进哪个目录 |
| 3. 蒸馏 | 同上 | 拆成 1–3 页，每页一个主题，带 summary | `50-Wiki/<主题>.md` 或 `40-Resources/...` | 每页有"我的理解"段落 |
| 4. 归档原件 | 摄取时 | 原件写进 `.raw/YYYY-MM-DD-<标题>.md` | `.raw/` 新文件 | 内容一字未改；此后不可编辑 |
| 5. 落位 | 摄取 / 保存 | 按路由表进 PARA 对应目录 | 目标目录出现新页 | 目录符合《写入路由》 |
| 6. 连接 | 摄取 / 保存 / `/pko-moc` | 在 index 与 `moc-*.md` 加链接 | 链接真实可跳转 | `pko_lint` 无断链 |
| 7. 登记与复盘 | 写入自动 + 收尾 | 追加 `log.md`；收尾重写 `hot.md` | `log.md` / `hot.md` | hot 里能看出最近在做什么 |

**核心原则**：先捕获，再整理；积累重于完美；用则维护。

---

## 三、每日循环

### 开工：`/pko-daily`

| 步骤 | 引擎动作 | 产物 |
| --- | --- | --- |
| 读目标 | 读 `brain/north-star.md` | — |
| 读上下文 | 读 `50-Wiki/hot.md` | — |
| 准备今日日记 | 不存在则按 `_templates/daily-note.md` 创建 | `70-Calendar/daily/YYYY-MM-DD.md` |
| 列待办 | 解析日记里的 `- [ ]` | — |
| 看 Inbox | 列出 `00-Inbox/` 文件 | — |
| 看项目 | 读 `20-Projects/work/` 中 `status: active` | — |

输出：今天最该做的 3 件事 + 待处理清单。

### 工作中：`/pko-save`

聊出结论、做完一个方案、学到新东西时调用。按路由表落位，并更新 MOC、追加日记。

### 收工：`/pko-wrap-up`

| 步骤 | 动作 | 产物 |
| --- | --- | --- |
| 追加日记 | 「会话产出」区块 | `70-Calendar/daily/` 追加 |
| 重写 hot | 四小节，≤500 字，**整体覆写** | `50-Wiki/hot.md` |
| 更新记忆层 | 有新认知时改 `brain/` | `brain/*.md` |
| Inbox 提醒 | 列出未处理文件 | — |

> `hot.md` 是下次会话恢复上下文的唯一依赖——收尾没写它，下次就等于失忆。

---

## 四、摄取循环

### 什么时候用

看到好文章、论文、工具文档，或 `00-Inbox/` 堆了东西。

### `/pko-ingest` 的完整流程

```
来源（URL / 文件 / 粘贴 / Inbox）
  ↓
1. 取内容（web_fetch / read / 直接用）
2. 原件存 .raw/YYYY-MM-DD-<标题>.md   ← 一字不改
3. 判定类型 → 决定目标目录
4. 蒸馏 1–3 页（含"我的理解 / 为什么重要"）
5. 写入（pko_ingest / pko_capture，contentHash 去重）
6. 更新 50-Wiki/index.md 与对应 moc-*.md
7. log.md 自动追加
```

### 质量标准（缺一不可）

- 每页有 summary，**措辞与正文不同**（检索摘要层靠它）
- 有「我的理解 / 为什么重要」段落
- 矛盾内容用 `> ⚠️ 待确认：…` 标注
- 至少 1 个双链，且只链接真实存在的文件

---

## 五、每周循环

### 周五：`/pko-weekly`

读本周日记 + 本周项目 + `log.md` 新增页 + `hot.md`，产出两版：

| 版本 | 内容 | 去处 |
| --- | --- | --- |
| 对外版 | 3–5 条成果 + 亮点 + 下周计划 | 直接发 |
| 个人版 | 按领域成果 + 学到的最重要的一件事 + 下周三个优先 | `60-Outputs/weekly-reports/YYYY-WNN.md` + `70-Calendar/weekly/YYYY-WNN.md` |

### 周末：`/pko-moc`

| 检查 | 工具 | 修复 |
| --- | --- | --- |
| 孤立笔记 | `pko_lint` 的 `I_ORPHAN` | 归入对应 MOC |
| MOC 死链 | `pko_lint` 的 `W_BROKEN_LINK` | 补页面或改纯文本 |
| 近 7 天新内容未归档 | 按目录与 tags 建议 | 加链接 |
| 覆盖率 | 已入 MOC / 总数 | 报告 |

---

## 六、随时任务

| 场景 | 触发 | 说明 |
| --- | --- | --- |
| 查自己的积累 | `/pko-query` | hot → index → HOME → MOC → 具体页；带来源；查不到明说 |
| 整理关系 | `/pko-canvas` | JSON Canvas，产物在 `60-Outputs/canvases/` |
| 批量改动前 | "先建个还原点" | `pko_checkpoint`，git ref 实现，不动工作区 |
| 库健康度 | `/pko-moc` 或 `pko_lint` | 0 error 为达标 |
| 不确定在哪 | `pko_status` | 是不是库、缺什么、健康度 |

---

## 七、内容放哪（决策树）

```
新材料？
├─ 是 → 00-Inbox/（先别管去哪）
└─ 否 → 是知识页？
   ├─ 概念/原理 → 40-Resources/concepts/ + 80-Cards/
   ├─ 操作步骤   → 40-Resources/how-to/
   ├─ 参考资料   → 40-Resources/references/
   ├─ 摘录片段   → 40-Resources/clips/
   ├─ 项目决策   → 20-Projects/work/<项目>/
   ├─ 长期领域   → 30-Areas/{work|life}/<子域>/
   ├─ 日记/周记  → 70-Calendar/{daily|weekly}/
   ├─ 产出物     → 60-Outputs/
   └─ 导航       → 10-Atlas/moc-<领域>.md
```

---

## 八、DSH 怎么承载这些

| 业务动作 | Claude Code 里 | DSH 里 | 是否等价 |
| --- | --- | --- | --- |
| 每日开工 | `/daily-start` | `/pko-daily` 技能 | ✅ 同流程 |
| 摄取 | `/ingest` | `/pko-ingest` 技能 | ✅ 同流程 |
| 会话沉淀 | `/save` | `/pko-save` 技能 | ✅ 同流程 |
| 查询 | `/wiki-query` | `/pko-query` 技能 | ✅ 同流程 |
| 周报 | `/weekly-digest` | `/pko-weekly` 技能 | ✅ 同流程 |
| MOC 体检 | `/moc-update` | `/pko-moc` 技能 | ✅ 同流程 |
| 收尾 | `/wrap-up` | `/pko-wrap-up` 技能 | ✅ 同流程 |
| 画布 | `/canvas` | `/pko-canvas` 技能 | ✅ 同流程 |
| 读上下文 | 读文件 | 插件**自动注入** hot + north-star | ✅ 更好：不用手动读 |
| 写入治理 | `.claude/hooks` 脚本 | `tools/pre-execute` 硬拦截 | ✅ 更强：不可绕过 |
| 会话中查库 | 手动读文件 | `pko_query` 工具自动召回 | ✅ 更好 |

**触发方式的差别**：Claude Code 用 `.claude/commands/*.md`；DSH 用 `~/.dsh/skills` 或
`<vault>/.dsh/skills` 下的技能。技能是**人类命令**（`disable-model-invocation: true`），
所以模型不会自作主张跑它们，你在会话里输入 `/pko-<名字>` 即可。

---

## 九、验收清单

一次完整的业务闭环，逐条打勾：

- [ ] `pko init` 或 `pko status` 确认库已就绪（`missingDirs: 0`）
- [ ] 新材料进 `00-Inbox/`，而不是直接塞进 PARA
- [ ] 摄取后 `.raw/` 有原件，且此后不可编辑
- [ ] 蒸馏页有 summary + 「我的理解」段落
- [ ] `50-Wiki/index.md` 与对应 MOC 有链接，`pko_lint` 无断链
- [ ] `log.md` 有本次操作记录
- [ ] `hot.md` 在收尾时被重写
- [ ] 周报落在 `60-Outputs/weekly-reports/` 与 `70-Calendar/weekly/`
- [ ] 想删文件时被拦，改为归档到 `90-Archive/`
- [ ] 批量改动前有还原点，可回滚
