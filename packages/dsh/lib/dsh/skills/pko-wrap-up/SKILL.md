---
name: pko-wrap-up
description: 会话收尾：追加今日日记、重写热缓存、更新记忆层、给出下次入口
user-invocable: true
disable-model-invocation: true
---

# /pko-wrap-up — 会话结束

## 执行步骤

1. **更新今日日记**：把本次会话产出追加到 `70-Calendar/daily/YYYY-MM-DD.md`

   ```
   ## 会话产出 HH:MM
   - 做了什么
   - 关键决策
   - 下一步
   ```

   文件不存在时按 `_templates/daily-note.md` 创建后再追加。

2. **重写热缓存**：整体覆写 `50-Wiki/hot.md`（≤500 字），四个小节：

   ```
   ## Last Updated
   ## Key Recent Facts
   ## Recent Changes
   ## Active Threads
   ```

   这是下次会话恢复上下文的唯一依赖，必须写。

3. **更新记忆层**：如果本次会话发现了关于用户的新信息（偏好、决策、长期目标），
   建议更新 `brain/` 下对应文件（`about-me.md` / `key-decisions.md` / `patterns.md` / `memories.md`）。
   不要为了写而写。

4. **提醒 Inbox**：`glob 00-Inbox/*`，有未处理文件就提一句。

5. **输出会话摘要**：本次做了什么、下次从哪继续，一段话说完。

## 规则

- hot.md 是**整体覆写**，不是追加
- 日记是**追加**，不要覆盖当天已有内容
