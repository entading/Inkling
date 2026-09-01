# UI-M4' 实施记录（Ctrl+K 命令面板与阅读页增强）

> 状态：**已完成（2026-09-01）**
> 设计权威：`UI优化设计方案.md` §7 / §8 / §12；本记录只做 M4' 范围。边做边记，非事后补写。
> 截图（`UI-M4截图/` 9 张）：palette-empty-light / palette-search-light / palette-empty-dark / palette-search-dark / toc-light / toc-dark / note-overall-light / note-overall-dark / mobile-note-light

## 执行计划（文件 × 改动点）

### 0. 令牌补充

1. **`web/src/styles/tokens.css`**：新增 `--overlay-bg`（命令面板遮罩，浅色 `rgba(15,23,42,0.4)` / 深色加深变体），唯一新增颜色令牌；深浅两态均落此文件，组件内零散写色。

### A. Ctrl+K 命令面板（§7）

2. **`web/src/components/CommandPalette.vue`（新建）**：
   - Teleport body；结构 = 遮罩（点击关闭）+ 居中面板（`z-index: var(--z-float)`、`role="dialog"` + `aria-modal` + aria-label）；打开时 body 加 `overflow: hidden` 防背后滚动，关闭还原。
   - 顶部输入框（`role="combobox"` + `aria-expanded` + `aria-controls` + `aria-activedescendant`）+ 分组扁平列表（单一 `role="listbox"`，组头 `role="presentation"`，选项 `role="option"`）。
   - 数据：`getSearchIndex()` 复用缓存；面板内**自建扁平 Fuse**（keys `title/ipa/tags/slug`、`threshold 0.35`、`ignoreLocation: true`），索引数组引用变化才重建；输入 debounce 120ms。不改 `lib/search.ts`。
   - 空 query：动作组（新建词条 / 四板块 / 标签 / 设置 / 切换深浅色）+ 最近更新 5 条（`api.recent(5)`）；有 query：词条命中（cap 8）在前、动作子串过滤（label includes）在后，组头「词条 / 动作」。
   - 动作图标复用 Icon.vue 预注册（plus/book/link/align-left/graduation-cap/tag/settings/sun/moon/search）；词条项带板块徽标 + 日期；主题切换动作直接调 `useTheme().setPreference`（resolved==='dark' → 'light' 反之），执行后关面板。
   - 键盘全部走 **document capture 段监听**（面板打开时对每个 keydown `stopPropagation()`——阅读页 E/J/K/Esc 与编辑页 Ctrl+S 在面板打开时全部静默；特殊键 `preventDefault`）：↑↓ 循环、Enter 执行、Esc 关闭、Tab 阻断（焦点困在面板）、Ctrl/Cmd+K 再按关闭（toggle）；IME 组合中（`isComposing`）不拦截 Enter。
   - 焦点管理：打开前存 `document.activeElement`，打开自动聚焦输入框并选中已有文本；关闭还原触发前焦点；选项元素不可 Tab 聚焦（鼠标 mousemove 设 active、click 执行），active 项 `scrollIntoView nearest`。
   - 开关过渡 fade+scale（120ms，`--duration-fast`）连同 @keyframes/transition 写进 `no-preference` 块。
   - props `{ open }` + emit `close`；无 localStorage。
3. **`web/src/App.vue`**：
   - 挂载 `<CommandPalette>`；`window` keydown 监听全局 Ctrl/Cmd+K（无 Alt/Shift 修饰），`preventDefault()` 后 toggle（面板打开时 capture 段已拦截关闭，window 层不会双重触发）。
   - 侧栏品牌下加「搜索 + kbd」入口按钮（nav-item 同款视觉）；kbd 文案**按平台**：UA 检测 Apple 系显示 `⌘K`，其余 `Ctrl K`（记录于偏离表）；侧栏移动端本就 display:none，天然不加入口。

### B. 阅读页增强（§8，仅 NoteView/MarkdownViewer）

4. **`web/src/components/MarkdownViewer.vue`**：
   - 渲染后 DOM 后处理（`onMounted` + `watch(html, { flush: 'post' })`，重渲染自动重跑）：扫描 `.note-body h2/h3` 注入唯一 id（`toc-sec-N`，渲染确定性生成）、按文档序 emit `toc`（`{ id, level, text: textContent }`）——不改 markdown.ts、不加 inline rule；无 h2/h3 emit 空数组。
   - 为每个 `pre` 注入右上角复制按钮（内联 SVG 字符串 copy/check，与 Icon.vue 同 path 数据；**事件走容器级 click 委托**，重渲染按钮随 DOM 重建不丢）；`navigator.clipboard.writeText`（代码文本取 `pre` 内 textContent 去尾换行），成功切 ✓ 1.5s，失败 1.5s 危险色提示；编辑页预览（interactive=false）**同样带复制按钮**（复制是无副作用的阅读动作，见偏离表）。
   - 样式：`pre` 加 `position: relative`，按钮常显（低透明度，hover/focus 提到 1——不选 hover 才出现，保证触屏可用）；h2/h3 加 `scroll-margin-top` 供锚点跳转留白。
