# UI-M2' 实施记录（排版·图标·板块色）

> 状态：**已完成（2026-08-31）**
> 设计权威：`UI优化设计方案.md` §3 / §4 / §5 / §12；本记录只做 M2' 范围。

## 执行计划（文件 × 改动点）

### 0. 字体分片管线（路线 B，先行动作）

1. **源字体获取**：notofonts/noto-cjk GitHub release `Serif2.003` 资产 `14_NotoSerifSC.zip`（Noto Serif SC 官方静态字重集，68.9MB）下载到系统临时目录，取 `Regular`/`Bold` 两档 OTF；源字体不入库，OFL 许可证随产物入库。
2. **`web/package.json`**：devDependencies 加 `cn-font-split`（本轮唯一新依赖）；scripts 加 `build:fonts`。
3. **`package.json`（根）**：scripts 加 `build:fonts`（转 web workspace）。
4. **`web/scripts/build-fonts.mjs`（新建）**：调 cn-font-split `fontSplit()` 切 Regular(400)/Bold(700) 两档 → woff2 分片 + unicode-range CSS 产出到 `web/public/fonts/`；脚本内合并两档 CSS、改写为 `/fonts/` 绝对路径，写出 `web/src/styles/fonts.css`（family 精确 `Noto Serif SC Web`、`font-display: swap`）；OFL 许可证拷入 `web/public/fonts/`。一次性执行，产物提交入库，常规构建不重跑。
5. **`web/src/main.ts`**：`import './styles/fonts.css'`（tokens.css 之后）。

### A. 正文衬线与排版

6. **`web/src/styles/tokens.css`**：
   - `:root` 新增 `--font-serif`（照抄 §3 全栈）、`--text-body: 1.0625rem`、`--font-mono`（等宽栈，供 .note-body code/pre/kbd/samp 引用，避免组件散写字体栈）。
   - 标签 8 组柔和对 `--tag-{0..7}-bg` / `--tag-{0..7}-c`（blue/teal/amber/green/violet/rose/cyan/orange；light=soft 底+strong 字，dark=低透明度 rgba 底+400 档提亮字，策略同 M1' 板块深色变体）+ `--tag-hover-overlay`（hover 加深/提亮共享覆盖色，light 压暗 / dark 提亮）。
7. **`web/src/components/MarkdownViewer.vue`**（`.note-body` 排版唯一改动点）：
   - `.note-body`：`font-family: var(--font-serif)`、`font-size: var(--text-body)`、`letter-spacing: 0.01em`、`text-autospace: normal`、`orphans: 2; widows: 2`；行高 1.8 保持。
   - 段间距 `p { margin: 0.9em 0 }`（原 0.6em）；`p { text-wrap: pretty }`；正文内 `h1/h2/h3 { text-wrap: balance }`。
   - `code/pre/kbd/samp` 加 `font-family: var(--font-mono)` 防衬线污染。
   - blockquote：背景 `--color-bg` → `--color-surface-2`，补 `line-height: 1.6`（accent 边条已有）。
   - 正文链接从 `border-bottom` 迁移到真下划线：`text-decoration: underline` + `text-underline-offset: 3px` + `text-decoration-thickness: 1px`（md 链接实线用 `--wiki-underline`，wiki 链接 dashed 用 `--wiki-underline-missing`，hover/focus 语义不变）——border 方案无法应用 offset/thickness 两个规格，属达成 §3 的必要迁移。
   - 字号：body → `--text-body`；h1 → `--text-xl`；h2 → `--text-lg`；h3 → `--text-body`（h3 以正文字号+UA 默认加粗呈现，保证 h1>h2>h3≥body 层级且全部映射 ≤0.05rem，理由见偏离表）；其余散写值归入阶梯。
8. **字号阶梯替换**（映射表见下文「字号映射总表」）：`App.vue`、`AZIndex.vue`、`NewNote.vue`、`Home.vue`、`NotFound.vue`、`Settings.vue`、`Board.vue`、`EditView.vue`、`NoteView.vue`、`NoteList.vue`、`SearchPanel.vue`、`TagBadge.vue`、`TagDetail.vue`、`Tags.vue`、`MarkdownViewer.vue`（除两处特判外）——仅替换 `font-size: Xrem` 模式，`em` 相对值（Tags 云标签 0.7em、md-viewer 0.9em/0.95em）不动；`NotFound` 3rem 显示数字远超阶梯保留。

