# Inkling

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

个人英语学习知识沉淀库：Markdown 文件即数据，检索快、可互联、界面简洁美观。定位是**个人知识沉淀库**。

> 当前版本：v1.5.1

## 功能一览

- **四大板块**：词汇 Vocab（支持 IPA 音标）、短语 Phrase、长难句 Sentence、语法 Grammar；词汇/短语板支持 A–Z 字典序分组索引与最近更新排序切换
- **检索**：全局搜索（模糊 + 精确优先、键盘导航、全文开关）、命令面板（`Ctrl/Cmd + K`，快速跳转与主题切换）、板块内就地过滤、自由标签
- **录入与编辑**：新建页小表单生成骨架、编辑页分屏实时渲染（Ctrl+S 保存）、格式工具条、`[[` 双向链接补全、拖入/粘贴 md、暂停 3 秒自动草稿、frontmatter 丢失软保护
- **阅读体验**：衬线正文排版（思源宋体分片 self-host）、标题目录 TOC、代码块复制、上下篇导航、面包屑、反向引用面板、滚动位置记忆
- **标签**：标签实体注册表（8 色板自配色、色卡墙、详情页重命名 / 深度删除）+ 词条携带标签聚合显示；未注册的携带标签可一键批量注册（切换数据目录不再丢失）
- **阅读排版自定义**：设置页可选正文字体（内置预设或导入字体文件，服务端自动分片 self-host）、字号 / 行距档位、中文 / 英文侧覆盖范围
- **主题**：浅色 / 深色 / 跟随系统，全站设计令牌驱动
- **发音**：IPA 音标渲染、词条朗读、选中文本朗读（浏览器 TTS，可切换语音）
- **数据目录**：设置页可切换笔记所在目录（自动检查：空目录初始化四板块、目录合规直接加载、缺失板块目录可一键补齐；重启生效；写操作仅限本机）；支持查看 git 版本跟踪状态并一键启用
- **移动端**：响应式布局（767px 断点）、底部导航、横向 A–Z 条、阅览体验优先
- **局域网访问**：设置页一键开启，手机扫码访问（默认仅本机，重启后关闭）
- **版本管理**：git 全程跟踪笔记，删除词条与标签批量操作后台自动提交（误删可救；提交跟随当前数据目录）
- **桌面应用**（Windows）：安装即用、关闭窗口驻留托盘、应用内检查更新与一键升级

## 桌面版安装

从 [Releases](https://github.com/entading/Inkling/releases/latest) 下载 `Inkling Setup x.x.x.exe` 运行即可（Windows 10/11，按用户安装，无需管理员权限）。安装包未做代码签名，SmartScreen 首次提示时点「更多信息 → 仍要运行」。

- **应用内更新**：设置 → 关于 → 检查更新；发现新版本后点「下载并安装」，下载完成点「安装并重启」
- **双形态同源**：桌面版与网页版（下方「快速开始」自建）读写同一套 Markdown 数据，`设置 → 数据目录` 可指向同一目录
- **首启引导**：桌面版首次使用（默认目录且没有任何词条）会出现引导横幅，点「去设置」选择你的笔记文件夹；关闭后不再显示

## 快速开始（网页版）

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173 （**浏览器访问必须用 localhost**，127.0.0.1:5173 会被拒绝）
- 服务端 API：http://127.0.0.1:3000 （Vite 将 `/api` 代理到此处）

## 数据

手写 Markdown 文件即数据，默认存放在 `notes/` 下四个板块目录（词汇 `vocab/`、短语 `phrase/`、长难句 `sentence/`、语法 `grammar/`）。一词条 = 一个 md 文件，文件名即 slug；运行期间往目录丢入新 md 文件会自动收录，无需重启；正文格式完全自由。

- **数据目录可切换**：设置页「数据目录」卡片可指定其他文件夹（自动检查目录状态，空目录一键初始化板块结构）；切换重启后生效，原目录文件原样保留可随时切回
- **全局数据**（不随数据目录切换）：标签注册表 `data/tags.json`、导入字体 `data/fonts/`、应用配置 `data/app-settings.json`。网页版在仓库 `data/` 下；桌面版在 `%APPDATA%\Inkling\` 下

### 从旧数据迁移

- **笔记**：整目录拷贝即可。桌面版安装后到「设置 → 数据目录」指定你的文件夹（支持 Obsidian 等已有 Markdown 目录，板块目录外的 md 不受影响）
- **标签注册表**（颜色与注册日期不随笔记目录走）两条路径任选：
  - 手动拷贝旧环境的 `tags.json` 到新环境的全局数据位置（网页版 = 仓库 `data/tags.json`；桌面版 = `%APPDATA%\Inkling\tags.json`）——**保留 created 注册日期**
  - 或在新环境打开标签页，对未注册的携带标签一键「批量注册」——颜色按当前显示色保留，但 created 会重置为注册当天

**frontmatter 约定**（`---` 围栏 YAML，全部字段可选，正文格式自由）：

```markdown
---
title: abandon          # 词条标题，缺省 = 文件名
ipa: /əˈbændən/         # 音标（词汇板渲染）
tags: [cet6, 高频]       # 标签数组
source: 真题 2024 Text 2 # 来源
created: 2026-09-01     # 创建日期，缺省 = 文件创建时间
updated: 2026-09-04     # 更新日期，缺省 = 文件修改时间
---

正文 Markdown……
```

显式写入的 `created`/`updated` 不会被自动更新；日期按所写值展示。

## 命令

- `npm run dev`：启动服务端（tsx watch）与前端（vite）
- `npm run dev:desktop`：桌面版三进程开发（server + vite + electron 壳）
- `npm run build`：构建 server 与 web（类型检查 + 打包）
- `npm run build:desktop`：打桌面版安装包（产物 `desktop/release/Inkling Setup <版本>.exe`）
- `npm run build:fonts`：重新生成内置字体分片（日常无需使用）

## 维护者：发布流程

手动发布，不上 CI：

1. 四处 `package.json` 同步 bump 版本（根 / `server/` / `web/` / `desktop/`——桌面版 version 即安装包与「关于」卡展示的版本）
2. 仓库根执行 `npm run build:desktop`（本机链路依赖 winCodeSign 预置缓存与 npmmirror 镜像 env，见 docs/e1-electron/）
3. 自测 `desktop/release/win-unpacked` 能正常启动
4. `gh release create vX.Y.Z --target develop --notes "…"`，上传资产三件：`Inkling Setup X.Y.Z.exe`、`latest.yml`、`Inkling Setup X.Y.Z.exe.blockmap`（**缺 latest.yml 应用内更新通道即失效**）
5. 用旧版本应用内「检查更新」验证能发现新版本并完成升级

## License

[MIT](LICENSE)
