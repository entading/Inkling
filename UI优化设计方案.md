# UI 优化设计方案（v1.x · UI/UX 焕新）

> 状态：**已定稿（2026-08-31，待确认项已全部拍板，见 §14）** → 按里程碑分阶段实施
> 范围确认（2026-08-31）：A 视觉层全做（A1–A5）+ B 交互层全做（B1–B5）；C 进阶（图谱/PWA/学习辅助）本轮不做；允许引入 `@vueuse/core`，其余不加依赖。

## 0. 目标与原则

**目标**：在不推翻现有「纯手写 CSS + 设计令牌 + 无组件库」体系的前提下，把 Inkling 从"简洁"提升到"精致"——视觉档次、阅读体验、操作效率三条线。

**原则**：
1. **令牌优先**：一切新增颜色/动效/字号先落 `tokens.css`，组件内只引用变量；深浅双主题靠令牌覆盖实现，组件零改动。
2. **克制**：宁静蓝 `#3b82f6` 仍是唯一品牌主色；个性色只做小面积点缀；动效只做"快而轻"，不做大位移。
3. **无障碍不退步**：现有 focus-visible、键盘可达、ARIA 全部保留；新增动效必须响应 `prefers-reduced-motion`。
4. **既有约束不破**：PUT 全量源码语义、markdown-it inline rule 契约、z 令牌分级、`en_tool:` localStorage 前缀、媒体查询字面量断点等全部遵守（见 §6 对照表）。

## 1. 基础设施：令牌体系扩展（所有后续项的地基）

`tokens.css` 新增三组令牌，并做一次**硬编码色收敛**：

```css
:root {
  /* 语义色补充 */
  --color-surface-2: #f3f4f6;            /* 次级表面：hover 底、代码块底、骨架屏底 */
  --color-on-accent: #ffffff;            /* 强调色实底上的文字（收敛 8 处 color:#fff） */
  --focus-ring: 0 0 0 3px rgba(59, 130, 246, 0.16);  /* 收敛 4 处输入框焦点阴影 */
  --wiki-underline: rgba(59, 130, 246, 0.3);
  --wiki-underline-missing: rgba(59, 130, 246, 0.5);

  /* 动效 */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  /* 字号阶梯（收敛现有散写 rem 值） */
  --text-xs: 0.78rem;  --text-sm: 0.88rem;  --text-base: 0.95rem;
  --text-md: 1rem;     --text-lg: 1.1rem;
  --text-xl: 1.4rem;   --text-2xl: 1.7rem;

  /* 板块个性色（主色 + 柔和底） */
  --board-vocab: #3b82f6;    --board-vocab-soft: #eff6ff;
  --board-phrase: #0d9488;   --board-phrase-soft: #f0fdfa;
  --board-sentence: #d97706; --board-sentence-soft: #fffbeb;
  --board-grammar: #16a34a;  --board-grammar-soft: #f0fdf4;
}

[data-theme='dark'] { /* 全套覆盖，见 §2 */ }
```

**需收敛的硬编码清单**（已 grep 核实，全部要改成令牌引用）：

| 位置 | 现状 | 改为 |
|---|---|---|
| SearchPanel / Board / NewNote / EditView 输入框 focus | `box-shadow: 0 0 0 3px rgba(59,130,246,0.12)` | `var(--focus-ring)` |
| MarkdownViewer wiki 链接下划线 ×2 | `rgba(59,130,246,0.3)` / `0.5` | `var(--wiki-underline[-missing])` |
| Settings 卡片/二维码底 ×2 | `background: #fff` | `var(--color-surface)` |
| 各按钮/实底上的 `color: #fff` ×8 | 字面白 | `var(--color-on-accent)` |
| tokens.css 阴影 | `rgba(17,24,39,…)` 保留在令牌内（深色下整体替换为深色阴影） | 不动，dark 层覆盖 |

## 2. A1 深色主题

**架构**：`<html data-theme="light|dark">` + `:root` / `[data-theme='dark']` 两层令牌；`color-scheme` 同步切换（原生控件/滚动条跟随）。

**深色调色板（初版）**：

