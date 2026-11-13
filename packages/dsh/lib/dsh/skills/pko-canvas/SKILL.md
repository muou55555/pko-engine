---
name: pko-canvas
description: 在 Obsidian Canvas 上创建和管理可视化知识板
user-invocable: true
disable-model-invocation: true
---

# 画布

画布文件是 JSON Canvas 1.0 标准，Obsidian 实时渲染。

## 文件格式

```json
{ "nodes": [], "edges": [] }
```

## 节点

| 类型 | 关键字段 |
| --- | --- |
| `text` | `text`（Markdown，换行用 `\n` 单反斜杠）、`x/y/width/height` |
| `file` | `file`（vault 内相对路径，不含根目录）、尺寸 |
| `link` | `url`、尺寸 |
| `group` | `label`、`x/y/width/height`、`color` |

颜色：`1`红 `2`橙 `3`黄 `4`绿 `5`青 `6`紫。坐标原点在画布中心，节点 x/y 是左上角。

## 边

```json
{ "id": "16位hex", "fromNode": "…", "toNode": "…", "fromSide": "right", "toSide": "left", "toEnd": "arrow", "label": "关系" }
```

## 操作

1. **先读后写**：读现有画布，取全部 id，避免重复。
2. **ID 规则**：16 位小写十六进制（`crypto.randomBytes(8).toString('hex')`）。
3. **自动定位**：放进指定分区，从区内最右节点的右边 40px 开始；超出分区宽度就换行。
4. **写回**：整体写 JSON，不要追加字符串。

## 路径

- 画布：`60-Outputs/canvases/<name>.canvas`
- 图片：`_attachments/images/canvas/`
- PDF：`_attachments/pdfs/canvas/`
