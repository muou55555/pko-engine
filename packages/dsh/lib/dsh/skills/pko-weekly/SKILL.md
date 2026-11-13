---
name: pko-weekly
description: 生成本周周报（对外简洁版 + 个人完整版），并归档到产出与日历目录
user-invocable: true
disable-model-invocation: true
---

# /pko-weekly — 周报生成

## 执行步骤

1. **确定范围**：本周一到今天（`YYYY-WNN` 用 ISO 周号）。
2. **读本周日记**：`70-Calendar/daily/` 下本周所有文件。
3. **读本周项目**：`20-Projects/` 中本周新建或更新的页面。
4. **读本周新增知识页**：`50-Wiki/log.md` 里本周的记录。
5. **读热缓存**：`50-Wiki/hot.md`。

## 提炼两版

**对外周报**（简洁，可直接发送）
- 本周完成的主要工作（3–5 条）
- 技术 / 业务亮点
- 下周计划

**个人周报**（完整）
- 工作成果（按领域：公司 / 大模型 / 量化 / 科技分享）
- 知识积累亮点
- 生活记录
- 本周学到的最重要的一件事
- 下周三件优先事项

## 归档

- 完整版 → `60-Outputs/weekly-reports/YYYY-WNN.md`
- 同步一份 → `70-Calendar/weekly/YYYY-WNN.md`
- 写入后由工具自动追加 `50-Wiki/log.md`；`hot.md` 在收尾时统一重写

## 规则

- 只写有据可查的事，不编造工作量
- 页数、完成项等数字从实际文件里数出来
