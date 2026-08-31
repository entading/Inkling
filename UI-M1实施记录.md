# UI-M1' 实施记录（令牌收敛与深色主题）

> 状态：实施中（边做边记）
> 设计权威：`UI优化设计方案.md` §1 / §2 / §3-P0 / §12；本记录只做 M1' 范围。

## 执行计划（文件 × 改动点）

1. **`web/package.json`**：安装 `@vueuse/core`（dependencies，本轮唯一允许的新依赖）。
2. **`web/src/styles/tokens.css`**
   - P0 全局字体接线：`body { font-family: var(--font-sans); }`；**配套** `button/input/select/textarea { font-family: inherit }`（表单控件不走标准字体继承，不加这行 button 仍是 Arial，验证项 6 要求 button/input 与正文一致，故必须加）。
   - `:root` 新增令牌（浅色值照抄 §1）：语义色 5 枚（`--color-surface-2` / `--color-on-accent` / `--focus-ring` / `--wiki-underline` / `--wiki-underline-missing`）、动效 4 枚（`--duration-fast/base/slow`、`--ease-out`）、字号 7 枚（`--text-xs`~`--text-2xl`）、板块色 8 枚（`--board-vocab/phrase/sentence/grammar` + 各 `-soft`）；补 `color-scheme: light`。
   - `[data-theme='dark']` 全套覆盖（§2 调色板为基础）：bg / surface / surface-2 / text / text-secondary / accent / accent-soft / border / danger / danger-soft / on-accent / shadow×2 / focus-ring / wiki-underline×2 / color-scheme: dark；板块色深色变体自行设计（主色提亮一档取 Tailwind 400 档、soft 改低透明度 rgba）。
   - 主题切换过渡：`html.theme-transitioning` 期间对 background-color/color/border-color 加 200ms 全局 transition，`@media (prefers-reduced-motion: no-preference)` 守卫；类随切换加、~240ms 后移除，无常态 transition。
3. **`web/src/lib/theme.ts`（新建）**：模块级单例 composable；`en_tool:theme` ∈ `system|light|dark` 默认 `system`（useLocalStorage，含非法值容错回退 system）；`useMediaQuery('(prefers-color-scheme: dark)')`；`resolved = computed`（非 system 取偏好，否则取系统）；`watch(resolved, immediate)` 写 `document.documentElement.dataset.theme`，system 态随媒体变化实时跟随；`setPreference()` 切换前挂 `theme-transitioning` 类、240ms 后移除。
4. **`web/src/main.ts`**：`import { useTheme } from './lib/theme'` 并初始化一次——保证模块单例尽早建立、system 态监听尽早生效（不依赖用户是否打开过设置页）。
5. **`web/index.html`**：`<head>` 顶部内联防闪脚本：同步读 `en_tool:theme`（合法值 `light`/`dark` 直接用，否则按 `matchMedia`），写 `data-theme`；localStorage 不可用 try/catch 静默回退。
6. **`web/src/views/Settings.vue`**：新增「外观」卡片（置于页面第一张卡，**独立于** `v-else-if="info"` 条件块之外渲染——主题为纯前端能力，服务端 error/加载中时仍可用）；分段控件三选项（跟随系统/浅色/深色），`role="radiogroup"` + `role="radio"` + `aria-checked` + roving tabindex，←/→/↑/↓ 循环切换；样式只用既有语义令牌。
7. **硬编码收敛（同值替换，浅色观感不变）**
   - focus ring ×4：`SearchPanel.vue:267`、`Board.vue:208`、`NewNote.vue:233`、`EditView.vue:563` → `var(--focus-ring)`（注：硬编码为 0.12 透明度，§1 令牌定为 0.16，照抄文档，微差见「偏离」#2）
   - wiki 下划线 ×2：`MarkdownViewer.vue:345/355` → `var(--wiki-underline)` / `var(--wiki-underline-missing)`
   - `background: #fff` ×2：`Settings.vue:280`（开关 thumb）、`:327`（二维码容器）→ `var(--color-surface)`
   - `color: #fff` → `var(--color-on-accent)`，实际 10 处（文档写 8，grep 实测 10）：`App.vue:87`、`TagBadge.vue:29`、`Tags.vue:106`、`Home.vue:120`、`NewNote.vue:277`、`NoteView.vue:571/577`、`NotFound.vue:47`、`EditView.vue:411`、`Settings.vue:427`
   - 收敛总计 **19 处**：4 focus + 2 wiki + 1 url-link（清单外）+ 2 `background:#fff` + 10 `color:#fff`；其中 18 处数值完全相同，仅 focus ring 为 0.12→0.16 有意微差（见偏离 #2）
