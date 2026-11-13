---
name: pko-moc
description: MOC 健康检查与更新：孤立笔记、死链、近期内容归档、覆盖率报告
user-invocable: true
disable-model-invocation: true
---

# /pko-moc — MOC 健康检查与更新

## 执行步骤

1. **孤立笔记检测**：扫描 `40-Resources/`、`30-Areas/`、`20-Projects/` 中
   未被任何 `10-Atlas/moc-*.md` 链接的页面（`pko_lint` 的 `I_ORPHAN` 可直接用）。
   列出并建议归入哪个 MOC（看 tags 与所在目录）。

2. **MOC 死链检测**：检查各 MOC 里的 `[[链接]]` 是否指向真实存在的文件
   （`pko_lint` 的 `W_BROKEN_LINK`）。列出死链与修复建议（补页面 或 改成纯文本）。

3. **新内容归档建议**：读过去 7 天新建/修改的笔记，建议各自应归入哪个 MOC。

4. **执行修复**（用户确认后）
   - 在对应 MOC 添加缺失的链接（用 `edit`，只加行，不重排已有内容）
   - 死链：目标存在就改对路径，不存在就问用户要不要建

5. **输出健康报告**

   | 指标 | 值 |
   | --- | --- |
   | 总笔记数 | N |
   | 孤立笔记 | N |
   | MOC 覆盖率 | 已入 MOC / 总数 |
   | 建议下一步 | … |

## 规则

- 不要动 MOC 里的 Dataview / base 代码块——那是自动生成的视图
- 只链接真实存在的文件，不制造新的死链