### B. 图标与空状态

9. **`web/src/components/Icon.vue`（新建）**：`name` + `size`(16/20) props；内联注册 24 枚图标 inner-SVG（home/book/link/align-left/graduation-cap/tag/settings/plus/search/pencil/trash/more/x/chevron-up/down/left/right/arrow-up/copy/check/sun/moon/monitor/list），`viewBox="0 0 24 24"`、`stroke="currentColor"`、`stroke-width="1.8"`、`fill="none"`、圆角端点；不引图标库。
10. **`web/src/App.vue`**：侧栏导航项（首页/四板块/标签/设置）加 16px 图标（home/book/link/align-left/graduation-cap/tag/settings），布局改 flex；图标色随 currentColor（默认 text-secondary、激活 accent，不用板块色）。移动端底部导航项加 20px 图标 + 纵向排布（图标+文字）。
11. **`web/src/views/Home.vue`**：板块卡加图标 chip（40px 圆角方块，`background: var(--board-*-soft)`、`color: var(--board-*)`）+ 计数文字色改 `var(--board-*)`（按卡片 board class 定色；标签/标题保持中性色）。
12. **`web/src/components/EmptyState.vue`（新建）**：内联 SVG 简笔插画（摊开的书 + 散点，accent-soft 单色系，颜色全部走令牌）+ `title`/`description` props + 默认插槽放自定义 CTA。
13. **三处替换**：`NoteList.vue`「暂无词条」（描述 + CTA「新建词条」→ /new）；`Board.vue` 搜索无结果（标题含当前关键词 + CTA「清除搜索」清 query）；`Tags.vue` 空态（标题「暂无标签」+ 沿用原描述）。

### C. 板块个性色与标签配色

14. **`web/src/lib/tagColor.ts`（新建）**：djb2 hash → `% 8` 稳定取色函数 `tagPairIndex(tag)`，TagBadge 与 Tags 云标签共用（写一份）。
15. **`web/src/components/TagBadge.vue`**：按 hash 加 `tag-pair-{0..7}` class 引用令牌（8 组背景/文字色）+ hover 叠加 `--tag-hover-overlay`（background-image 线性渐变叠底，不动文字色）。
16. **`web/src/views/Tags.vue`**：云标签同步引用同一 `tag-pair-N` 令牌组（交付物要求「标签页（8 色）」截图；若云标签保持单色蓝则该验收项无以呈现，属同一令牌系统的复用，非新增色值）。

### 收尾

17. **验证**：`npm run build` + `npm run build:fonts` 复现 → dev/preview 走查矩阵 12 页 × 浅/深 → 衬线边界检查 → 字体按需加载（resource entries + fonts.check）→ 深色语法长文衬线笔画 → 浅色观感对比 → 空状态 → 移动端 375×812。
18. **截图** ≥8 张 → `UI-M2截图/`。
19. **回写**：`UI优化设计方案.md` §12 M2' 行完成标注；`AGENTS.md` 沉淀新约束。
20. **提交**：feat（代码+字体产物）+ docs（实施记录+截图+§12+AGENTS），只 add 明确文件。

## 偏离与理由（边做边记）

