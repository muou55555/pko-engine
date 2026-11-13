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
    '_templates',
    'brain',
    '.raw',
];
/** 种子文件：只在缺失时写入。 */
export const SEED_FILES = {
    'AGENTS.md': `# 知识库操作手册

> 每个会话开始时读这一份。它说明这个库怎么组织、怎么写入、有哪些禁区。

## 目录

\`\`\`
00-Inbox/      新内容第一落点，每日清空
10-Atlas/      MOC 导航层
20-Projects/   有截止日期的项目（work / personal）
30-Areas/      长期维护的领域（work / life）
40-Resources/  知识资源（concepts / how-to / references / clips）
50-Wiki/       结构化知识库：index.md / hot.md / log.md
60-Outputs/    产出物（文章 / 周报 / 演示 / 画布）
70-Calendar/   日记 / 周记 / 月记
80-Cards/      Zettelkasten 永久笔记
90-Archive/    归档（不删除，只归档）
brain/         记忆层（north-star / about-me / key-decisions / patterns / memories）
\`\`\`

## 每次会话的开始

1. 读 \`50-Wiki/hot.md\` —— 近期上下文
2. 读 \`brain/north-star.md\` —— 当前目标
3. 列出 \`00-Inbox/\` —— 待处理内容

## 写入规范

- 所有笔记必须有 frontmatter：\`date / type / tags\`（项目类加 \`status\`）
- 新内容先落 \`00-Inbox/\`，整理后再进 PARA
- 知识页优先写进 \`40-Resources/concepts/\` 或 \`50-Wiki/\`
- 在 \`40-Resources/concepts/\` 新建笔记后，同步在对应 \`10-Atlas/moc-*.md\` 加一行链接

## 安全规则

- **永不删除文件**，只归档到 \`90-Archive/\`
- \`.raw/\` 中的原始材料摄取后不可修改
- \`50-Wiki/log.md\` 只追加，禁止整体覆写
- 不静默覆盖：发现矛盾内容用 \`> ⚠️ 待确认：…\` 标注

## 检索顺序

\`50-Wiki/hot.md\` → \`10-Atlas/HOME.md\` → 对应 \`moc-*.md\` → 具体文件
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
    '10-Atlas/moc-work.md': `---
id: moc-work
title: 工作总览 MOC
type: moc
tags: [moc, work]
summary: 工作领域导航：项目、领域、周报
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 💼 工作总览

[[10-Atlas/HOME|← HOME]]

## 活跃项目

- （在 20-Projects/work/ 新建项目后，在这里加一行链接）

## 工作领域

- 公司日常
- 大模型 / AI
- 量化金融
- 科技分享
`,
    '10-Atlas/moc-life.md': `---
id: moc-life
title: 生活总览 MOC
type: moc
tags: [moc, life]
summary: 生活领域导航：小区、健身、旅游、智能家居
tier: supporting
created: 2026-01-01
updated: 2026-01-01
---

# 🌱 生活总览

[[10-Atlas/HOME|← HOME]]

## 领域

- 小区建设
- 运动健身
- 旅游
- 智能家居
- 日常生活
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
