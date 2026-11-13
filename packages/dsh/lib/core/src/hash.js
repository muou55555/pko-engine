/** 内容哈希：增量判定的唯一依据。 */
import { createHash } from 'node:crypto';
/**
 * 计算内容指纹。
 * @param text 源内容
 * @returns `sha256:<hex>` 形式的指纹
 */
export function sha256(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
