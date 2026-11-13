---
name: pko-weekly
description: 生成本周周报（对外简洁版 + 个人完整版）
user-invocable: true
disable-model-invocation: true
---

# 周报

## 步骤

1. 确定本周范围（周一到今天）。
2. 读本周日记：`70-Calendar/daily/` 下本周文件。
3. 读本周新建/更新的项目页（`20-Projects/work/`）。
4. `pko_query` 查本周新增的知识页。
5. 提炼两版：
   - **对外版**：3–5 条工作成果 + 亮点 + 下周计划（可直接发送）
   - **个人版**：按领域分组成果 + 本周学到的最重要的一件事 + 下周三件事
6. 存到 `60-Outputs/weekly-reports/<YYYY-Www>.md`，并在日记里留一行索引。

## 规则

- 只写有据可查的事，不编造工作量
- 数字（页数、完成项）从实际文件里数出来
