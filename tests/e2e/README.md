# 真实 DSH 会话 E2E

## 它验证什么

不是"插件能加载"，而是**钩子在真实 agent 会话里按顺序生效**：

| # | 断言 | 证据来源 | 为什么可信 |
|---|---|---|---|
| 1 | `SessionStart` 注入库上下文 | 事件流含 `[知识库] 本工作区有 PKO vault` | 该文本只由我们的 hook 产出 |
| 2 | `UserPromptSubmit` 注入相关页 | 事件流含 `[知识库提示]` 与 `cache-penetration` | 同上 |
| 3 | 正常写入被放行 | `00-Inbox/session-note.md` 存在 | 文件系统事实 |
| 4 | `PostToolUse` 自动补齐 frontmatter | 文件出现 `type: note` / `created:` | 提示词明确要求模型**不写** frontmatter，所以出现只可能来自 hook |
| 5 | `Stop` 提示更新 hot.md | 事件流含提醒文本 | 只由我们的 hook 产出 |
| 6 | `PreToolUse` 阻止覆盖 `.raw` | 文件字节级未变 | 文件系统事实 |
| 7 | 拒绝原因回到会话 | 事件流含拒绝文案 | 同上 |

**不断言模型说了什么**——LLM 输出不确定；断言的是注入痕迹与文件系统副作用。

## 前置条件

1. `dsh` CLI 可用（`dsh --version`）
2. headless profile 能访问模型：需要 `DEEPSEEK_API_KEY`，
   或改用已登录的 web profile（需重启 DSH）

缺少认证时脚本以 **exit 2 + `BLOCKED:`** 退出，不当作测试失败。

## 运行

```sh
node tests/e2e/dsh-session.mjs
# 或
npm run test:e2e
```

## 为什么不用 Claude Code 跑

本项目以 DSH 为目标宿主。CC 侧的 `settings.json` 是兼容层，DSH 的
`dsh-hooks-claude-code` 才是主路径；两者 payload 形状一致（bridge 会把 DSH 事件
翻译成 CC 钩子格式），所以这一个脚本同时覆盖两条路的契约。