5. **`web/src/views/NoteView.vue`**：
   - **布局改造（TOC 不占文档流）**：`.note-page` 在 `≥1280px`（媒体查询字面量 `min-width: 1280px`）切换为三列 grid `1fr / minmax(0, 720px) / 1fr` 并以对称负 margin 伸入 `.content` 左右 padding——正文列恒 720px 居中，TOC 落第 3 列 `position: sticky`，出现/消失零正文位移、零横向滚动（列宽即边距宽，物理上不可能溢出）；<1280px 保持现布局，`.toc` display:none。模板加 `.note-main` 包裹层。
   - **TOC 面板**：消费 MarkdownViewer 的 `toc` emit（空数组整块隐藏）；标题「目录」+ h2/h3 两级列表（h3 缩进、超长省略号）；scrollspy 用 **rAF 节流滚动监听**（与进度条共用一个 handler；last-heading-below-threshold + 触底兜底取末节），active 高亮过渡入 no-preference 块；点击滚动 `scrollIntoView`（reduced-motion 用 auto）、不做 URL hash 同步。
   - **阅读进度条**：顶部 fixed 2px `--color-accent` 条（`z-index: var(--z-rail)`），仅 NoteView 挂载（含 404 词条错误态不显示）；rAF 节流 passive scroll，宽度 = `scrollTop / (scrollHeight - innerHeight)`，不可滚动（分母 ≤0）时宽 0 隐藏。
   - **上下篇**：`load()` 内与 `api.note` 并行拉 `api.notes(board)`（服务端已按板块规则排序），按 slug 定位渲染页脚「← 上篇 | 下篇 →」（RouterLink，slug encodeURIComponent；竞态守卫同 backlinks）；首/尾篇对应侧渲染空占位保持对称；`goSibling(±1)` 供 J/K 与页脚共用，越界 no-op。
   - **键盘快捷键**（window keydown，仅 NoteView 挂载；input/textarea/contenteditable 焦点或带 Ctrl/Meta/Alt 时忽略）：`E` → 编辑页；`Esc` → 删除确认态先取消确认，否则回板块页（面板打开时其 capture 段已 stopPropagation，此处收不到，天然满足优先级）；`J/K` → 下/上篇（同一 `goSibling`）。

### C. 收尾

6. **验证**：`npm run build` → dev(5173) 全矩阵走查（12 页 × 浅/深 + 命令面板 9 项 + TOC 临时词条 + 进度条三点 + 上下篇 + 快捷键 + 复制 + 移动端 375×812）→ preview(4173) 生产构建复核。
7. **截图** ≥8 张 → `UI-M4截图/`。
8. **回写**：`UI优化设计方案.md` §12 M4' 行完成标注；`AGENTS.md` 沉淀新铁律。
9. **提交**：feat（代码）+ docs（实施记录 + 截图 + 文档回写），只 add 明确文件；临时词条文件系统建删、grep 自查无验证残留。

## 偏离与理由（边做边记）