1. **字体源获取方式**：raw.githubusercontent.com 超时（000），github.com 主站可达。经 GitHub Release API 列资产后走 release 下载直链（重定向到 release-assets.githubusercontent.com，首次下载 SSL 中断一次，重试成功）：`notofonts/noto-cjk` release `Serif2.003` 的 `14_NotoSerifSC.zip`（68.9MB，Noto Serif SC 官方静态字重集），取 `SubsetOTF/SC/NotoSerifSC-{Regular,Bold}.otf` 两档 + `LICENSE`（OFL）。源字体放 `web/scripts/font-src/`（已 gitignore 不入库，获取方式写入脚本头注释）；OFL 许可证随产物拷入 `public/fonts/serif/OFL-NotoSerifSC.txt` 提交。
2. **cn-font-split 在 Windows 上 Node 进程退出段错误（0xC0000005）**：Rust FFI（libffi-x86_64-pc-windows-msvc.dll）在进程退出清理阶段崩溃，此时产物已全部落盘、功能完整。脚本尾部 `process.exit(0)` 规避（同步写盘在前，无截断风险）。复跑验证 `npm run build:fonts` 退出码 0。
3. **工具生成 CSS 含非确定性注释**：cn-font-split 产物 css 头部注释带 `CreateTime` 时间戳与字体元数据，直接并入会导致重跑产物不一致；脚本内剥除全部块注释后再写 fonts.css（分片规则本体为单行压缩格式，无语义注释）。
4. **build:fonts 重跑"等价"而非"逐字节一致"（已知限制）**：两次完整重跑对比，@font-face 规则结构、分片数量（400: 292 片、700: 300 片）与绝大多数分片内容逐字节一致，但**少数 woff2 文件名（内容哈希）因并行 worker 打包顺序不同而重排**（400 差 3 片、700 差 3 片，无工具选项控制并发/顺序）。处理：提交态的产物为唯一权威版本，提交后不再重跑；验证结论按"重跑生成等价产物"记录。
5. **产物体积 29MB 高于设计预估 10~20MB**：400 共 14MB（292 片）+ 700 共 15MB（300 片），思源宋体全字集两档即此量级。单页实际只命中个位数分片，运行时传输量不受影响；仓库体积属一次性成本。
6. **正文链接从 `border-bottom` 迁移到真下划线**：§3 要求 md 链接 `text-underline-offset: 3px` + `text-decoration-thickness: 1px`，border 方案无法应用这两个属性；md/wiki 链接统一迁移到 `text-decoration: underline`（wiki 虚线用 `text-decoration-style: dashed`，hover/focus 语义一一对应保留）。视觉差异：下划线位置从行框底部上移到距基线 3px 处。
7. **正文内 h3 字号映射为 `--text-body`（1.0625rem，加粗分层）**：阶梯（…0.95/1.0/1.1/1.4…）无 1.05 档位；若 h2→1.1 且 h3→1.1 会破坏层级，h3→0.95 又低于正文。取 h3=正文同字号+UA 默认加粗，映射差 +0.0125rem（≤0.05），层级保持 h1(1.4) > h2(1.1) > h3(1.0625 粗) ≥ 正文(1.0625)。
8. **标题显式 `letter-spacing: normal`**：§3 的 0.01em 针对"正文参数"，并写明"标题沿用现有字距"；letter-spacing 可继承，不重置的话正文内 h1–h3 会被动获得 0.01em，故在标题规则中显式回到 normal。
9. **新增 `--font-mono` 令牌**（设计文档未列）：.note-body 内 code/pre/kbd/samp 防衬线污染需要等宽栈，按令牌纪律落 tokens.css 再引用，避免组件散写字体栈。
10. **标签 8 色的"应用类" `.tag-pair-{0..7}` 放 tokens.css 全局**而非组件 scoped：a) TagBadge 与 Tags 云标签两处共用一份绑定；b) 组件基类若自带底色，scoped 特异性（类+attr）会压过全局 pair 类——基类改为不带底色/文字色，由 pair 类统一供给。hover 用共享 `--tag-hover-overlay`（浅色压暗 rgba(31,41,55,0.06) / 深色提亮 rgba(255,255,255,0.06)）以 background-image 叠加实现，1 组令牌覆盖 8 色，组件内零散写色值。
11. **Tags 云标签同步接入 8 色**：设计文档 §5 只点名 TagBadge，但交付物要求「标签页（8 色）」截图——云标签若保持单色蓝则该验收无法呈现；复用同一 `.tag-pair-N` 应用类，未新增任何色值，记录为有意扩展。
12. **板块页搜索无结果的 CTA 取「清除搜索」**：该空态由搜索触发，"新建词条"与语境不符；改为插槽按钮清除 query 还原列表（自行设计，记录在此）。NoteList 空态 CTA 为「新建词条」（/new）。
13. **深色标签 hover 方向反转**：浅色"加深"在深色下改为轻微提亮（暗底上继续压暗会失去对比），与 M1' 板块深色变体的提亮策略同思路，由 `--tag-hover-overlay` 深色值承载。

