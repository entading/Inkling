# EN_tool

个人英语学习知识沉淀库：Markdown 文件即数据，检索快、可互联、界面简洁美观。

## 快速开始

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- 服务端 API：http://127.0.0.1:3000（Vite 将 `/api` 代理到此处）

## 数据

手写 Markdown 文件即数据，存放在 `notes/` 下四个板块目录：

| 板块 | 目录 |
|---|---|
| 词汇 Vocab | `notes/vocab/` |
| 短语 Phrase | `notes/phrase/` |
| 长难句 Sentence | `notes/sentence/` |
| 语法 Grammar | `notes/grammar/` |

一个词条 = 一个 md 文件，文件名即 slug（板块内唯一）。支持 frontmatter 字段：`title`、`ipa`、`tags`、`source`、`created`、`updated`；无 frontmatter 时以文件名兜底。运行期间往目录丢入新 md 文件会自动收录，无需重启。

## 命令

- `npm run dev`：启动服务端（tsx watch）与前端（vite）
- `npm run build`：构建 server 与 web