8. **`UI优化设计方案.md`**：§12 表 M1' 行追加完成标注与提交哈希。
9. **`AGENTS.md`**：「UI 焕新阶段补充约定」回写 M1' 沉淀的新约束（防闪脚本与 theme.ts 双点同步、表单控件 inherit、清单外收敛项等）。
10. **验证**：`npm run build` → browser-use 全页面走查矩阵（12 页面 × 深浅两主题）→ 375px 移动端抽查 → 主题三态/刷新记忆/防闪（preview 生产构建）→ computed 字体验证 → 截图 ≥6 张落 `UI-M1截图/`。
11. **提交**：代码一个 `feat(ui):` 提交；实施记录 + 截图 + §12 标注 + AGENTS 回写一个 `docs:` 提交（只 add 明确涉及文件）。

## 偏离与理由（边做边记）

1. **P0 配套改动：表单控件 `font-family: inherit`**。设计文档 §3-P0 只写了 `body` 一行，但验证要求 button/input 与正文一致（Chromium 表单控件不走标准字体，仅 body 一行修不掉 button=Arial 分叉），故在 tokens.css 补一条表单控件继承规则。属达成验证项 6 的必要配套。
2. **focus ring 浅色值 0.12 → 0.16**。§1 令牌定义 0.16 与现存硬编码 0.12 不一致；按任务「浅色值照抄文档 §1」取 0.16，四处替换后浅色下 focus 态光圈略强于原状（仅 focus 可见态，非静态观感）。非静默改动，特此记录。
3. **`color: #fff` 实际 10 处而非文档的 8 处**。全部位于 accent/danger 实底之上，语义一致，照单全改。
4. **清单外 1 处同值收敛：`Settings.vue:315`** `.url-link` 的 `border-bottom: 1px solid rgba(59,130,246,0.3)`。不在 §1 表格内，但与 `--wiki-underline` 浅色值完全相同，不收敛会在深色下漏成亮蓝细线；改为令牌引用，浅色零观感变化。
5. **外观卡渲染位置**：置于条件块（`v-if="error"` 之前），服务端不可达时仍可切主题。
6. **板块深色变体（自行设计，非文档给定值）**：主色取 Tailwind 400 档（vocab `#60a5fa` / phrase `#2dd4bf` / sentence `#fbbf24` / grammar `#4ade80`），soft 改低透明度 rgba（0.12~0.14，与 §2 accent-soft/danger-soft 的透明度策略一致）。
7. **wiki 下划线深色值（自行设计）**：`rgba(96,165,250,0.42)` / `rgba(96,165,250,0.62)`——深底下除随 accent 提亮外再抬一档透明度，保证实/虚下划线在 #101418 上可辨（浅色 0.3/0.5 直移深色会偏弱）。
8. **设置页分段控件 track 使用 `var(--color-surface-2)`**：新 UI 需要次级表面底色，surface-2 本里程碑已定义；「令牌只定义不应用」约束针对的是既有组件的 M2' 替换（字号阶梯/板块色），不禁止新 UI 引用语义令牌。
9. **补充 `html { background: var(--color-bg) }`（防白闪补全）**：验证中发现页面背景涂在 Vue 渲染的 `.app` 上（App.vue），`html/body` 画布透明——深色下 Vue 挂载前会先闪一帧浏览器默认白。tokens.css 给 html 涂 `--color-bg` 后：深色画布挂载前即 #101418（preview 实测 `htmlBg=rgb(16,20,24)`）；浅色 #fafafa 与 `.app` 同值零观感变化。
10. **测试辅助词条**：走查需含代码块+表格的真实笔记而现有笔记均无代码块，按操作红线以**文件系统**创建 `notes/vocab/m1-dark-check.md`（含代码块/表格/引用/wiki 链接/缺失链接），全部验证完成后已用文件系统删除（未走 DELETE API，未进任何 git 提交）；删除两态确认仅在挂起态验证、未点确认。

## 验证结果矩阵

**dev 模式（localhost:5173），Chromium 内置浏览器，视口 1280×720**

### 首帧与字体（验证项 1/6）

- [x] `npm run build` 通过（server tsc + web vue-tsc -b + vite build，157 modules，无告警）
- [x] body 计算字体 = `var(--font-sans)` 栈（Inter, -apple-system, …, Microsoft YaHei, system-ui, sans-serif）
- [x] button 计算字体与 body 一致（P0 分叉已消除，实测同一栈）
- [x] 首帧：`data-theme="light"`、localStorage `en_tool:theme="system"`（useLocalStorage 正常写入）

### 深色主题走查（验证项 2）