## 字号映射总表

阶梯：`--text-xs 0.78` / `--text-sm 0.88` / `--text-base 0.95` / `--text-md 1.0` / `--text-lg 1.1` / `--text-xl 1.4` / `--text-2xl 1.7` / 特殊 `--text-body 1.0625`。

| 原值 | 归入 | 差值 | 说明 |
|---|---|---|---|
| 0.72 / 0.75 / 0.78 / 0.8 / 0.82 | xs | 0.72→+0.06（>0.05 列出）；其余 ≤0.05 | wiki 预览小徽标等 |
| 0.85 / 0.88 | sm | ≤0.03 | |
| 0.9 / 0.92 / 0.93 / 0.95 | base | ≤0.05 | |
| 0.98 / 1 | md | ≤0.02 | |
| 1.05 / 1.1 / 1.15 | lg | ≤0.05 | 例外：正文内 h3 1.05→--text-body（偏离 #7） |
| 1.3 / 1.35 / 1.4 / 1.5 | xl | **1.3→+0.1、1.5→−0.1（列出）**；1.35→+0.05 | 1.3=NotFound 副标题、1.5=板块卡计数数字 |
| 1.6 / 1.7 | 2xl | **1.6→+0.1（列出）** | 1.6=首页主标题 |
| 0.9em / 0.95em / 0.7em（em 相对值） | 不动 | — | 行内代码/表格/云标签计数随上下文缩放 |
| 3rem（NotFound 显示数字） | 不动 | — | 阶梯外的装饰性大字 |

**>0.05rem 全部清单（5 项）**：0.72→xs（+0.06，wiki 预览标签）、1.3→xl（+0.1，404 副标题）、1.5→xl（−0.1，板块卡计数）、1.6→2xl（+0.1，首页标题）、正文 h3 1.05→--text-body（+0.0125，≤0.05 但为层级决策）。其中首页标题与板块卡计数同屏对比时可感知（±1.6px），其余不可感知；观感对比截图见验证项 6。

## 验证结果矩阵

**dev（localhost:5173）+ preview（localhost:4173，生产构建），Chromium 内置浏览器（IAB），视口 1280×720 / 移动 375×812**

### 构建与管线（验证项 1）

- [x] `npm run build` 通过（server tsc + web vue-tsc -b + vite build，164 modules）；两次构建产物哈希一致（`index-DFCE8irX.css` / `index-YLbPhzWz.js`）
- [x] `npm run build:fonts` 退出码 0；重跑生成**等价**产物（分片数、规则结构一致，少数分片哈希重排，见偏离 #4）；提交态产物 = 权威版本
- [x] fonts.css 由脚本生成（family `Noto Serif SC Web`、`font-display: swap`、592 条 @font-face 全带 unicode-range、URL 为 `/fonts/serif/...` 绝对路径）

### 走查矩阵 12 页 × 浅/深（验证项 2）

- [x] 12 页面 = 首页 / 词汇 / 短语 / 长难句 / 语法 / 阅读（临时词条 m2-check）/ 编辑 / 新建 / 标签 / 标签详情 / 设置 / 404
- [x] 浅色：12/12 零横向滚动、零加载错误、data-theme=light、bg #fafafa
- [x] 深色：12/12 零横向滚动、零加载错误、data-theme=dark、color-scheme dark、layout bg #101418
- [x] 板块卡图标 chip 与计数色（浅色 #3b82f6/#0d9488/#d97706/#16a34a；深色 rgba soft 变体 + 400 档亮字）双主题断言通过
- [x] 图标全站无缺失无变形：侧栏 7（首页/四板块/标签/设置）、移动底部 5、板块卡 4；默认 text-secondary、激活/悬停随 currentColor accent
- [x] 标签 8 色双主题可读：浅色 soft 底+600/700 档字、深色 rgba 底+400 档字；标签页 10 个标签覆盖 7/8 对色（green 未被现有标签 hash 命中，属正常分布）
- [x] hover 实测（真实指针）：`background-image: linear-gradient(var(--tag-hover-overlay))` 叠加生效、文字色不变（浅色压暗 rgba(31,41,55,.06)）

