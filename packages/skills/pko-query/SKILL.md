---
name: pko-query
description: 基于知识库回答问题，按索引层级检索并注明来源
user-invocable: true
disable-model-invocation: true
---

# /pko-query — 知识库问答

## 检索顺序（由浅入深，命中即停）

1. `50-Wiki/hot.md` — 近期上下文
2. `50-Wiki/index.md` — 总目录
3. `10-Atlas/HOME.md` — 领域入口
4. `10-Atlas/moc-*.md` — 对应领域 MOC
5. 具体页面（`pko_read` 读全文）

也可以用 `pko_query` 一次完成 1–4 的检索，再 `pko_read` 读命中最高的 1–2 页。

## 回答规范

- 基于库里的实际内容回答，**注明来源文件路径**
- 库里没有 → 明确说「vault 中暂无此内容」，并建议是否需要摄取外部资料
- 发现页面互相矛盾 → 列出矛盾点等用户判断，不要自己选一个
- 回答后可以问一句「要不要把这次结论存进库」（走 `/pko-save`）
