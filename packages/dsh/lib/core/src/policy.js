const ALLOW = { allow: true };
/** 判定被拒绝。 */
function deny(reason, suggestion) {
    return { allow: false, reason, suggestion };
}
/**
 * 归一化相对路径：统一分隔符、去掉 `./` 与开头的 `/`。
 * @param relPath 原始路径
 * @returns 以 `/` 分隔的相对路径
 */
export function normalizeRel(relPath) {
    return relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
/**
 * 判定一次写操作是否允许。
 * @param input.relPath vault 内相对路径
 * @param input.tool 工具名（`write` / `edit`）
 * @param input.exists 目标文件当前是否存在
 * @returns 判定结果
 */
export function checkWrite(input) {
    const rel = normalizeRel(input.relPath);
    if (rel === '.raw' || rel.startsWith('.raw/')) {
        if (input.tool === 'edit') {
            return deny('.raw/ 中的文件是原始材料，摄取后不可修改（PKO 规则）', '如需加工，请从 .raw/ 读出来写到 40-Resources/ 等目标路径');
        }
        if (input.tool === 'write' && input.exists) {
            return deny('.raw/ 中已存在同名文件，禁止覆盖（PKO 规则）', '原始材料请换一个文件名，或写到其它目录');
        }
    }
    if (rel === '50-Wiki/log.md' && input.tool === 'write' && input.exists) {
        return deny('50-Wiki/log.md 是 append-only 操作日志，禁止整体覆写（PKO 规则）', '改用 edit 追加一行：[YYYY-MM-DD HH:mm] 操作描述');
    }
    return ALLOW;
}
/**
 * 判定一条 shell 命令是否触碰删除规则。
 *
 * 保守匹配：任何出现 `rm` 独立词的命令都拦，除非命令里出现 `90-Archive`。
 * 这条规则故意粗糙——它是"劝告"档，宁可让模型换一条命令，也不要它随手删文件。
 *
 * @param command shell 命令原文
 * @returns 判定结果
 */
export function checkBash(command) {
    if (!/\brm\b/.test(command))
        return ALLOW;
    if (command.includes('90-Archive'))
        return ALLOW;
    return deny('PKO 规则：永不删除文件，只归档到 90-Archive/', '把 `rm <file>` 换成 `mv <file> 90-Archive/`');
}