### 衬线边界（验证项 3）

- [x] `.note-body`：font-family = §3 全栈；17px（--text-body）/ 1.8 行高（30.6px）/ letter-spacing 0.17px（0.01em）/ 段距 0.9em（15.3px）；`text-autospace: normal`、`orphans/widows: 2` 生效
- [x] 阅读页标题「m2 排版验证」与 UI 层仍 Inter 无衬线；`.ipa` 仍 Noto Sans 无衬线（/m2ˈtʃek/ 实测）
- [x] 正文内 h1–h3 衬线 + `letter-spacing: normal`（标题字距保持）；h2 17.6px、h3 17px+700（偏离 #7）
- [x] 行内 code / pre / pre code 均为 ui-monospace 等宽栈，无衬线污染
- [x] blockquote：`--color-surface-2` 底（#f3f4f6）+ accent 边条 + 行高 1.6（27.2px）+ 衬线
- [x] md 链接 `text-decoration: underline / offset 3px / thickness 1px`；wiki 链接 dashed、缺失红 dashed、focus-visible 底色——语义与迁移前一致
- [x] 编辑页预览（同 MarkdownViewer）随衬线一致（深色走查实测）

### 字体分片按需加载（验证项 4，preview 生产构建）

- [x] 阅读页（m2-check，71 个不同字符）首访实际下载 **26 片、单片 9~48KB、合计 717KB**；可用分片 592 片，无全量下载
- [x] `document.fonts.check('17px "Noto Serif SC Web"', 样本)` = true；700 加粗面 = true；浅/深两主题正文均衬线
- [x] Windows 上拉丁字符由本地 Cambria 承接（栈内首位可用字体），240KB 拉丁全局包**实际不触发下载**；仅无本地衬线的平台（Linux/Android）会加载
- [x] swap 无可感知闪替（本地加载 <100ms/片；无 FOIT）

### 深色衬线笔画专项（验证项 5）

- [x] 非谓语动词.md 深色整页截图（`grammar-dark-full.png`）：衬线笔画清晰、不发虚，粗体标签（规则：/例句：/易错点：）700 面正常、斜体英文正常——**无需**在深色层把 `--font-serif` 首选换 Cambria

### 浅色观感对比（验证项 6，对照 UI-M1截图/）

- [x] 首页/板块页/阅读页对照 M1' 截图：布局、间距、颜色除以下**有意差异**外无变化——(a) 本里程碑功能：侧栏/底部图标、板块卡 chip 与计数色、标签 8 色；(b) 已列 >0.05rem 映射 4 项（首页标题 1.6→1.7、板块计数 1.5→1.4、404 副标题 1.3→1.4、wiki 预览小徽标 0.72→0.78）；(c) blockquote 底色 bg→surface-2（浅色 #fafafa→#f3f4f6 微深，§3 规格）

### 空状态（验证项 7）

- [x] 板块页搜索无结果：EmptyState 插画+标题（含关键词）+描述 +「清除搜索」CTA，点击还原列表（实测 rows 0→1、input 清空）
- [△] NoteList「暂无词条」与 Tags「暂无标签」空态：现有数据四板块均非空、标签 10 个，无法自然触发；组件已接入（渲染逻辑与搜索空态同款），以代码走查+搜索空态实测作降级覆盖

### 移动端 375×812（验证项 8）

- [x] 首页深色：底部导航 5 图标+文字纵向堆叠、激活 accent、无横滚（`mobile-home-dark.png`）
- [x] 阅读页浅色：0.95rem 衬线折行正常、表格容器内滚、无横滚（`mobile-note-light.png`）
- [x] 设置页浅/深：分段控件不溢出、底部导航正常（`mobile-settings-dark.png`）

### IAB 稳定性

- [x] 本轮全程 rAF 正常（51 帧/300ms），未遇渲染管道停滞；仅 fullPage 截图出现 sticky 侧栏重复的拼接工件（截图工具行为，改用大视口单帧规避）

## 复检（第二轮，2026-08-31 提交后）

