---
name: pko-canvas
description: 在 Obsidian Canvas 上创建和管理可视化知识板
user-invocable: true
disable-model-invocation: true
---

# /pko-canvas — 可视化画布

画布文件是 JSON Canvas 1.0 标准（`{"nodes":[],"edges":[]}`），Obsidian 实时渲染。

- 画布目录：`60-Outputs/canvases/`
- 附件目录：`_attachments/images/canvas/`、`_attachments/pdfs/canvas/`

## 常用操作

| 意图 | 做法 |
| --- | --- |
| `/pko-canvas` | 读现有画布，报告节点数与分区 |
| `/pko-canvas new [名称]` | 新建 `60-Outputs/canvases/<名称>.canvas` |
| `/pko-canvas add text [内容]` | 追加文字节点 |
| `/pko-canvas add note [笔记名]` | 把知识库笔记钉到画布（`file` 节点） |
| `/pko-canvas add image [路径或URL]` | 图片节点（本地图先放进 `_attachments/images/canvas/`） |
| `/pko-canvas add pdf [路径]` | PDF 节点（先放进 `_attachments/pdfs/canvas/`） |
| `/pko-canvas add group [标签]` | 分区（group 节点，带 label 与颜色） |
| `/pko-canvas connect A B` | 在两节点间加边 |

## 节点字段

| 类型 | 关键字段 |
| --- | --- |
| `text` | `text`（Markdown，换行用 `\n` 单反斜杠）、`x/y/width/height` |
| `file` | `file`（vault 内相对路径）、尺寸 |
| `link` | `url`、尺寸 |
| `group` | `label`、`x/y/width/height`、`color` |

颜色：`1`红 `2`橙 `3`黄 `4`绿 `5`青 `6`紫。坐标原点在画布中心，节点 `x/y` 是左上角。

## 规则

- 写文件前先读现有画布，**追加**而不是覆盖（除非用户要求重建）
- 节点 id 用 16 位十六进制随机串，冲突就重新生成
- 图片 / PDF 先落到附件目录，再在画布引用相对路径
