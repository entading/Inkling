# UI-M5 实施记录（编辑器 · 板块筛选 · 移动端收官）

> 里程碑 M5'（§9 编辑器增强、§10 板块筛选与移动端），UI 焕新阶段**最后一个里程碑**。
> 设计权威 `UI优化设计方案.md`；红线：PUT 全量源码语义不动、零服务端变更、零新依赖、NoteList/CommandPalette/theme.ts/字体产物/TTS 勿动。
> 会话开始已单独 `docs:` 提交上会话遗留（M4' 独立审查补记回写，`1139467`）；五个 UI-Mx交接提示词.md 沿 M3'/M4' 先例保持未跟踪。

## 执行计划（文件 × 改动点）

### A. 编辑器增强（`web/src/views/EditView.vue` + `web/src/components/Icon.vue`）

| # | 改动点 | 设计 |
|---|---|---|
| A1 | Ctrl/Cmd+S 补 dirty 检查 | 既有 `onKeyDown`（v1 M4 遗产，window keydown）与 `save()` 均在；仅在 `save()` 顶部加 `if (!dirty.value) return`——无改动零请求，保存按钮同享；saveState/error 展示复用。面板打开时该键被 capture 段静默属预期（命令面板铁律） |
| A2 | Tab 缩进 | 新增 `onSourceKeydown`（textarea 层）：Tab → preventDefault + `insertTextAtSelection('  ')`（两空格）；不做多行块缩进 |
| A3 | 插入 helper（撤销栈保命） | `insertTextAtSelection(el, text, selStart?, selEnd?)`：优先 `document.execCommand('insertText')`（触发 input 事件 → v-model 同步，单一 undo 步）；异常/不可用降级 `setRangeText`（破坏撤销栈，仅兜底，已知晓并接受）。工具条按钮一律 `mousedown.prevent` 保 textarea 焦点（execCommand 需焦点） |
| A4 | 工具条 | `.edit-toolbar` 从「移动端才显示的 chips 行」重构为 flex 行：左 `.format-toolbar`（role=toolbar，6 个 Icon 按钮）+ 右 `.view-chips`（桌面 `display:none`，移动端保持现状）。按钮：加粗 `**text**`、斜体 `*text*`、行内代码 `` `text` ``、引用（行首 `> `）、H2（行首 `## `）、wiki `[[text]]`。包裹类 = 选中→包 selection 后重选内文；无选区→插占位并选中占位文本（加粗/斜体/代码占位「文本」，wiki 占位「词条」）。行首类：引用=选区覆盖的每一行行首加 `> `（多行引用自然语义）；H2=仅选区首行（标题单行语义）。行首插入逐行 execCommand（多行=多 undo 步，可接受，记录在偏离） |
| A5 | Icon.vue 补注册 | 新增 `bold` / `italic` / `code` / `quote` / `h2` / `wiki` 六枚线性 path（lucide 风格 stroke 1.8 fill none，与既有同风格）；头注释同步 |
| A6 | `[[` 补全 | 检测：textarea input/click/keyup 后对 `text.slice(0, caret)` 跑 `/\[\[([^\[\]\n]*)$/`——命中未闭合 `[[` 开浮层，query=捕获组，from=caret−query.length；`]]`/换行/`[]` 断开自然失配关闭。候选：`getSearchIndex()` 跨板块（缓存复用，只读索引，不新增解析正则），title/slug 子串过滤（大小写不敏感，startsWith 优先排序），cap 8；索引迟到时 await 后若浮层仍开则补填。浮层 absolute 于 `.pane-source`（position:relative），坐标 = mirror div 测 caret（同字体/宽/padding/scroll 偏移），`z-index: var(--z-drop)`。键盘（`onSourceKeydown` 内浮层开时）：↑↓ 移动（preventDefault）、Enter/Tab 插入（preventDefault）、Esc 关闭（preventDefault+stopPropagation，**Esc 优先关补全不触发页面级行为**）。插入：选中 `[from, caret)` → insertText(`slug]]` 或 `board/slug]]`)——vocab 目标裸 slug（显式语义）、非 vocab 带 `board/` 前缀，与 parseWikiTarget 对应。关闭：Esc / blur（候选项 mousedown.prevent 防误关）/ caret 移出 / 输入 `]]`。**Tab 语义决定：浮层开=接受当前候选（编辑器惯例），浮层关=两空格缩进** |
| A7 | 预览同步滚动 | textarea scroll（passive）+ rAF 节流 → `scrollTop = 比例 × (preview.scrollHeight − clientHeight)`，单向（textarea→preview，无反向监听零反馈环）；仅桌面分屏生效（`matchMedia('(max-width: 767px)')` false 时），移动端单视图不做 |