对已提交状态独立复验。**发现并修复 1 处，其余全部通过**：

- [x] **提交隔离**：`91fddfb`（feat，27 代码文件 + 592 woff2 + OFL + lockfile/gitignore）、`5cbcde6`（M1' 遗留补记，2 文件）、`87ab666`（M2' 文档 15 文件）；三提交 `notes/` 零卷入；`4cfda21..HEAD` 对 server/、markdown.ts、tts.ts、search.ts、backlinks.ts、theme.ts、index.html **零改动**；交接提示词两文件保持未跟踪。
- [x] **负向清单逐条**：组件内散写 hex/rgba 归零；`prefers-color-scheme` 仅 theme.ts matchMedia 字符串；媒体查询全部 `767px` 字面量；z-index 全部令牌；localStorage 全部 `en_tool:` 前缀；依赖增量仅 `cn-font-split@7.4.3`（devDep，lockfile 同步）。EditView:549 的 ui-monospace 散写栈为 v1 既有（M1' 复检确认无回归），非本轮引入，暂不并入 `--font-mono`（观察项）。
- [x] **构建复现**：HEAD 重新 `npm run build`，产物 hash（index-DFCE8irX.css / index-YLbPhzWz.js）与实施验证逐字节一致。
- [x] **fonts.css 对账**：592 条 @font-face（400:291 / 700:301）全部 `font-display:swap`、绝对路径 `/fonts/serif/...`、family 精确 `Noto Serif SC Web`、无相对路径残留；引用集与磁盘 woff2 逐文件一致（400/700 两档 comm 差集为空）。
- [x] **tokens.css 回归核对**：M1' 三件套（body 字体接线 / html 画布底 / 表单控件 inherit）完好；深色层 8 组标签变体齐全。
- [x] **浏览器独立实测**：浅色 12/12、深色 8/8（零横滚、零错误、data-theme/color-scheme 正确）；衬线边界（正文衬线 17px、标题 Inter、IPA Noto Sans）；标签 hover 叠加真实指针复测通过；preview 生产构建 16 片正常加载。
- [x] **发现并修复：字体产物遗留 `index.proto`**（cn-font-split 的 protobuf 内部元数据，400/700 目录各 1 个，非字体资产却随 feat 入库/部署）→ 已删除并泛化 build-fonts.mjs 清理逻辑（产物目录只保留 woff2），`8f3b9c2` 单独 fix 提交；woff2 集合未受影响。
- [x] **残留清理**：两源 localStorage 仅 `en_tool:theme`（已恢复 system）、无编辑草稿残留；notes/ 与工作区干净。
- [△] **复检方法论沉淀（非缺陷）**：`document.fonts.check(family, text)` 的样本文本必须取自**实际以衬线渲染的上下文**——同一字若只出现在行内代码/加粗等非衬线上下文，其衬线面不会被渲染触发，check 返回 false 属正常语义；用 `fonts.load()` 显式加载后 check 即 true，画布对比因 canvas 不触发字体加载会静默回退也不可作为证据。判定衬线渲染正确性的可靠依据是「渲染请求触发的 FontFace loaded 集合」+ 整页截图字形。

## 已知限制

1. **build:fonts 重跑等价而非逐字节一致**：并行 worker 打包顺序导致少数分片内容哈希重排（无选项可控）；提交态产物为权威版本，重跑会生成等价但文件名不同的分片。/fonts.css 与磁盘分片一一对应。
2. **分片命中数与单片体积部分超出任务预期**：任务预期「个位数命中、单片 10~50KB」；实测中文页首访命中 ~26 片（cn-font-split 按字频打包，71 个不同字符即触 26 桶），单片 9~48KB 达标，另每字重存在 1 个 ~240KB 拉丁/希腊/西里尔全局包（工具固定整包，Windows 上因本地 Cambria 承接拉丁而**实际不下载**）。首访传输 406~717KB/页，此后走 HTTP 缓存为 0。如需进一步压命中数可调大 chunkSize，但单片体积会同步增大，两者不可兼得。
3. **仓库体积 +28MB（分片产物）**：高于设计文档预估的 10~20MB（两档全字集即此量级）；源 OTF（23MB）不入库，重切需按脚本头注释重新获取。
4. **主 CSS 包含 592 条 @font-face 声明（387KB/gzip 110KB）**：随 fonts.css 走 main.ts 引入（任务指定），构建产物 CSS 体积显著增大；本地使用无感，弱网环境首载略慢。
5. **NoteList/Tags 空态未自然触发**（现数据非空），已按组件接入并以搜索空态实测作降级覆盖（验证矩阵 △ 项）。
6. **fullPage 截图对 sticky 侧栏有拼接重复工件**：交付整页截图改用「先量 scrollHeight 再放大视口单帧」的方式规避。
7. **M3'+ 范围未实现**（动效令牌引用/骨架屏/转场/stagger/Ctrl+K/TOC/上下篇/代码复制/回顶/编辑器增强/板块筛选）——`--duration-*`/`--ease-out` 仍只定义未引用，属计划内。