```css
[data-theme='dark'] {
  color-scheme: dark;
  --color-bg: #101418;            /* 页面底 */
  --color-surface: #171d24;       /* 卡片 */
  --color-surface-2: #1f2730;     /* hover/代码块/骨架 */
  --color-text: #e5e7eb;
  --color-text-secondary: #9ca3af;
  --color-accent: #60a5fa;        /* blue-400，深底下更亮 */
  --color-accent-soft: rgba(96, 165, 250, 0.14);
  --color-border: #2a323c;
  --color-danger: #f87171;
  --color-danger-soft: rgba(248, 113, 113, 0.12);
  --color-on-accent: #0b1220;     /* 亮蓝实底上用深字 */
  --focus-ring: 0 0 0 3px rgba(96, 165, 250, 0.22);
  /* 阴影在深色下弱化为更深色（主要靠表面亮度阶梯+边框分层） */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  /* 板块个性色同步换深底变体 */
}
```

**切换机制**：
- `web/src/lib/theme.ts`：模块级单例 composable（项目无 Pinia，不需要）。偏好值 `en_tool:theme` ∈ `'system' | 'light' | 'dark'`，默认 `'system'`。
- resolved = 偏好非 system 时取偏好，否则取 `matchMedia('(prefers-color-scheme: dark)')`；监听媒体变化实时跟随（仅 system 态）。
- **首帧防白闪（必须）**：`web/index.html` `<head>` 内联 3 行脚本，挂载前读 localStorage 设 `data-theme`。
- 设置页新增「外观」卡片：跟随系统 / 浅色 / 深色 三选项（分段控件样式）。
- 切换瞬间给 html 加临时 class 做全局 200ms color/background 过渡，完毕移除（避免常态 transition 拖慢一切）。
- 深色适配走查清单：代码块、blockquote、表格、hover 预览卡、选中朗读工具条、banner（danger-soft）、骨架屏、tag 色板（每色都要有 dark 变体）、板块色（dark 变体）。

**涉及文件**：tokens.css、theme.ts（新）、index.html、Settings.vue、全部视图/组件（仅令牌引用替换）。

## 3. A2 阅读排版升级

**P0 前置修复（2026-08-31 排查发现）：全局字体从未生效。** `tokens.css` 定义了 `--font-sans` 但全项目没有任何元素应用它（grep + git 历史 -S 确认历史上也从未接线），正文渲染完全取决于浏览器默认标准字体——实测 ZCode 内置浏览器（Chromium 146）body 计算字体为 Noto Sans SC、button 为 Arial（表单控件不走标准字体，同页字体不一致）；在出厂设置的 Chrome/Edge on Windows 上标准字体是 Times New Roman，英文正文会呈衬线、中文回退宋体。**修复：tokens.css 增加全局规则 `body { font-family: var(--font-sans); }`，随 M1' 一并落地。**

**字体规格（2026-08-31 已确认：B 全量思源宋体 + 屏显优化英文栈）**：

- **最终衬线栈**：`--font-serif: 'Charter', 'Bitstream Charter', 'Cambria', 'Constantia', Georgia, 'Noto Serif SC Web', 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', SimSun, serif`。拉丁部分按平台取屏显最优（mac=Charter、Win=Cambria），笔画结实、数字等高、深色表现稳；不用 Georgia 优先——其数字是内嵌 old-style figures（`lining-nums` 切不回），深色下细笔画也易发虚。
- **中文衬线 webfont（路线 B）**：Noto Serif SC（=思源宋体）用 `cn-font-split` 切 woff2 分片（unicode-range 按需加载），self-host 到 `web/public/fonts/`，`styles/fonts.css` 声明 `@font-face`（family 名 `Noto Serif SC Web`，`font-display: swap`）。**一次性执行、产物提交入库**（加 `npm run build:fonts` 脚本，常规构建不重跑）；本地 localhost 加载快，swap 闪替可忽略。仓库体积预计 +10~20MB（分片总量），单页实际只加载命中分片（每片 10~50KB）。
- **正文参数**：`--text-body: 1.0625rem`（17px；卡片内文本实测宽 624px，中文约 36 字/行、英文约 70-75 字符/行，均在舒适区，容器与卡片 padding 不动）、行高 1.8、段间距 0.9em、`letter-spacing: 0.01em`；标题沿用现有字距。
- **性格分层（有意决策）**：正文整体衬线（`.markdown-body` 含正文内 h2/h3）；UI 层（标题栏、meta、标签、列表、按钮）与 **IPA 音标**保持无衬线标注层——Charter/Cambria 对 IPA 附加字符（θ ð ʃ ŋ ˈ ˌ 等）覆盖不全，衬线化会退化成混搭。blockquote 加左侧 3px accent 边条 + surface-2 底，**行高收到 1.6**（英文例句不需要 1.8 的呼吸感）。
- **混排与断行**：`text-autospace: normal`（Chromium 140+ 渐进增强，自动补中西文间距，实测浏览器 146 已支持，旧浏览器一行忽略）；`text-wrap: pretty`（段落）/ `balance`（标题）；补 `orphans: 2; widows: 2`；正文 md 链接下划线加 `text-underline-offset: 3px` + `text-decoration-thickness: 1px`（衬线默认下划线会压到字形）。
- **深色专项**：深色下通读整篇语法长文检查衬线笔画是否发虚；发虚则仅在深色令牌层把 `--font-serif` 首选换成 Cambria，不动浅色。
- 字号阶梯令牌建立后，替换各组件散写的 rem 字面值（0.78/0.8/0.85/0.88/0.9/0.92/0.95/0.98/1.05/1.1/1.35/1.4/1.6/1.7rem 全部归入阶梯）；IPA 专用字体栈（`--font-ipa`）不动。