### B. 板块页筛选与排序（`web/src/views/Board.vue`；NoteList / AZIndex 组件零改动）

| # | 改动点 | 设计 |
|---|---|---|
| B1 | 标签 chips 多选 | `boardTags` computed 从 `notes.value` 聚合 tag→count（count 降序）；chips 行渲染在搜索框下，无 tags 不渲染。点击 toggle（OR 语义），选中态 accent（复用 chip.active 视觉）。与搜索框 AND：filtered 管线 = q 过滤（既有 searchBoard）→ tags OR → sort |
| B2 | URL 同步 | 状态唯一来源 = route.query（syncFromRoute 同款模式扩展）：解析 `tags`（逗号 split）与 `sort`（白名单 `alpha|updated`，非法回 ''）。chips/排序变更 → `router.push({ query })`（push 而非 replace——浏览器 back 逐态回溯是验收项）；tags 空数组删键；q 仍只读不写（既有行为不动）。watch(route.query) → syncFromRoute 幂等无环 |
| B3 | 排序切换 | 两段控件 [字母序 / 最近更新] 放筛选行右侧。激活态=当前生效序（无参数时=vocab 字母、其余 updated 的服务端规则）。切换写 `?sort=`；**点击当前已激活段 = 从 URL 移除 sort 参数**（默认序恰等于该序，观感不变、URL 收敛干净）。本地排序对齐服务端：alpha=`localeCompare`、updated=`b.updated.localeCompare(a.updated)`（scanner.ts 同款） |
| B4 | 密度切换 | `en_tool:density` ∈ cozy/compact（localStorage 前缀铁律，try/catch）。`.board-page` 根挂 `density-compact` 类，scoped `:deep(.note-row)` 覆盖 padding（舒适=现状 `--space-3 --space-4`、紧凑 `--space-2 --space-3`）——NoteList 组件零改动。**决策：Home 最近添加不跟随**（密度语义限于板块页浏览场景，Home 不挂类）。两段控件 [紧凑 / 舒适] 与 sort 并排 |
| B5 | 空态 | EmptyState 条件从「有 q 且空」扩展为「q 或 tags 筛选激活且空」；**清除入口决策：单一 CTA「清除全部筛选」= tags + q 全清**（sort 不动）——空结果下保留单一条件的检索意义有限，全清最直接 |
| B6 | AZIndex 筛选态 | **分组条保留**：过滤后空字母组自动不渲染 + rail 字母自动禁用（既有 `present` 逻辑天然覆盖），零改动。stagger：armed 窗口仅初始数据就绪后存在，页内筛选重建列表拿不到祖先类 → 零重播（M3' 机制天然覆盖）；骨架不动 |

### C. 移动端 FAB 与回顶（新组件 `web/src/components/FloatingActions.vue` + `App.vue` 接线）

| # | 改动点 | 设计 |
|---|---|---|
| C1 | 回顶按钮 | window scroll passive + rAF 节流（镜像 NoteView 进度条模式），`scrollY > 600` 显示；点击 `window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })`（动效纪律：reduced-motion 用 auto）。桌面+移动都有。Icon `arrow-up`（M2' 已注册） |
| C2 | FAB | `<RouterLink to="/new">` + Icon `plus`（已注册），CSS 默认 `display:none`、≤767px 显示。**可见性决策：`/new` 页隐藏**（避免自指按钮），其余页面显示 |
| C3 | 堆叠与防遮挡 | 均为 fixed、`z-index: var(--z-nav)`。移动端：FAB `bottom: calc(72px + env(safe-area-inset-bottom))`（底导上方 16px）、回顶 `bottom: calc(128px + …)`（FAB 上方 56px = 48 高 + 8 间距）、右距 16px；桌面回顶 `bottom/right: 24px`。`App.vue .content` 移动端 padding-bottom `calc(72px + safe-area)` → `calc(136px + safe-area)`（= FAB 顶缘 120px + 16px 余量，防末行遮挡） |
| C4 | 出现过渡 | `<Transition name="pop">`（opacity + translateY(4px)），规则连同 keyframes 进 `no-preference` 块（动效铁律），reduced-motion 直切 |