1. **kbd 文案按平台自适应**（⌘K / Ctrl K）：任务允许二选一或自适应；用 UA 检测一行实现，比固定 Ctrl+K 更贴合 macOS 用户习惯，逻辑集中在 App.vue 一处。
2. **主题切换动作执行后关面板**：与全部动作行为一致（可预测）；若保留打开状态需为单一动作加例外分支，收益低。
3. **有 query 时动作过滤用子串 includes 而非 Fuse**：动作仅 8 项且 label 为短中文词，模糊匹配反而引入噪音（搜 "词汇" 不应命中 "设置"）；词条侧仍走 Fuse。
4. **词条命中 cap 8 条**：面板可视高度约 6~9 行，cap 后无需面板内滚动即可浏览全部命中；动作不 cap（≤8 项）。
5. **复制按钮常显（低透明度）而非 hover 才出现**：移动端无 hover，隐藏会让触屏用户无从发现；低透明度常显 + hover 提亮两端兼顾。
6. **编辑页预览也带复制按钮**：复制是阅读动作、无副作用，且两处共用同一 MarkdownViewer 注入逻辑，为编辑页单独关闭反而增加分支。
7. **TOC 布局用三列 grid + 对称负 margin，而非 fixed/absolute 定位**：阅读页正文在 `.content`（侧栏右侧）内居中，其中心线 ≠ 视口中心，fixed 的视口百分比定位必然错位或需 JS 量测；grid 第 3 列宽度=物理边距宽度，TOC 宽度自适应且零溢出可能，纯 CSS 无量测代码，且 720px 正文列恒定保证零位移。
8. **scrollspy 用滚动监听而非 IntersectionObserver**：进度条已需要 rAF 节流滚动 handler，共用一个 listener 少一套 IO 生命周期管理，且「当前节 = 视口上缘以上最后一个标题 + 触底兜底」语义更可控。
9. **TOC 不做 URL hash 同步**：hash 落 URL 会引入 vue-router 导航/重复历史记录边界；目录跳转仅视觉滚动，刷新后回到页首属可接受行为。
10. **点击 TOC 滚动行为尊重 reduced-motion**（smooth → auto）：scrollIntoView 平滑滚动属"新增动效"，按令牌纪律显式降级。
11. **进度条在不可滚动词条上宽度 0（不显示满条）**：短词条无"阅读进度"语义，满条常驻是视觉噪音；仅可滚动时出现。
12. **首/尾篇上下篇隐藏侧留空占位**：保持「← 上篇 | 下篇 →」左右对称布局，避免首篇/尾篇时另一侧突然换位。
14. **动作项徽标的落位解释**：任务表述「动作项带图标与类型徽标」实施为——动作项带图标（Icon.vue），**类型徽标落在词条项上**（板块 chip + 更新日期），动作本身无分类可言；徽标与 M3' 面板行视觉同构。
15. **索引未就绪时的输入兜底**：面板打开即预热 `ensureFuse()`，但若用户在索引返回前输入，结果区显示「搜索索引加载中…」而非「没有匹配的结果」（query 非空且 loading 时区分文案）。
16. **进度条在挂载时同步一次**：`load()` 完成后 `nextTick(updateReadingState)`，刷新恢复滚动位置时进度条不闪烁为 0。
17. **scrollIntoView 尊重 reduced-motion**（计划 #10 的落地细节）：点击目录时读取 matchMedia 决定 smooth/auto。
18. **进度条 rAF 节流保留**（验证期确认无需让步）：真实浏览器中标签页转后台时 scroll 事件同样停发、恢复可见后 pending rAF 正常执行，不存在「scrollRaf 卡死」路径；IAB 停滞态属环境异常（见验证矩阵第 10 项）。

## 验证结果矩阵

**dev（localhost:5173）+ preview（localhost:4173，生产构建），IAB，桌面 1280×720 / 移动 375×812**

### 构建与残留（验证项 1）

- [x] `npm run build` 通过（server tsc + web vue-tsc -b + vite build，**171 modules**，M3' 为 164）
- [x] 残留自查：`__sivCalls`/rAF 垫片/`m4-toc-check` 在 web/src、server/src 零命中（垫片与记录器均为页面内 evaluate 注入，未落盘）；组件散写 hex/rgba 零命中；CSS ms 字面值仅存 tokens.css 令牌定义；`prefers-color-scheme` 仅 theme.ts；媒体查询全部字面量（767px / 1280px / no-preference）
- [x] 临时词条 `notes/vocab/m4-toc-check.md` 文件系统建删，未进 git；`notes/` 其余文件零触碰（boost/runaway/twinkle 等用户手工笔记保持未跟踪）

### 走查矩阵 12 页 × 浅/深（验证项 2）

- [x] 12 页 = 首页 / 词汇 / 短语 / 长难句 / 语法 / 阅读（临时长文）/ 编辑 / 新建 / 标签 / 标签详情 / 设置 / 404
- [x] 浅色 12/12：data-theme=light、color-scheme light、零横向滚动、页面内容正常
- [x] 深色 12/12：data-theme=dark、color-scheme dark、零横向滚动、页面内容正常
- [x] 新增 UI 双主题可读：面板（surface/border/shadow/accent-soft 高亮/overlay 遮罩）、TOC（accent-soft 高亮条）、进度条（accent）、上下篇（bg 底+hover accent 边）、复制按钮（surface 底+copied accent/error danger）——深色下全部走令牌覆盖，截图见 `UI-M4截图/`

### 命令面板（验证项 3）

