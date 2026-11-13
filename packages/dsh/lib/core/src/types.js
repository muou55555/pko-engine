/**
 * PKO 核心数据契约。
 *
 * 词表刻意保持「读取宽容」：未识别的取值由 doctor 告警，而不是让整页解析失败——
 * 真实 vault 以手写为主，一个拼写错误不该让页面从检索面里消失。
 */
/** 页面类型（沿用 PKO 既有词表）。 */
export const PAGE_TYPES = [
    'daily', 'weekly', 'monthly', 'project', 'card', 'wiki',
    'meeting', 'article', 'clip', 'moc', 'note',
    // 真实库里常见的功能型页面：操作指南、参考资料、元数据页
    'how-to', 'reference', 'meta',
];
/** 成熟度与生命周期两套词表并存（README 与 CLAUDE.md 各定义一套）。 */
export const STATUSES = [
    'seed', 'developing', 'mature', 'evergreen',
    'active', 'draft', 'done', 'archived',
];
/** 来源可信度：extracted 源材料明确提取 / inferred 模型推断 / ambiguous 存疑。 */
export const CONFIDENCES = ['extracted', 'inferred', 'ambiguous'];
/** 重要性分层，检索打分的权重来源。 */
export const TIERS = ['core', 'supporting', 'peripheral'];
