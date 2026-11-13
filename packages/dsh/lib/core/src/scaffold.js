/**
 * 知识库骨架：检测与初始化。
 *
 * 目录约定来自 pko-vault 的实际结构（PARA + MOC + Wiki + Zettelkasten + Brain）。
 * 初始化只补缺：已存在的目录和文件一概不覆盖，可以反复执行。
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PkoError } from "./errors.js";
import { isGitRepo } from "./checkpoint.js";
import { runDoctor } from "./doctor.js";
import { scanVault } from "./vault.js";
import { MOC_SEEDS, TEMPLATE_FILES } from "./templates.js";
/** 标准目录（初始化时按顺序创建）。 */
export const STANDARD_DIRS = [
    '00-Inbox',
    '10-Atlas',
    '20-Projects',
    '20-Projects/work',
    '20-Projects/personal',
    '30-Areas',
    '30-Areas/work',
    '30-Areas/work/company',
    '30-Areas/work/llm',
    '30-Areas/work/quant',
    '30-Areas/work/tech-share',
    '30-Areas/life',
    '30-Areas/life/community',
    '30-Areas/life/fitness',
    '30-Areas/life/travel',
    '30-Areas/life/smart-home',
    '30-Areas/life/daily-life',
    '40-Resources',
    '40-Resources/concepts',
    '40-Resources/how-to',
    '40-Resources/references',
    '40-Resources/clips',
    '50-Wiki',
    '60-Outputs',
    '60-Outputs/articles',
    '60-Outputs/weekly-reports',
    '60-Outputs/presentations',
    '60-Outputs/canvases',
    '70-Calendar',
    '70-Calendar/daily',
    '70-Calendar/weekly',
    '70-Calendar/monthly',
    '80-Cards',
    '90-Archive',
    '_attachments',
    '_attachments/images',
    '_attachments/images/canvas',
    '_attachments/pdfs',
    '_attachments/pdfs/canvas',
    '_templates',
    'brain',
];
/** 种子文件：只在缺失时写入。 */
const CORE_SEEDS = {
    'AGENTS.md': `# 知识库操作手册

> 每次会话开始时读这一份。它说明这个库怎么组织、怎么写入、有哪些禁区。

## 目录结构

\`\`\`
00-Inbox/          所有新内容第一落点，每日清空
10-Atlas/          MOC 导航层（HOME + moc-<领域>.md）
20-Projects/       有截止日期的项目（work/ personal/）
30-Areas/          持续维护的领域
  life/            community/ fitness/ travel/ smart-home/ daily-life/
  work/            company/ llm/ quant/ tech-share/
40-Resources/      知识资源库（原子笔记）
  concepts/        概念解释
  how-to/          操作指南
  references/      参考资料
  clips/           摘录片段
50-Wiki/           结构化 Wiki（index.md / log.md / hot.md）
60-Outputs/        产出物（articles/ canvases/ presentations/ weekly-reports/）
70-Calendar/       日记 / 周记 / 月记（daily/ weekly/ monthly/）
80-Cards/          Zettelkasten 永久笔记（编号 YYMMDDHHmm）
90-Archive/        归档（不删除，只归档）
brain/             记忆层（north-star / about-me / key-decisions / patterns / memories）
_templates/        Obsidian 模板
_attachments/      附件（images/ pdfs/，画布素材在各自 canvas/ 下）
\`\`\`

## 每次会话必须执行的初始化

1. 读 \`brain/north-star.md\` —— 当前目标与优先级
2. 读 \`brain/memories.md\` —— 关键记忆索引
3. 读 \`50-Wiki/hot.md\` —— 近期上下文
4. 列出 \`00-Inbox/\` —— 待处理内容
5. 列出 \`20-Projects/work/\` —— 活跃项目

## 文件命名规范

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| 日记 | \`YYYY-MM-DD.md\` | \`2026-05-17.md\` |
| 周记 | \`YYYY-WNN.md\` | \`2026-W20.md\` |
| 月记 | \`YYYY-MM.md\` | \`2026-05.md\` |
| 项目 | \`[项目名].md\` | \`llm-agent-research.md\` |
| 知识卡片 | \`[YYMMDDHHmm]-[标题].md\` | \`2605171430-transformer-attention.md\` |
| Wiki 页面 | \`[主题].md\` | \`obsidian-workflow.md\` |
| MOC | \`moc-[领域].md\` | \`moc-llm.md\` |
| 会议 | \`[YYYY-MM-DD]-[主题].md\` | \`2026-05-17-llm-team-sync.md\` |

## 写入路由

| 内容 | 目标 |
| --- | --- |
| 新技术资料 | 原件存 \`00-Inbox/YYYY-MM-DD-<标题>.md\`，蒸馏页进 \`50-Wiki/<主题>.md\` |
| 技术方案 / 操作步骤 | \`40-Resources/how-to/\` |
| 概念 / 原理 | \`40-Resources/concepts/\` + \`80-Cards/\` |
| 工作决策 | \`20-Projects/work/<项目>/\` |
| LLM / AI | \`30-Areas/work/llm/\` |
| 量化 | \`30-Areas/work/quant/\` |
| 生活类 | \`30-Areas/life/<子目录>/\` |

新材料与原件都放 \`00-Inbox/\`：摄取后原件**留在原地**，不改、不删、不移动。

## 安全规则

- **永不删除文件**，只归档到 \`90-Archive/\`
- \`00-Inbox/\` 中的原件摄取后不再修改；需要加工的内容写到目标目录，不要改原件
- \`50-Wiki/log.md\` 只追加，禁止整体覆写
- 不静默覆盖：发现矛盾内容用 \`> ⚠️ 待确认：…\` 标注
- 写 \`[[链接]]\` 前先确认目标文件存在，不写死链

## 检索顺序

\`50-Wiki/hot.md\` → \`50-Wiki/index.md\` → \`10-Atlas/HOME.md\` → 对应 \`moc-*.md\` → 具体文件
`,
    'purpose.md': `---
id: purpose
title: Vault 定义
type: meta
tags: [meta]
summary: 这个知识库服务哪些目标、范围是什么
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# Vault 定义

这个库是个人知识操作系统，服务于：

1. 工作效能：记录决策、进展与技术知识
2. 持续学习：积累结构化知识
3. 内容创作：素材库与创作工作台
4. 生活管理：记录与规划

**核心原则**：先捕获，再整理；积累重于完美；用则维护。
`,
    '10-Atlas/HOME.md': `---
id: HOME
title: 首页导航
type: moc
tags: [moc]
summary: 知识库入口，导航到各领域 MOC
tier: core
created: 2026-01-01
updated: 2026-01-01
---

# 🏠 HOME

> 知识库入口。从这里导航到所有内容。

## 领域导航

| 领域 | MOC |
| --- | --- |
| 工作总览 | [[moc-work]] |
| 生活总览 | [[moc-life]] |

## 状态

[[50-Wiki/index]] · [[50-Wiki/hot]] · [[50-Wiki/log]]
`,
    '50-Wiki/index.md': `---
id: index
title: 索引
type: wiki
tags: [meta]
summary: 全部知识页的入口目录
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# Wiki 总目录

> 结构化知识库索引。新增页面后在此登记。
> 格式：\`- [[文件路径]] — 一行摘要 [更新日期]\`

## 概念

## 操作指南

## 参考资料
`,
    '50-Wiki/hot.md': `---
id: hot
title: 近期上下文
type: meta
tags: [meta]
summary: 会话开始时注入的近期上下文缓存
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 近期上下文

> 每次会话结束时完整覆写，500 字以内。让下次会话立即进入状态。

## Last Updated

（尚未开始）

## Key Recent Facts

## Recent Changes

## Active Threads
`,
    '50-Wiki/log.md': `# 操作日志（append-only）

> 每个操作追加一行：\`[YYYY-MM-DD HH:mm] 操作描述\`
`,
    'brain/north-star.md': `---
id: north-star
title: North Star — 目标与优先级
type: meta
tags: [meta]
summary: brain 记忆层文件
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 🌟 North Star — 目标与优先级

> 每次会话开始时读这一份。每月第一天更新。

## 当前阶段目标

- [ ] （写下这个月的第一个目标）

## 价值观与原则

- 深度优于广度
- 行动验证想法
- 持续复盘

## 当前关注重点

1. （写下最重要的一件事）
`,
    'brain/about-me.md': `---
id: about-me
title: 关于我
type: meta
tags: [meta]
summary: brain 记忆层文件
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 关于我

> 帮助助手了解你的偏好与习惯。

## 基本信息

- 职业：
- 语言偏好：中文写作，技术术语保留英文

## 工作偏好

- 文档风格：简洁、有结构、有行动项
- 决策偏好：

## 不喜欢的事

- 过度解释显而易见的事情
- 未经验证的建议
`,
    'brain/key-decisions.md': `---
id: key-decisions
title: 关键决策记录
type: meta
tags: [meta]
summary: brain 记忆层文件
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 关键决策记录

> 格式：\`## [日期] 决策标题 → 选择了什么 → 为什么\`

`,
    'brain/patterns.md': `---
id: patterns
title: 我的模式
type: meta
tags: [meta]
summary: brain 记忆层文件
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 我的模式

> 观察到的的工作与思维模式，用于提供更好的建议。

## 工作模式

## 思维模式

## 容易掉入的陷阱

`,
    'brain/memories.md': `---
id: memories
title: 记忆索引
type: meta
tags: [meta]
summary: brain 记忆层文件
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 记忆索引

> 重要事项的索引，条目格式：\`[日期] 事项 → [[链接]]\`

## 重要决策

## 进行中的重要事项

## 里程碑事件

## 待追踪的事项
`,
};
/** 全部种子文件：核心页 + MOC 导航 + Obsidian 模板。 */
export const SEED_FILES = { ...CORE_SEEDS, ...MOC_SEEDS, ...TEMPLATE_FILES };
/** 判断路径是否存在。 */
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 判断目录是否是（或包含）知识库。
 * @param root 目录
 * @returns 是否有 PKO 标记
 */