## 4. A3 图标与空状态

- **`components/Icon.vue`**：`name` + `size`（16/20）props；内联注册 path 数据，`stroke="currentColor" stroke-width="1.8" fill="none"`（与现有喇叭/放大镜同风格）。不引图标库。
- 图标清单（~20）：home、book（词汇）、link（短语）、align-left（长难句）、graduation-cap（语法）、tag、settings、plus、search、pencil、trash、more、x、chevron-up/down/left/right、arrow-up、copy、check、sun、moon、monitor、list。
- 应用点：侧栏导航项（激活态图标 accent 色）、移动端底部导航、Home 板块卡图标（板块色 chip）、命令面板动作项、空状态、回顶/复制按钮。
- **`components/EmptyState.vue`**：内联 SVG 简笔插画（摊开的书 + 散点，accent-soft 单色系）+ 标题 + 描述 + 可选 CTA（如"新建词条"）。替换 NoteList"暂无词条"、板块搜索无结果、Tags 空态。

## 5. A5 板块个性色与标签配色

- 板块色仅用于：Home 板块卡（图标 chip 底 + 计数文字色）。**侧栏导航、全局按钮、链接仍统一宁静蓝**。
- TagBadge 升级：8 色柔和对（blue/teal/amber/green/violet/rose/cyan/orange 的 soft 底 + strong 字），按 `hash(tag) % 8` 定色，`:style` 注入 `--tag-c/--tag-bg`；hover 统一加深。每个色带 dark 变体（直接用 rgba 底 + 亮字，天然适配）。

## 6. A4 微动效系统

- 全局 `@media (prefers-reduced-motion: reduce)`：关闭入场动画/stagger/骨架 shimmer/页面转场（transition 保留瞬时值）。
- **骨架屏**：`components/Skeleton.vue`（shimmer）；三处替换"加载中…"——NoteList 骨架（6 行）、NoteView 骨架（标题+三段）、Home 骨架（搜索框+卡片格）。
- **页面转场**：`<RouterView v-slot>` + `<Transition name="page" mode="out-in">`（fade + 4px 上移，各 160ms，key=route.path）。 reduced-motion 下直切。
- **列表 stagger**：列表项入场 opacity+translateY(6px)，每项 delay 递增 24ms，**cap 前 12 项**（防长列表尾等）；仅首次挂载，不做滚动触发。
- 按钮按压 `scale(0.98)`、卡片 hover 沿用现有微抬升，时长统一换动效令牌。
- View Transitions 共享元素（列表行→词条标题飞跃）列为**可选增强**，M3 不做，后续有余力再加。

## 7. B1 Ctrl+K 命令面板