### 验证计划（真实验证全部执行，结果见「验证结果矩阵」）

1. `npm run build`（tsc + vue-tsc + vite）通过。
2. 12 页面 × 浅/深两主题走查零回归。
3. 编辑器矩阵：Ctrl+S（改动→saved+PUT；无改动→零请求）/ Tab 两空格 / 工具条六按钮（包裹·占位·行首）/ 撤销回退 / `[[ser` 补全链路（vocab 裸 slug、非 vocab 前缀、Esc 只关浮层）/ 分屏滚动映射 / 草稿·FM 保护·离开守卫回归。
4. 板块筛选矩阵：chips 聚合数量与实际一致 / 单选多选 OR / 与搜索 AND / `?tags=` 直达与 back 回退 / sort 切换顺序断言 / density 切换+localStorage / 骨架 stagger 零破坏。
5. FAB 与回顶：375 视口 FAB 出现点击 → /new / 底部无遮挡；>600px 回顶出现（桌面+移动）/ 点击回顶 / reduced-motion 降级。
6. 移动端 375×812：编辑页（工具条+保存）/ 板块页（chips 折行）/ 首页阅读页零回归。
7. preview 生产构建（4173）复核关键结论。
8. 收官：设计方案 §12 M5' 行标注 + 阶段收官小结；AGENTS.md 收官改写；记忆更新。

## 偏离与理由（边做边记）

- （计划阶段）**EditView 已有 Ctrl/Cmd+S keydown**（v1 M4 遗产 `onKeyDown`→`save()`）：任务清单中的「Ctrl+S 拦截」已存在，本里程碑实际增量 = save() 补 dirty 检查（无改动零请求）。不算偏离，属现状盘点。
- （计划阶段）**工具条按钮行首插入多行引用会产生多条 undo 记录**：逐行 execCommand 无法合并为单步；多行引用属低频操作，接受并记录（A4）。
- （实施中）**词汇板「最近更新」排序的可见性决策**：AZIndex 按字母分组渲染会重排 updated 序使排序切换不可见（实测：sort=updated 时行序仍 A/B/M/P/R/S/T）。决策 = 词汇板在显式 `?sort=updated` 时**切换为扁平 NoteList**（放弃字母分组），无参数或 `sort=alpha` 时保持 AZIndex——属任务允许的「筛选态下的显隐决策」，AZIndex 组件字母分组逻辑零改动。
- （实施中）**IAB 遮挡节流中途发作**（编辑器矩阵 ⑥ 首测失败）：rAF 探针超时确认停摆，按 M3'/M4' 预案**新开标签页恢复**后复测通过；同步滚动代码逻辑无误（rAF 节流在真实浏览器正常），非应用缺陷。

## 验证结果矩阵

### 编辑器矩阵（dev，rAF 健康环境，合成 keydown + writeText/execCommand 程序化取证）

- [x] **① Ctrl+S**：无改动合成 ctrl+s → PUT 计数 0、无 saveState 展示；追加一行后合成 ctrl+s → PUT 计数 1 + 「已保存 ✓」，文件尾确认落盘「追加的一行。」
- [x] **② Tab 缩进**：光标置行首合成 Tab keydown → 精确插入两空格、caret +2
- [x] **③ 工具条**：加粗选中「验证」→ `**验证**` 且重选内文（selection 60..62）；斜体无选区 → 插 `*文本*` 且占位文本选中态；H2 行首插入（行首 `## ` 语义，实测落在行首）；引用覆盖三行（含中间空行）逐行行首 `> `
- [x] **④ 撤销栈**：`document.execCommand('undo')` 程序化探测 8 连退——3×引用、`## `、`*文本*`、`**` 包裹、Tab 两空格各自独立回退，退无可退（ok=false）回到保存态。真实键盘 Ctrl+Z 因 IAB 按键不达页面不可测（M4' 已知 quirk），代码走查：无 Ctrl+Z 拦截处理器，insertText 路径不破坏原生撤销栈
- [x] **⑤ `[[` 补全**：`[[ser` → 浮层 1 候选 serendipity（词汇徽标、z-index=30=`--z-drop`）→ Enter 插入 `[[serendipity]]`（vocab 裸 slug）+ 浮层关；`[[abandon` → 2 候选（abandon 词汇 + abandon oneself to 短语，startsWith 优先排序）→ ↓ 选中短语候选 → Enter 插入 `[[phrase/abandon-oneself-to]]`（非 vocab 带 board/ 前缀）；Esc 关浮层且值不变（无页面级行为）；补全开启时 Tab 接受候选（`[[twi` + Tab → `[[twinkle]]`）；`[[per`（有候选）→ blur 关浮层
- [x] **⑥ 预览同步滚动**：textarea 50%（2160/4320）→ 预览 2247.3/4495（期望 2248，1px 内）；预览 scrollTop 归零后 textarea 保持原滚动（单向映射零反馈环）
- [x] **⑦ 回归**：草稿条（新标签页加载恢复长草稿提示）；FM 丢失警示条 + 「恢复」按钮一键还原；FM 删除态 Ctrl+S → confirm 弹出、dismiss 后 PUT=0；dirty 态点「← 返回阅读页」→ confirm 弹出、dismiss 留在编辑页

