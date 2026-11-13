---
name: pko-save
description: 把当前会话里有价值的内容沉淀进知识库
user-invocable: true
disable-model-invocation: true
---

# 会话沉淀

## 步骤

1. **识别值得留的东西**：技术方案、重要决策及理由、新概念、有价值的代码、观点。
   闲聊、临时调试输出不保存。

2. **判断路由**
   | 内容 | 目标 |
   | --- | --- |
   | 技术方案 / 操作步骤 | `40-Resources/how-to/` |
   | 概念 / 原理 | `40-Resources/concepts/` |
   | 工作决策 | `20-Projects/work/<项目>/` |
   | 生活类 | `30-Areas/life/<子目录>/` |
   | 今日亮点 | 追加到今日日记 |

3. **先查重**：`pko_query` 看是否已有同主题页；有就更新。

4. **写入**：`pko_capture`（单条）或 `pko_ingest`（多条）。

5. **回报**：告诉用户写到了哪里、为什么选这个位置。

## 边界

- 不确定放哪就放 `00-Inbox/`，不要猜
- 不覆盖既有内容，只追加或改写明确相关的段落