export async function hasVaultMarker(root) {
    for (const marker of ['.pko', '50-Wiki']) {
        if (await exists(join(root, marker)))
            return true;
    }
    return false;
}
/**
 * 计算初始化计划（不写盘）。
 * @param root 目标目录
 * @returns 计划与安全检查结果
 */
export async function planScaffold(root) {
    const dirs = [];
    const files = [];
    const existing = [];
    for (const dir of STANDARD_DIRS) {
        if (await exists(join(root, dir)))
            existing.push(dir);
        else
            dirs.push(dir);
    }
    for (const file of Object.keys(SEED_FILES)) {
        if (await exists(join(root, file)))
            existing.push(file);
        else
            files.push(file);
    }
    const marker = await hasVaultMarker(root);
    const entries = await readdir(root).catch(() => []);
    const needsForce = !marker && entries.filter((name) => !name.startsWith('.')).length > 0;
    return { root, dirs, files, existing, needsForce };
}
/**
 * 执行初始化。
 * @param plan 计划
 * @param options.force 目录非空且不是知识库时是否继续
 * @returns 实际创建与跳过的条目
 * @throws PkoError 目标目录不存在，或需要 force 而未提供
 */
export async function applyScaffold(plan, options = {}) {
    // 目标目录可以不存在：初始化本来就是"从零建库"，用户给的路径就是目的地
    await mkdir(plan.root, { recursive: true });
    if (plan.needsForce && options.force !== true) {
        throw new PkoError('PKO_NOT_EMPTY', `${plan.root} 不是空目录，也不像知识库。确认要在这里初始化请加 --force。`);
    }
    for (const dir of plan.dirs)
        await mkdir(join(plan.root, dir), { recursive: true });
    for (const file of plan.files) {
        const content = SEED_FILES[file];
        if (content === undefined)
            continue;
        await mkdir(join(plan.root, file, '..'), { recursive: true });
        await writeFile(join(plan.root, file), content, 'utf8');
    }
    return { createdDirs: plan.dirs, createdFiles: plan.files, skipped: plan.existing };
}
/**
 * 体检一个目录：是不是知识库、缺什么、健康度如何。
 * @param root 目录
 * @returns 状态摘要
 */
export async function vaultStatus(root) {
    const isVault = await hasVaultMarker(root);
    const missingDirs = [];
    for (const dir of STANDARD_DIRS) {
        if (!await exists(join(root, dir)))
            missingDirs.push(dir);
    }
    const { pages } = await scanVault(root).catch(() => ({ pages: [] }));
    const findings = isVault
        ? (await runDoctor(root)).counts
        : { error: 0, warn: 0, info: 0 };
    return {
        root,
        isVault,
        pages: pages.length,
        missingDirs,
        findings: { error: findings.error, warn: findings.warn, info: findings.info },
        git: await isGitRepo(root),
    };
}