- [x] ① 合成 Ctrl+K 打开（window 层监听）；cua/locator 真实按键在本会话 IAB 不可达（环境 quirk 见第 10 项），按任务预案以 evaluate 派发完成全部键盘验证
- [x] ② 空态 = 动作组 8 项（新建词条/四板块/标签/设置/切换主题，全部带预注册图标）+ 最近更新 5 条（板块徽标 + 日期），组头「动作/最近更新」
- [x] ③ 输入 abandon → 词条组命中 2 条（abandon + abandon oneself to，跨板块），动作组无匹配被滤除；词条在前
- [x] ④ ↑↓ 循环（末尾回绕首项）+ Enter 执行 → URL 断言 `/v/phrase/abandon-oneself-to`；aria-activedescendant 同步
- [x] ⑤ Esc 关闭面板且 URL 仍在阅读页（不触发「返回板块」）；焦点还原至侧栏入口按钮
- [x] ⑥ 遮罩坐标点击关闭（面板外左下角）
- [x] ⑦ 主题切换动作：浅色态文案「切换深色主题」→ 点击 → data-theme=dark + `en_tool:theme=dark`；再开面板文案已翻转「切换浅色主题」→ 点击还原（theme.ts 复用，面板执行后自动关闭）
- [x] ⑧ 无障碍抽查：role=dialog + aria-modal + aria-label、输入框 combobox/aria-expanded/aria-controls/aria-activedescendant、listbox/option/aria-selected、打开自动聚焦输入框、Tab 阻断困焦、关闭还原焦点、body overflow 锁开还原
- [x] ⑨ 面板打开状态下阅读页 E/J/K 不响应、Esc 只关面板（document capture 段 stopPropagation 独占键盘）；Ctrl+K 再按 toggle 关闭

### TOC（验证项 4，临时长文 5×h2 + 3×h3）

- [x] ≥1280px 视口显示右侧目录（`min-width: 1280px` 字面量媒体查询），sticky 跟随；h3 缩进、超长省略号
- [x] id 注入 `toc-sec-0..7` 且全文档唯一；目录数据 = 文档序 8 项（level 2/3 正确）
- [x] 点击目录项 → scrollIntoView 调用记录 `{ behavior: 'smooth', block: 'start' }`，auto 回退实测滚动到位（标题顶=scroll-margin-top 32px）
- [x] scrollspy 滚动高亮切换：顶部第一节 → 中部第二节 → 触底第五节（兜底规则生效）
- [x] 无 h2/h3 词条（abandon）目录整块隐藏
- [x] **TOC 出现前后正文零水平位移**：正文卡片恒 720px（grid 中列固定）、noteX 不变；`scrollWidth == clientWidth` 零横滚（三列 grid 第 3 列=物理边距宽，不可能溢出）
- [x] 编辑页预览无 TOC 侧栏（aside 仅 NoteView 渲染）

### 阅读进度条（验证项 5）

- [x] 三点断言：0%（全新导航顶部）/ 50.0238%（滚动中点）/ 99.9841%（触底）；加载时同步一次初始值（刷新恢复滚动不闪 0）
- [x] 仅阅读页挂载：编辑页/404 错误态/板块页均无 `.read-progress`
- [x] 顶部 fixed 2px accent 条、z-rail 层（截图 note-overall-light/dark 顶部可见）

### 上下篇（验证项 6）

- [x] href 与服务端板块排序逐一一致（`/api/notes?board=vocab`：abandon→boost→perseverance→…；临时词条在 boost 与 perseverance 之间，两端 href 均正确）
- [x] 边界：首篇 abandon 仅渲染「下篇 →」（上篇侧空占位）；尾篇 twinkle 仅渲染「← 上篇」
- [x] 真实点击页脚链接跳转成功；J/K 与页脚同一 `goSibling` 跳转函数实测（abandon→boost→、twinkle→serendipity）

### 键盘快捷键（验证项 7）

- [x] E → `/v/{board}/{slug}/edit`；Esc → 板块页；J/K → 下/上篇（合成事件断言 URL）
- [x] 输入框聚焦守卫：板块页搜索框输入 `e` 仅过滤列表、不跳转；编辑页按 E 无动作（NoteView 未挂载）
- [x] **Esc 优先级链**：删除确认态打开 → Esc 取消确认（仍在阅读页）→ 再 Esc 回板块页；面板打开时 Esc 只关面板（capture 独占，收不到阅读层）

### 代码块复制（验证项 8）