### 板块筛选矩阵（dev，rAF 健康）

- [x] **chips 聚合**：/vocab 聚合出 cet6(3)/高频(2)/测试(1)/动词(1)/名词(1)/cet4(1)，count 降序+同数标签升序，与板块实际 tags 一致
- [x] **单选 OR**：点 cet6 → `?tags=cet6`，列表恰为 abandon/serendipity/twinkle 3 条
- [x] **多选 OR**：追加 cet4 → `?tags=cet6,cet4`，并集 4 条（abandon/boost/serendipity/twinkle）
- [x] **与搜索 AND**：tags=cet6,cet4 + 搜索 ser → 仅 serendipity（meta 1/7）；清搜索回 4 条
- [x] **URL 直达与 back**：直达 `?tags=动词,名词&sort=updated` → 两 chip 激活 + 2 条；筛选操作 push 后浏览器 back → 回上一筛选态（URL+chips+列表三方一致）
- [x] **排序切换**：词汇板点「最近更新」→ `?sort=updated` 扁平列表且行序=updated 倒序（M5 09-01→abandon 08-24 逐条核对）；点「字母序」→ `?sort=alpha` + AZIndex 分组恢复；**点当前已激活段 = 清参数回默认**（实测 ?sort=updated 态再点 → 参数移除）；无参数时激活态=板块默认序（vocab=字母序 pressed）
- [x] **密度切换**：紧凑 → 根类 `density-compact` + `en_tool:density=compact` + 行 padding 实测 8px 12px；舒适 → 12px 16px + cozy
- [x] **stagger 零破坏**：入场窗口摘除后（armed=false）点 chip 筛选 → `.stagger-arm` 不再挂载、列表零重播；骨架屏未动
- [x] **AZIndex 筛选态**：cet6 筛选 → 分组条保留，组只剩 A/S/T，字母条禁用态自适应（既有 present 逻辑天然覆盖）
- [x] **空结果态**：搜索+tags 双重空 → EmptyState「没有匹配…与所选标签的词条」+「清除全部筛选」CTA → 点击后 tags+q 全清、列表恢复

### 移动端与回顶矩阵（375×812，rAF 停摆段以 rAF→setTimeout 垫片完成 scroll 驱动断言，M4' 对策）

- [x] **FAB**：375 视口出现（display grid、z=40=`--z-nav`、底色 rgb(59,130,246)=accent、bottom 72px）；点击 → `/new`；**/new 页隐藏**（自指决策）；桌面 1280 视口 `display:none`
- [x] **回顶**：滚动 y=774(>600) 出现（z=40）；点击 `scrollTo({top:0, behavior:'smooth'})`（stub 取证调用参数，实际滚动同步推进）；回顶后按钮消失；**reduced-motion 降级**：stub matchMedia reduce → 点击 → `behavior:'auto'` 取证通过
- [x] **堆叠与防遮挡**：回顶 bottom 128px（FAB 上方 56px）+ FAB bottom 72px（底导上方）；`.content` 移动端 padding-bottom 实测 136px；移动端板块/编辑页零横滚
- [x] **移动端编辑页**：格式工具条可见（flex）+ 源码/预览 chips 可见、FAB 悬浮、保存可用（preview 段 Ctrl+S 实证）
- [x] **移动端板块页**：chips flex-wrap 折行（两行 59px 高）、排序/密度控件换行不重叠
- [x] **桌面回顶**：1280 视口板块页最大滚动 491px(<600) 正确**不**出现；1280×500 视口（maxScroll 711>600）出现、位置 right/bottom 32px——阈值逻辑桌面移动共用，仅定位差异