## 交付物清单

- 代码提交：`feat(ui): M2' 排版·图标·板块色`（代码 + 字体分片产物 + OFL 许可证，哈希见 §12 标注）
- 附带提交：M1' 独立审查会话遗留未提交的 `UI-M1实施记录.md`「审查」节与 `AGENTS.md` M1' 进度行（本会话开始前即存在于工作区，单独 `docs:` 提交以清历史）
- 本记录 + `UI优化设计方案.md` §12 标注 + AGENTS.md M2' 回写 + `UI-M2截图/`（12 张）：`docs:` 提交
- 截图：home-light / home-dark / note-light / note-dark / note-code-light / grammar-dark-full / tags-light / tags-dark / empty-state / mobile-home-dark / mobile-note-light / mobile-settings-dark

## 审查（第三轮，2026-08-31，独立审查会话）

对已提交状态（HEAD = 2abe757）独立复验，**结论：通过验收，零代码缺陷**。核实范围与结果：

- [x] **提交隔离与禁区**：`91fddfb`（621 文件 = 27 代码 + 592 woff2 + OFL + lockfile）无 server/、notes/ 卷入；`4cfda21..HEAD` 对 server/、markdown.ts、theme.ts、tts.ts、index.html 零改动；notes/ 无临时词条残留；组件散写色归零。
- [x] **代码核对**：tokens.css（`--font-serif` 照抄 §3 / `--text-body` / `--font-mono` / 标签 8 组浅深令牌 + hover overlay / 全局应用类 `.tag-pair-{0..7}`）、MarkdownViewer `.note-body`（衬线/17px/1.8/0.01em/autospace/orphans:2、code-pre 等宽、blockquote surface-2+1.6、链接 text-decoration 迁移）、Icon.vue（24 枚规范注册）、tagColor.ts djb2、§12 标注与 AGENTS 三条新铁律回写，逐项与设计文档一致。
- [x] **独立实测（browser-use）**：`npm run build` 通过且产物 hash 与记录一致；衬线边界临时词条全项通过（IPA 无衬线 / code-pre ui-monospace / blockquote #f3f4f6+accent 边条+27.2px 行高 / md 链接 underline+3px+1px / wiki dashed / h2 17.6px+字距 normal / strong 衬线继承）；深色下衬线笔画清晰（语法长文整页截图复核，粗体 700、斜体 Cambria）；首页板块 chip 浅色 soft 四色与深色 rgba 四色逐一精确命中 M1' 变体；侧栏 7 图标、移动底部 5 图标；标签 tag-pair-N 生效；空状态插画+清除搜索 CTA 点击还原列表（rows 0→7）；375×812 零横滚；dev 与 preview 双源字体按需加载均 24 片命中、preview 全绝对路径、`fonts.check` 经显式 load 后 true（与复检方法论沉淀一致）。
- [x] **残留清理**：审查会话临时词条（m2-review-check，文件系统建删）与两源 localStorage 均已清零，主题恢复 system。
- [备注] 审查中 blockquote border-left computed 读数 2.667px（CSS 源为 3px）属 IAB computed 残影（同 [[已知 IAB quirk]]），以 CSS 源 + 视觉截图为准；另审查会话遇 4173 端口孤儿进程（上轮审查残留 preview），精确单杀后重启，与实施无关。