- `components/CommandPalette.vue`：Teleport body，`z-float` 层；遮罩点击/Esc 关闭；顶部输入框 + 分组扁平列表。
- 触发：全局 `Ctrl/Cmd+K`（useEventListener / 手写 keydown）；桌面侧栏品牌下加「搜索 ⌘K」入口（移动端不加入口，仍用首页大搜索）。
- 数据：`getSearchIndex()`（复用缓存）+ 面板内部自建扁平 Fuse（title/ipa/tags/slug，threshold 调宽 0.35）；debounce 120ms。
- 空 query 默认视图：导航动作组（新建词条 / 四板块 / 标签 / 设置 / 切换深浅色）+ 最近更新 5 条（`api.recent`）。
- 键盘：↑↓ 循环、Enter 执行、Esc 关闭；动作项带图标与类型徽标。
- 主题切换动作直接调 theme.ts，设置页与面板共用。

## 8. B2 阅读页增强

- **TOC**：MarkdownViewer 渲染后扫描 `.markdown-body h2/h3`，注入唯一化 id（DOM 后处理，**不动 markdown.ts 渲染契约**），emit 目录数据；NoteView 在 ≥1280px 视口显示右侧 sticky 目录（scrollspy 高亮，IntersectionObserver）；窄屏隐藏。
- **阅读进度条**：顶部 fixed 2px accent 条（`z-rail` 层），仅阅读页挂载。
- **上下篇**：加载词条时并行拉 `api.notes(board)`，按板块页同款排序规则定位当前项，页脚渲染「← 上篇 | 下篇 →」。
- **键盘**（仅阅读页，输入焦点时忽略）：`E` → 编辑、`Esc` → 返回板块、`J/K` → 下/上篇。
- **代码块复制**：渲染后为每个 `pre` 注入右上角复制按钮（navigator.clipboard，成功变 ✓ 1.5s）。

## 9. B3 编辑器增强（不碰全量源码语义）

- `Ctrl/Cmd+S`：走既有保存路径（dirty 才发请求，成功/失败状态复用现有 saveState）。
- `Tab`：textarea 内插入两空格（多行选区暂不做块缩进，保持简单）。
- 工具条（编辑区上方，图标按钮）：加粗/斜体/行内代码/`[[wiki]]`/引用/H2 —— 用 `document.execCommand('insertText')` 插入以**保留撤销栈**（各主流浏览器仍支持），失败降级 `setRangeText`。
- `[[` 补全：检测光标前未闭合 `[[`，浮层列候选（跨板块，slug/title 过滤），选中插入 `slug]]`（非 vocab 目标自动带 `board/` 前缀）。
- 预览同步滚动：编辑比例 → 预览比例单向映射。

## 10. B4 板块页筛选 + B5 移动端

- **标签 chips**：板块页搜索框下聚合当前板块 tags，点击多选（OR 语义），与搜索框 AND 组合；筛选状态进 URL query（`?tags=a,b`），与现有 `q/fulltext` 模式一致。
- **排序切换**：默认排序=现状规则（vocab 字母序、其余 updated 倒序）；可切「字母序 / 最近更新」。
- **密度**：紧凑/舒适切换（行 padding），`en_tool:density` 记忆。
- **移动端**：底部导航加图标（文字保留）；右下角浮动「＋」FAB（accent 圆钮，新建词条，`z-nav` 层）；滚动 >600px 出现回顶按钮（桌面移动都有）。**右滑返回明确不做**（与滚动手势冲突，收益低）。

## 11. 依赖变更

| 包 | 用途 | 备注 |
|---|---|---|
| `@vueuse/core`（dependencies） | useLocalStorage（主题/密度）、useMediaQuery（系统深色/宽屏 TOC）、useEventListener（快捷键/滚动） | 无样式纯工具、tree-shakable |
| `cn-font-split`（devDependencies，仅 M2' 用一次） | 思源宋体 woff2 分片切分 | 产物提交入库，常规构建不依赖；运行时零新增依赖 |

明确不加：动效库（CSS 够用）、图标库（手写 SVG）、highlight.js、组件库、Tailwind。

## 12. 里程碑划分（沿用 v1 惯例：每里程碑独立会话 + 真实验证 + 报告落根目录）