### 全站走查与 preview 复核

- [x] **12 页 × 浅/深走查**：/ /vocab /phrase /sentence /grammar /tags /tags/cet6 /settings /v/vocab/abandon /v/vocab/abandon/edit /new /404 全部渲染正常，`data-theme` 逐页正确，**24 项零横滚**（scrollWidth==clientWidth）
- [x] **preview 生产构建（4173，`index-D0BpstW9.js`）**：`?tags=cet6` 筛选直达 3 条 + chip 激活；`[[per` 补全浮层出 perseverance；改动后合成 Ctrl+S → PUT 发出 + 「已保存 ✓」（无改动零请求已在 dev 干净态验证：put=0）
- [x] **构建**：`npm run build`（server tsc + web vue-tsc + vite）两轮通过（中途补 AZIndex 显隐决策后复建）
- [x] **静态纪律自查**：组件内散写 hex/rgba 零命中（grep 复核）、ms 字面值零命中、z-index 全令牌（z-nav/z-drop）、localStorage 仅 `en_tool:density`（前缀铁律）、媒体查询字面量（767px）、prefers-color-scheme 零分支、零新依赖
- [x] **残留清理**：临时词条 ×3（m5-check/m5-tmp-a/m5-tmp-b）文件系统建删、notes/ 回到原始 6 词条零 git 痕迹；草稿 key `en_tool:draft:vocab:m5-check` 已清（localStorage 余 theme=system + density=cozy 两枚合法偏好）；验证用 fetch stub / rAF 垫片 / matchMedia stub 均为页面运行时注入，grep 自查源码零落盘

## 已知限制

1. **IAB 遮挡节流两次中途发作**（编辑器矩阵 ⑥ 首测、移动端回顶首测）：rAF 探针确认停摆后分别以「新开标签页」与「rAF→setTimeout 垫片（晚绑定 rAF 有效）」恢复，停摆段断言仅覆盖 scroll/rAF 驱动路径，键盘/网络路径均在健康环境取证。同步滚动与回顶在真实浏览器为标准 rAF/scroll 行为，IAB 停摆不影响结论。
2. **真实键盘 undo 不可端到端取证**（IAB 真实按键不达页面，M4' 已知 quirk）：以 `document.execCommand('undo')` 程序化探测原生撤销栈（8 步逐操作回退）+ 代码走查（无 Ctrl+Z 拦截）替证；真实浏览器 Ctrl/Cmd+Z 走同一原生栈。
3. **词汇板「最近更新」为扁平列表**：AZIndex 字母分组会重排 updated 序，显式 `?sort=updated` 时切换扁平 NoteList（显隐决策，见偏离）；字母分组本身未重构。
4. **多行引用插入产生多条 undo 记录**：逐行 execCommand 各成一步（低频场景，接受）。
5. **`[[` 补全过滤词不含 `[`/`]`/换行**：wiki 目标本就不允许这些字符（isLegalWikiText 语义），输入即关闭浮层属预期。
6. **板块页搜索词平时不写 URL**（既有行为保留）：仅当 tags/sort 变更触发 pushRouteQuery 时，已输入的 q 随之入 URL（保证 AND 组合与分享语义完整）。
7. **Home 最近添加不跟随密度切换**：密度语义限于板块页浏览场景（决策记录于执行计划 B4）。
8. **含逗号的标签名在 `?tags=` URL 往返会断裂**（split(',') 语义）：自建知识库低概率场景，chips 内存态不受影响，仅 URL 分享/回退失真——复检记录为已知限制不修（修复需自定义分隔符或编码方案，收益不匹配）。

## 审查（第二轮，2026-09-01，复检会话）

对已提交状态（HEAD = cd5cbea）独立复验，**结论：通过验收；发现并修复 2 处编辑器缺口（`524df59`）**。核实范围与结果：

