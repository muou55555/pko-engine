# 最小示例知识库

第一次用不知道从哪开始？把这个目录复制一份，用 Obsidian 打开即可。

```sh
cp -R examples/minimal-vault ~/my-pko-vault
```

然后在 `~/my-pko-vault` 里开 DSH 会话，输入 `/pko-daily` 试试。

## 里面有什么

| 文件 | 作用 |
| --- | --- |
| `50-Wiki/index.md` | 检索的 L1 层（索引页） |
| `50-Wiki/hot.md` | 会话开始时注入的近期上下文 |
| `40-Resources/how-to/start.md` | 一页示例知识，带完整 frontmatter |
| `00-Inbox/` | 新内容的第一落点 |

## 结构可以随意改

引擎不绑定目录名，只要求 vault 里有 `50-Wiki/` 或 `.pko/` 作为识别标记。
你的现有 Obsidian 库只要有 `50-Wiki/` 就能直接用。
