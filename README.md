# pko-engine

独立于任何 Agent 框架的 PKO 知识引擎。

```
统一知识引擎 (@pko/core)
      ↑              ↑                ↑
 Claude Code      DeepSeek Harness   任意 MCP 客户端
      ↓              ↓                ↓
       统一 Obsidian 知识底座（Markdown · YAML · MOC · PARA · Wikilinks）
```

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | schema / vault / links / doctor / cli | ✅ |
| P1 | 锁 / 原子写 / manifest / policy / normalize / hook | ✅ |
| P2 | retrieve L1–L4 / context 三档 | 待做 |
| P3 | Claude Code 适配（skills + hooks + MCP） | 待做 |
| P4 | DSH 适配（零依赖 Cordis 插件 + bundle） | 待做 |
| P5 | graph / checkpoint / 语义 / 代码采集 | 待做 |

## 命令

```sh
node packages/core/src/cli.ts doctor    --vault ./fixtures/vault
node packages/core/src/cli.ts normalize --vault ./fixtures/vault          # dry-run
node packages/core/src/cli.ts normalize --vault ./fixtures/vault --apply  # 写盘
echo '{"hook_event_name":"SessionStart","cwd":"."}' | node packages/core/src/cli.ts hook --vault ./fixtures/vault
npm test
```

## 设计约束

1. `packages/core` 运行时只允许 `node:*`；出现框架依赖即为设计事故。
2. 适配器只做事件映射，业务逻辑一律在 core。
3. 写入必须走 `writePage`（锁 → 版本校验 → 归一化 → 原子写 → 日志）。
4. 改写页面时保留非契约 frontmatter 字段，绝不因为不认识就丢掉。

## 测试

```sh
npm test        # node --test tests/*.test.ts，12 例
```