- [x] **提交隔离与禁区**：`570a213`（feat）触碰文件 = App.vue / FloatingActions.vue（新）/ Icon.vue / Board.vue / EditView.vue 恰 5 项；`1139467..HEAD` 对 **server/、notes/、index.html、package.json（前后端+lockfile）、lib 全部（markdown/theme/tts/search/stagger/tagColor/backlinks）、CommandPalette、NoteView、Skeleton、TagBadge、SearchPanel、EmptyState、AZIndex、MarkdownViewer、NewNote、Settings、Home、Tags、TagDetail、NotFound、main.ts、router.ts、api.ts** 零改动；notes/ 零变更、工作区无未跟踪笔记残留；5 个交接提示词保持未跟踪。
- [x] **静态纪律**：新代码散写 hex/rgba 零命中；CSS ms 字面值零命中（grep 命中均为注释与 v1 既有 JS 定时器）；z-index 全令牌（z-nav/z-drop）；localStorage 仅新增 `en_tool:density`（前缀铁律）；媒体查询全字面量（767px）+ no-preference 块；prefers-color-scheme 零分支；依赖零变更。
- [x] **代码逐文件核对**：insertTextAtSelection（execCommand 优先/降级派发 input）/prefixLines（行首偏移收集、从后向前插、选区恢复公式逐项推演无误）/insertWikiHint（from+caret 竞态无懈、vocab 裸 slug 语义）/fillHintItems（seq 守卫 + 错误清空）/measureCaret（mirror 不入布局流）/Board pushRouteQuery↔syncFromRoute 往返/FloatingActions（listener+rAF 卸载清理、reduce 点击时读取）。
- [x] **发现并修复 R-1（IME 组合守卫缺失）**：`onSourceKeydown` 未做 `isComposing || keyCode === 229` 早退——拼音组字中 Enter 确认候选/↑↓ 选字/Esc 取消会被补全劫持（CommandPalette 有同款守卫，此处漏配）。修复后实测：合成 `isComposing:true` 的 Enter → 浮层保持开、零插入；对照组 `isComposing:false` → 正常插入 `[[twinkle]]`。
- [x] **发现并修复 R-2（补全浮层水平钳制）**：positionHint 的 left 未钳制，行尾触发时浮层右缘可溢出 pane，窄窗口有横滚风险——加 `min(left, pane.clientWidth − 320)` 钳制；实测长行触发 `hintRight(616) ≤ paneRight(736)`。
- [x] **回归电池**（dev，修复后构建）：无改动 Ctrl+S → 0 PUT；改动 → 1 PUT + 「已保存 ✓」；工具条加粗包裹；Tab 两空格；`[[per` 补全 + Esc 关闭；FM 软保护（损坏草稿 → warn 横幅 → 「恢复」还原 frontmatter）；板块 `?tags=cet6` 直达 3 条 + chip 激活、点 cet4 → OR `?tags=cet4`、密度 compact 类+localStorage；Ctrl+K 面板开（body 锁滚）/Esc 关；阅读页 E → 编辑页；375 视口 FAB 出现（z=40）点击 → /new、/new 隐藏。
- [x] **preview 复核（4173，修复产物 `index-Bo4Ad05o.js`）**：生产 bundle 正确加载，`?tags=cet6` 筛选直达 3 条 + chip 激活态。
- [x] **环境事件澄清（重要，非应用缺陷）**：复检中两次「标签页挂起（evaluate 超时）」根因 = **复检流程自身触发 FM 软保护的 window.confirm 模态框**——Tab 在位置 0 插入两空格使草稿变成 `  ---` 开头 → extractFrontmatter 判空 → fmLost → 此后每次 Ctrl+S 弹 confirm；**IAB 原生 confirm 打开期间 evaluate/locator 全部阻塞**（表现为超时假死），且首轮 getJsDialog 探针两分支均静默返回未发现对话框（if/else 内表达式不外显的写法坑）。dismiss 后页面立即恢复、新标签页加载同一编辑页正常。FM 保护本身工作完全符合设计（确认对话框出现 = 该验收项的活体再现）。
- [x] **复检自身残留清理**：临时词条 m5-rc 文件系统建删、notes/ 零 git 痕迹；`en_tool:draft:vocab:m5-rc` 由保存成功路径与手动清理双保险归零；localStorage 终态仅余 `en_tool:theme=system` + `en_tool:density=cozy`（合法偏好键）；验证用 stub/垫片零落盘（grep 自查）。
- [备注] **复检会话 IAB 健康度**：两轮 rAF 探针健康（34–50 帧/200–300ms），rAF 依赖路径在健康窗口完成；「假死」均确认源于模态 confirm 而非遮挡节流（与本轮实施会话的 rAF 停摆事件性质不同，勿混淆）。