| 里程碑 | 内容 | 验收要点 |
|---|---|---|
| **M1' 令牌收敛与深色主题** ✅ 已完成（2026-08-31，代码 `efccdeb`，记录 `UI-M1实施记录.md`） | §1 令牌扩展+硬编码收敛、§2 全部 | 浅/深双主题全页面走查（含移动端）；系统偏好跟随；刷新无白闪；`npm run build` 过 |
| **M2' 排版·图标·个性色** ✅ 已完成（2026-08-31，代码 `91fddfb`，记录 `UI-M2实施记录.md`） | §3、§4、§5 | 图标全站替换无缺失；tag/板块色深浅两态可读性；衬线正文浅/深双主题通读检查笔画（清晰不发虚，未触发深色换栈）；字体分片按需加载验证（preview 实测：首访命中 26 片、单片 9~48KB、无全量下载；重跑分片哈希非逐字节一致，见记录偏离 #4） |
| **M3' 微动效** ✅ 已完成（2026-09-01，代码 `36da2da`，记录 `UI-M3实施记录.md`） | §6 | 骨架屏三处（Board 6 行/NoteView 标题+IPA+三段/Home 卡格+列表，shimmer 双主题令牌化）；转场/stagger 顺滑（out-in 160ms fade+4px、stagger 前无重播/新导航重播断言通过）；reduced-motion 下全静态（全部动画规则+keyframes 位于 no-preference 块内，CSSOM 零违规，dev/preview 双源核对）；按压反馈 10 组 `:active` 全部守卫内；另见记录「IAB 遮挡节流」环境发现与验证降级口径 |
| **M4' 命令面板与阅读增强** ✅ 已完成（2026-09-01，代码 `b476fa2`、复检修复 `67fa364`，记录 `UI-M4实施记录.md`） | §7、§8 | Ctrl+K 全键盘可用（合成事件 + 真实滚轮双路验证；↑↓ 循环/Enter 跳转/Esc 优先级/主题动作复用 theme.ts/无障碍属性与焦点管理全过）；TOC（id 注入/点击跳转/scrollspy/零位移零横滚/无标题隐藏/编辑页不显示）、进度条 0/50/100 三点、上下篇与服务端排序一致（首尾边界）、E/Esc/J/K 快捷键与删除确认优先级、代码复制（载荷逐字节一致）全通过；移动端 375×812 TOC 隐藏/进度条/上下篇达标；12 页 × 浅深走查零回归；dev/preview 双源复核；**已通过复检（面板索引时效 2 缺陷修复 `67fa364`，确定性场景实测 + 回归电池全过）**；另见记录「IAB 环境发现」（程序化滚动零 scroll 事件等新 quirk 与验证降级口径） |
| **M5' 编辑器·列表·移动端** | §9、§10 | 编辑器增强不破坏撤销与全量源码语义；筛选/排序/密度/URL 同步；FAB 与回顶 |

每里程碑通用验收：`npm run build`（tsc + vue-tsc + vite）通过；Playwright 实测记录；报告落根目录；遵守 AGENTS.md 全部约束。

## 13. 既有约束对照（AGENTS.md §关键实现约束）

1. 日期双轨：本设计不触碰日期逻辑。
2. markdown-it inline rule 契约：TOC 走 DOM 后处理，**不新增/修改任何 inline rule**。
3. wiki 解析唯一来源：B3 补全只做候选列表，不新增第二套解析正则。
4. Fastify 局域网切换：不涉及服务端改动（零服务端变更）。
5. PUT 全量源码：编辑器增强全部只是"往 textarea 插入文本"，保存路径不变。
6. 删除 git 自动提交：不涉及。
7. box-sizing 前提：新增组件继续依赖全局 reset。
8. TTS：朗读工具条不动；新增浮层（命令面板/补全）z-index 归入现有令牌层级（`--z-float`）。

## 14. 决策记录（2026-08-31 已全部确认）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 板块个性色 | **四板块配色**（词汇蓝 / 短语青绿 / 长难句琥珀 / 语法绿），全局主色仍宁静蓝 |
| 2 | 衬线字体范围 | **全正文衬线**（阅读页词条正文整体衬线，UI 层无衬线；Windows 宋体观感风险见 §3） |
| 3 | 页面转场幅度 | **入场 fade**（Vue Transition out-in 模式，160ms；View Transitions 共享元素列为可选增强） |
| 4 | 里程碑顺序 | **视觉先行**：M1' 深色主题 → M2' 排版图标 → M3' 动效 → M4' 命令面板与阅读 → M5' 编辑器列表移动端 |
