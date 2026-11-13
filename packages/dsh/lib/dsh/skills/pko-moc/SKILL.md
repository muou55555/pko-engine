---
name: pko-moc
description: MOC 与知识库健康检查：孤立页、断链、缺失字段
user-invocable: true
disable-model-invocation: true
---

# 健康检查

## 步骤

1. **跑检查**：`pko_lint`，拿到 error / warn / info 计数。
2. **分类给建议**
   - 缺 frontmatter / type → `pko_normalize`（先不带 apply，看清单）
   - 断链 → 打开来源页，要么补页面，要么把链接改成纯文本
   - 孤儿页 → 建议归入哪个 MOC（看它的 tags 和目录）
3. **用户确认后**：`pko_normalize` 带 `apply: true` 批量补字段。
4. **不要动** MOC 里的 Dataview 代码块——那是自动生成的视图。

## 报告格式

| 类型 | 数量 | 建议动作 |
| --- | --- | --- |
| 缺字段 | N | 跑 normalize |
| 断链 | N | 逐条修 |
| 孤儿页 | N | 归入 MOC |