- [x] 首页：bg/surface/文字/accent-400 链接、tag 深色 chip 正常
- [x] 板块页 ×4（词汇/短语/长难句/语法）：列表行、搜索框、标签、计数正常
- [x] 阅读页（临时词条 m1-dark-check）：**代码块**（surface-2 底）、**表格**、**blockquote**（surface-2 底 + accent 边条）、行内代码、外部链接正常
- [x] **失效链接 banner**：danger-soft rgba 底 + danger-400 文字清晰
- [x] **wiki 悬停预览卡**：深色 surface + 边框，标题/音标/tag 可读
- [x] **选中朗读工具条**：选中高亮 + 工具条深色实底，文字可读
- [x] **删除两态确认按钮**：默认幽灵态 → 挂起确认态（danger-400 实底 + `--color-on-accent` 深字）均正常（仅挂起未确认，测试词条仍存活）
- [x] 编辑页：textarea / 预览栏 / 保存按钮正常
- [x] 新建页：表单、原生 select（color-scheme: dark 生效）正常
- [x] 标签页 / 标签详情：云标签、列表正常
- [x] 404：文字与按钮正常
- [x] **搜索下拉**：深色面板、悬停行、focus 光圈正常
- [x] 错误/提示文本：设置页 error 样式走查（danger-400）正常

### 主题机制（验证项 3/4）

- [x] 设置页分段控件三选项，`role=radiogroup`/`radio` + `aria-checked` 正确高亮
- [x] 键盘可达：聚焦选中项按 ← 循环切到上一选项，选中态与焦点同步移动（roving tabindex），主题即时切换
- [x] 点击「深色」→ `data-theme=dark` + localStorage `dark` + `color-scheme: dark` + 令牌切深（bg #101418 / accent #60a5fa / on-accent #0b1220）
- [x] 手动 浅⇄深 即时切换；刷新后记忆保持（dev 与 preview 双源均验）
- [x] system 态：偏好回 `system` 后 resolved 与 `matchMedia('(prefers-color-scheme: dark)').matches=false` 一致（data-theme=light）
- [△] **system 态实时联动为降级验证**：browser-use 无法人为翻转操作系统 `prefers-color-scheme`；已验证 (a) resolved 与 matchMedia 当前值一致、(b) 联动链路代码走查——`useMediaQuery` 返回响应式 ref → `resolved` computed → `watch(resolved)` 写 `data-theme`，媒体变化会经同一响应链生效（@vueuse useMediaQuery 内部监听 change 事件）。三选项高亮在三种偏好下均实测正确。

### 防白闪（验证项 5，preview 生产构建）

- [x] `dist/index.html` 含内联防闪脚本（grep + 页面 `document.scripts` 双确认）
- [x] preview（localhost:4173）设深色 → 刷新：domcontentloaded 时 `data-theme=dark`、localStorage `dark`，页面即深色无白闪
- [x] 补 `html { background: var(--color-bg) }` 后，深色画布挂载前即 `rgb(16,20,24)`（见偏离 #9）

### 浅色同值替换纪律（验证项 2 浅半）

- [x] 首页/阅读/设置/新建/词汇/短语/404 浅色走查：与 v1 观感一致（颜色、布局、间距无变化）
- [x] focus 光圈浅色 0.16 实测观感自然（唯一数值微差，见偏离 #2，仅 focus 可见态）
- [x] 开关 thumb、二维码容器 `var(--color-surface)` 浅色同值（#ffffff）

### 移动端 375×812（验证项 3）

- [x] 首页：底部导航、safe-area、板块卡单列折行正常（浅色=跟随系统时的正确解析结果）
- [x] 阅读页：横滚代码块、缺失链接 banner、标签折行正常
- [x] 设置页：外观分段控件不溢出，深浅两主题各验一轮

## 复检（第二轮，2026-08-31 提交后）

对已提交状态（HEAD = 55d929e）独立复验，全部通过、零缺陷：

- [x] **提交隔离**：`efccdeb` 18 文件（仅 web/ 与 lockfile）、`55d929e` 15 文件（AGENTS/设计方案/实施记录/12 截图）；两提交均未触碰 `notes/`；`UI-M1交接提示词.md` 保持未跟踪未提交。
- [x] **负向清单逐条**：组件内硬编码色 grep 归零（rgba(59/96/…)、#fff、6 位 hex 全无）；`prefers-color-scheme` 仅存在于 theme.ts 的 matchMedia 字符串与 tokens.css 守卫；server/、markdown.ts、tts.ts、search.ts、backlinks.ts 零改动；依赖增量仅 `@vueuse/core ^14.4.0`；theme.ts 无任何 api./fetch 调用（纯前端）；未新增媒体查询断点与 z-index。
- [x] **构建可复现**：HEAD 重新 `npm run build`，产物 hash（index-CVNL-oA4.css / index-D9oFnQrr.js）与验证时逐字节一致——提交态即验证态。
- [x] **字体链路三件套**：body=Inter 栈、button=Inter 栈（分叉消除）、编辑区 `.source-input` 仍为 ui-monospace 栈——tokens.css 元素级 `textarea { font-family: inherit }` 的特异性低于组件类选择器，v1 既有等宽编辑字体**无回归**（此前未显式验证过此项，复检补上）。
- [x] **过渡类生命周期**：点击切换瞬间 `html.theme-transitioning` 存在，约 450ms 后已移除，常态无残留类。
- [x] **深色交互态补充**：TagBadge hover 实测 `background: rgb(96,165,250)`（accent-400）+ `color: rgb(11,18,32)`（--color-on-accent 深字），令牌收敛在 hover 交互下同样正确。
- [x] **测试残留清理**：临时词条的 localStorage 编辑草稿（`en_tool:draft:vocab:m1-dark-check`，M4 草稿功能所存，实施时未察觉）已在复检中清除；IAB 内 5173/4173 两源的主题偏好已恢复 system/清空，localStorage 零测试残留。

