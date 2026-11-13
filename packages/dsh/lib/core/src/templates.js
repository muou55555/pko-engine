/**
 * 初始化用的生成内容：MOC 导航页与 Obsidian 模板。
 *
 * 结构与 pko-vault 保持一致（10-Atlas 每领域一个 MOC；_templates 八套模板）。
 */
import { TEMPLATE_FILES } from "./template-files.js";
/** MOC 领域定义。 */
const MOC_DOMAINS = [
    { id: 'work', title: '工作总览', summary: '公司日常、大模型、量化、科技分享', sections: ['活跃项目', '工作领域', '本周重点'] },
    { id: 'life', title: '生活总览', summary: '小区、健身、旅游、智能家居、日常', sections: ['生活领域', '近期关注', '待办'] },
    { id: 'llm', title: '大模型 / AI', summary: '模型、Agent、评测、工程实践', sections: ['核心概念', '工程实践', '论文与评测'] },
    { id: 'quant', title: '量化金融', summary: '策略、数据、回测、风控', sections: ['策略', '数据与工具', '回测记录'] },
    { id: 'tech-share', title: '科技分享', summary: '写作、演讲、社区分享素材', sections: ['选题', '素材', '已完成分享'] },
    { id: 'community', title: '小区建设', summary: '社区治理、邻里事务、公共议题', sections: ['议题', '进展', '相关记录'] },
    { id: 'fitness', title: '运动健身', summary: '训练计划、记录、身体数据', sections: ['训练计划', '记录', '复盘'] },
    { id: 'travel', title: '旅游', summary: '行程规划、游记、攻略', sections: ['计划', '游记', '攻略'] },
    { id: 'smart-home', title: '智能家居', summary: '设备、自动化、场景', sections: ['设备清单', '自动化', '折腾记录'] },
];
/** 生成一个 MOC 页面。 */
function mocContent(domain) {
    const lines = [
        '---',
        `id: moc-${domain.id}`,
        `title: ${domain.title}`,
        'type: moc',
        `tags: [moc, ${domain.id}]`,
        `summary: ${domain.summary}`,
        'tier: supporting',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        '---',
        '',
        `# ${domain.title}`,
        '',
        '[[10-Atlas/HOME|← HOME]]',
        '',
        ...domain.sections.flatMap((section) => [`## ${section}`, '', '- （新建笔记后在这里补一行链接）', '']),
    ];
    return lines.join('\n');
}
/** MOC 种子文件。 */
export const MOC_SEEDS = Object.fromEntries(MOC_DOMAINS.map((domain) => [`10-Atlas/moc-${domain.id}.md`, mocContent(domain)]));
export { TEMPLATE_FILES };