- [x] 按钮注入每个 pre 右上角（常显低透明度，hover/focus 提亮）；编辑页预览同样带按钮（有意决策 #6）
- [x] 点击反馈：成功路径 `copied` 类 + ✓ 图标 1.5s（writeText 捕获桩验证，载荷 174 字符与代码文本逐字节一致）；失败路径 `copy-error` 类 1.5s（IAB 程序化点击无用户激活、writeText 拒绝时实测）
- [x] 重渲染后按钮仍可用：注入随 `processAfterRender` 重跑（linkVersion 索引修正触发重渲染实测），点击委托挂在 `.note-body` 根节点不受 v-html 替换影响
- [x] 真实剪贴板读取在 IAB 受权限限制（NotAllowedError），以按钮状态 + 捕获桩作证（环境限制，真实浏览器 localhost 安全上下文 + 用户点击正常）

### 移动端 375×812（验证项 9）

- [x] 阅读页：TOC 隐藏（display:none）、进度条存在、上下篇完整可用（双链接）、零横滚
- [x] 首页：侧栏（含搜索入口）不在渲染树（offsetParent=null）、底部导航正常、零布局破坏
- [x] 面板无侧栏入口但 Ctrl+K 仍可打开（13 选项正常、零溢出）

### IAB 环境发现与验证手法（验证项 10，全程未用 Playwright）

- [x] **遮挡节流态整场持续**：中段起 rAF 0 帧/300ms + hasFocus=false（visibilityState=visible），reload 不恢复；**新开标签页激活面板后 rAF 恢复**（50 帧/300ms）——M3' 「遮挡节流」的会话级形态与恢复手法新证据
- [x] **rAF→setTimeout(16ms) 垫片晚期注入有效**：进度条/scrollspy 的 rAF 在事件回调时才调用 `window.requestAnimationFrame`（晚绑定），post-load 覆写即可接管；50.02%/99.98% 与 spy 切换均在垫片下取得
- [x] **程序化 scrollTo 零 scroll 事件投递**（新 quirk，独立于 rAF 停滞；裸监听计数 0）；**真实滚轮 cua.scroll 原生生效**（事件计数 2、进度/高亮原生更新）——应用在真实输入下完全正常
- [x] **locator.press 真实键盘事件不达页面监听**；合成 KeyboardEvent（window/document/body 派发）全部正常（任务预案「交互可用 evaluate 派发事件」）
- [x] **scrollIntoView smooth 在停摆管道下不动**：以 scrollIntoView 记录器断言调用参数 + auto 回退实测滚动到位；**截图在停摆管道下失败**（capture failed for guest），新开标签页恢复后成功
- [x] cua.scroll 曾一次 30s 停滞超时（停摆期）；管道恢复后正常

### preview 生产构建复核（4173）

- [x] TOC 8 项 + id 注入 + 复制按钮 + 进度条 + 上下篇 href 全部在位；面板 Ctrl+K 打开 + abandon 搜索 2 命中；零横滚（4173 origin 独立 localStorage，主题默认 system）

## 已知限制

1. **IAB 验证降级口径**：本会话 IAB 长期处于遮挡节流态（rAF 停摆 + scroll 事件零投递 + 真实按键不可达），进度三点/scrollspy/键盘类验证依「合成事件 + rAF 垫片 + scrollIntoView 记录器」完成，真实滚轮在管道恢复后原生复测通过；结论以「应用逻辑正确 + 真实输入路径原生生效」为准，逐帧/平滑滚动动画在真实浏览器呈现，IAB 不可证。
2. **复制按钮的真实剪贴板写入未能在 IAB 端到端取证**（writeText 需用户激活 + 权限策略）：成功路径以捕获桩验证载荷与 UI 反馈，失败路径真实触发；`navigator.clipboard.writeText` 在真实浏览器 localhost（安全上下文）+ 用户点击下为标准能力。
3. **TOC 平滑滚动为浏览器合成器动画**：IAB 停摆态无法呈现；已验证调用参数（smooth/start）与目标滚动位置（auto 回退实测 32px scroll-margin 生效），真实浏览器 smooth 正常。
4. **进度条/scrollspy 依赖 window scroll 事件**：IAB 程序化滚动不派发事件属环境 quirk；真实浏览器滚动必发事件（原生滚轮实测 2 次投递 + 更新生效）。
5. **面板打开期间独占键盘**（含 Ctrl+S）：编辑页若开着面板按 Ctrl+S 不会保存——模态语义的预期行为，关闭面板即恢复。
6. **目录点击不做 URL hash 同步**（偏离 #9）：刷新后回到页首。
7. **命令面板索引依赖 `getSearchIndex()` 缓存**：索引拉取失败时词条搜索不可用（动作组不受影响），下次打开面板自动重试。
