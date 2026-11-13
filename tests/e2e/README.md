# 真实 DSH 会话 E2E

验证 `@pko/dsh` 插件在**真实 agent 会话**里的行为，而不是"函数被调用时正确"。

## 它怎么跑

1. 建一个夹具 vault（含 hot.md、索引、一页知识、受保护的 `.raw/`，并 `git init`）
2. 建一次性 profile `pko-e2e-<pid>`（从 headless 模板）
3. `dsh plugin --profile <profile> add link:<repo>/packages/dsh`
4. 用 `--json` 跑 4 次会话，解析事件流
5. 结束后删除 profile

## 9 条断言

| # | 断言 | 证据 |
| --- | --- | --- |
| 1 | 插件被加载 | 启动 stderr 无 `did not activate` |
| 2 | agent 调用了 `pko_query` | 事件流 `tool_call.tool` |
| 3 | 会话开始投放了技能 | `<vault>/.dsh/skills/pko-query/SKILL.md` 存在 |
| 4 | 会话注入进入模型上下文 | 模型复述出 `hot.md` 里的原文 |
| 5 | 调用了 `pko_capture` 与 `pko_checkpoint` | 事件流 `tool_call` |
| 6 | 写入落盘且带完整 frontmatter | `00-Inbox/<标题>.md` 含 `type: note` / `created:` |
| 7 | 创建了 git 还原点 | `git for-each-ref refs/pko/ckpt` 非空 |
| 8 | `.raw` 未被改写 | 文件字节级未变 |
| 9 | 拒绝原因回到会话 | 事件流含 `.raw/` 或 `PKO 规则` |

不断言模型措辞——LLM 输出不确定；断言注入痕迹与文件系统事实。

## 前置条件

`dsh` CLI + 可用的模型路由。headless 默认只带 `llm-deepseek-account`，
缺少凭据层与 account 服务，E2E 的 overlay 会补三行：

```yaml
- id: credentials
  name: '@deepseek-ai/dsh-credentials-local'
- id: authorization
  name: '@deepseek-ai/dsh-authorization'
- id: deepseek-account
  name: '@deepseek-ai/dsh-deepseek-account-platform'
```

补上后 headless 可用 web 端已登录的账号路由（实测有效）。

缺认证时脚本以 **exit 2 + `BLOCKED:`** 退出，不当作失败。

## 运行

```sh
npm run test:e2e
```