## 审查（第三轮，2026-08-31，独立审查会话）

对已提交状态独立复验，**结论：通过验收**。核实范围与结果：

- [x] **代码核对**：tokens.css（P0 字体接线 + html 画布底 + 表单控件 inherit + 全部令牌与深色覆盖 + reduced-motion 守卫）、theme.ts（key/取值/非法值容错/单例/过渡类生命周期）、index.html 内联防闪脚本（位置与容错）、Settings 外观卡（radiogroup/roving tabindex/独立于服务端状态渲染）逐文件核对，与设计文档 §1 §2 及负向清单一致。
- [x] **提交与文档**：`efccdeb` 18 文件全在 web/ 与 lockfile、`55d929e` 未触碰 notes/；§12 已标注；AGENTS「主题实现铁律」回写到位。
- [x] **独立实测（browser-use）**：`npm run build` 通过且产物 hash 与复检一致（index-CVNL-oA4.css / index-D9oFnQrr.js）；12 页面深色走查全绿（bg=#101418、零横滚、零加载错误）；body/button/input 计算字体同栈（Arial 分叉消除）；主题三态与刷新持久化；键盘 ← 切换 dark→light 且 aria 同步；搜索下拉深色命中 surface/border/accent-soft 令牌；375×812 移动端三项抽查全过；preview 生产构建设深色刷新，domcontentloaded 最早可观测帧即 dark（无白闪）。
- [x] **发现并纠正 1 处记录偏差**：复检「localStorage 零测试残留」不准确——5173 源存有 `en_tool:draft:vocab:abandon`（abandon 编辑页走查所写），内容与磁盘逐字节一致、无数据风险；审查会话已清除并复验归零。
- [△] **审查环境插曲（非应用缺陷）**：审查会话中 IAB 渲染管道一度停滞（rAF 600ms 不跳帧），定位点击超时与个别 computed 读数陈旧均由此产生；reload 后一切一致。切换逻辑本身经页面内事件触发 + 刷新双路径验证无误。

## 已知限制

1. **dev 模式样式注入闪烁属正常**：Vite dev 下样式经 JS 注入，首帧可能有短暂样式跳动；防白闪结论以 preview 生产构建为准（已验）。
2. **system 态实时联动未做人为翻转实测**：browser-use 无法改变操作系统 `prefers-color-scheme`，采用「resolved 与 matchMedia 一致 + 响应链代码走查」降级验证（见验证矩阵标注 △）；下一里程碑如需可让用户手动切系统主题复验。
3. **深色下长文衬线笔画专项检查属 M2'**：本里程碑正文仍是无衬线（衬线字体 M2' 才引入），深色衬线发虚检查随 M2' 排版落地后进行。
4. **二维码容器底色随令牌**：`background: #fff → var(--color-surface)` 按文档执行；二维码图片本体由服务端 data URL 生成（白底），扫码可用性不受容器底色影响（本次未开启局域网实测扫码，仅样式验证）。
5. **`--duration-*`/`--ease-out`/`--text-*`/`--board-*` 令牌已定义未应用**：按任务范围（M3'/M2' 才使用），仅 Settings 新 UI 引用了 `--color-surface-2`。
6. **浅色 focus 光圈 0.12→0.16 的微差**：唯一一处浅色非同值替换（照抄 §1 定义），仅 focus 可见态可见。

## 交付物清单

- 代码提交：`feat(ui): M1' 令牌收敛与深色主题`（哈希见 §12 标注）
- 本记录 + `UI优化设计方案.md` §12 标注 + AGENTS.md 回写：`docs:` 提交
- `UI-M1截图/`：home-light.png / home-dark.png / note-light.png / note-dark.png / settings-light.png / settings-dark.png（6 张交付）+ evidence-*（wiki 悬停卡、朗读工具条、删除确认态、移动端 ×3 共 6 张佐证）
