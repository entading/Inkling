# UI-M3' 实施记录（微动效）

> 状态：**已完成（2026-09-01）**
> 设计权威：`UI优化设计方案.md` §6 / §12 / §14；本记录只做 M3' 范围。

## 执行计划（文件 × 改动点）

### 0. 前置事实（动手前核对）

- **单根检查（Transition 前提）**：逐一核对 9 个视图组件模板根元素——Home `.home`、Board `.board-page`、NoteView `.note-page`（Teleport 工具条位于根 div 内部，仍是单根）、EditView `.edit-page`、NewNote `.new-note-page`、Tags `.tags-page`、TagDetail `.tag-detail-page`、Settings `.settings-page`、NotFound `.not-found`——**9/9 唯一根，无需处理**。
- NoteList.vue 根为 `ul v-if / EmptyState v-else` 条件对（运行时单 vnode），但 NoteList 不直接处于 Transition 下（嵌在视图内部），不受单根约束影响。
- 存量动效盘点（grep 全站）：`transition: … 0.15s ease` 共 29 处（App/Board/Home/NoteView/EditView/NewNote/NoteList/TagBadge/SearchPanel/Tags/Settings/AZIndex/NotFound）、`0.2s ease` 2 处（Settings 开关 track/thumb）；`@keyframes` 现存 0 处；MarkdownViewer（wiki 悬停预览卡）无 transition，零接触。
- 动效令牌 `--duration-fast/base/slow`、`--ease-out` M1' 已定义至今零引用，本里程碑开始引用。

### A. 页面转场（§6）

1. **`web/src/styles/tokens.css`**：动效组新增 `--duration-page: 160ms`（设计定稿 160ms 不在 120/200/320 阶梯内，按令牌纪律落令牌）、`--stagger-step: 24ms`、`--duration-shimmer: 1400ms`（shimmer 循环周期，现有 slow=320ms 对循环过快）、`--skeleton-shimmer`（浅 `rgba(255,255,255,0.65)` / 深 `rgba(255,255,255,0.07)`，白色叠加层双主题同构、透明度分层，避免组件散写 rgba）。
2. **`web/src/App.vue`**：`<RouterView v-slot="{ Component }">` + `<Transition name="page" mode="out-in">` + `<component :is="Component" :key="route.path" />`；scoped 样式新增 no-preference 块：`.page-enter-active/.page-leave-active { transition: opacity var(--duration-page) var(--ease-out), transform var(--duration-page) var(--ease-out) }`，enter-from `opacity:0; translateY(4px)`，leave-to `opacity:0; translateY(-4px)`（各 fade + 4px 上移）。key=route.path：query 变化不触发转场属预期（记录）。

### B. 骨架屏（§6）

3. **`web/src/components/Skeleton.vue`（新建）**：`w/h/r` 可选 props（默认 100% × var(--text-md) × radius-sm），surface-2 底 + `::after` 高光扫过（`linear-gradient(90deg, transparent, var(--skeleton-shimmer), transparent)`，`animation: … var(--duration-shimmer) linear infinite`）；shimmer 全部包在 `@media (prefers-reduced-motion: no-preference)` 内（含 @keyframes）。
4. **`web/src/views/Board.vue`**：loading 分支 `<p>加载中…</p>` → 列表骨架 6 行（行容器复用 .note-row 布局尺寸：surface 底/border/radius-md/padding space-3 space-4，内含标题条 + 右侧条，高度走 `--text-*`）。
5. **`web/src/views/NoteView.vue`**：loading 分支 → 词条卡骨架（卡片复用 .note 容器规格：surface/border/radius-lg/padding space-7、移动端 20px 同步）= 标题条（--text-2xl）+ IPA 条（--text-lg）+ 三段各两行正文条（--text-body，段距 0.9em）。
6. **`web/src/views/Home.vue`**：loading 分支 → 两个小节标题条 + 板块卡格骨架（同款 grid，4 卡：chip 方块 40px + 标签条 + 计数条）+ 最近添加列表骨架 6 行。SearchPanel 在 loading 分支之外常驻渲染，骨架不复刻搜索框（否则双搜索框，见偏离）。

### C. 列表 stagger 与按压反馈（§6）

7. **`web/src/components/NoteList.vue`**：`li` 入场 `opacity 0→1 + translateY(6px)→0`（`animation: row-in var(--duration-slow) var(--ease-out) backwards`，keyframes 与动画规则同入 no-preference 块）；每项 delay = `calc(var(--stagger-step) * index)` 内联注入，**cap 前 12 项**（第 13 项起无动画无 delay）；**仅首次渲染播放**：非响应式 `Set<key>` 记录已播行，`watchEffect(…, { flush: 'post' })` 在渲染后标记——搜索过滤/数据更新复用或重建的行一律不再播（实现方式见偏离）。
8. **按压反馈**：可点击按钮与板块卡 `:active { transform: scale(0.98) }` + `transform` 并入元素 transition 属性，规则全部入各组件 no-preference 块。应用点清单：
   - 链接型按钮：Home `.new-btn`、Board `.new-link`、Board `.empty-clear`、NoteView `.edit-link`、NoteList `.empty-cta`
   - 卡片：Home `.board-card`
   - 实按钮：Home `.menu-btn`、NoteView `.speak-btn/.delete-btn/.sel-bar-btn/.banner-close`、Board `.chip`、SearchPanel `.chip`、EditView `.save-btn/.chip/.banner-close/.banner-action`、NewNote `.submit-btn`、Settings `.tts-preview`、AZIndex `.az-letter`
   - 定位元素特例：Board/SearchPanel `.chip` 带 `translateY(-50%)` 居中 transform，:active 写组合值 `translateY(-50%) scale(0.98)` 防跳动
   - 明确不做：Settings `.theme-opt`（分段单选有自己的选中态语言）、Settings 开关（track/thumb 自带 0.2s 动效）、Tags `.cloud-tag` 与各导航/列表行（链接与列表行非按钮）、TagBadge（非交互）
9. **存量动效时长统一换令牌**（映射规则见下表，逐处替换 31 处）。

### D. reduced-motion 全静态（§6）

10. 统一 `no-preference` 包裹模式：新增动画（shimmer/stagger/页面转场/按压 scale）的动画规则与 keyframes 全部写入 `@media (prefers-reduced-motion: no-preference) { … }`——默认静态、显式允许时才动（与 M1' theme-transitioning 守卫同款）；不写任何 `prefers-reduced-motion: reduce` 覆盖分支。
11. 存量 `0.15s/0.2s` hover/focus transition 属既有行为保留（不在 §6 关闭清单四类内），仅做令牌化换值。

### 收尾

12. **验证**：`npm run build` → dev（localhost:5173）走查矩阵 12 页 × 浅/深 → 骨架屏临时注入 sleep(800ms)（Board/NoteView/Home load）验证后移除 → 转场/stagger/按压/reduced-motion CSSOM+行为断言 → preview（4173）生产构建复核 → 录屏 transition.webm（可选）→ 截图 ≥6 张。
13. **回写**：`UI优化设计方案.md` §12 M3' 行完成标注；`AGENTS.md` 沉淀 M3' 新铁律。
14. **提交**：feat（代码）+ docs（实施记录+截图+§12+AGENTS），只 add 明确文件；sleep 注入确保提交前移除。

## 偏离与理由（边做边记）

1. **Home 骨架不复刻搜索框**：任务写「搜索框+板块卡格+列表骨架」，但 Home 的 `SearchPanel` 在 loading 分支之外**常驻渲染**（v-if 链只覆盖板块卡与最近添加），骨架再画一个搜索框会出现同屏双搜索框。按真实布局只做「小节标题条+板块卡格+列表骨架」，布局跳动最小的目标不受影响。
2. **stagger 播放判定用「已渲染 key 集合」而非 appear-only/定时器**：Vue keyed 复用使「仅首次挂载」不能靠 CSS alone（过滤后重建的行会重播）；`watchEffect + flush:'post'` 在每次渲染完成后把当前行 key 写入非响应式 Set，此后这些行不再获得动画类——过滤/数据更新零重播，且不依赖魔法定时器。副作用：组件实例生命周期内每行至多播一次（重新进页=新实例=重播，符合「仅首次挂载」语义）。
3. **stagger cap 语义**：第 13 项起**无动画**（不只是 delay=0）——「第 13 项起无 delay」取严格解读，长列表尾部不参与波浪入场，验证断言「第 13+ 项 animation-delay 为 0」仍成立（无动画时 computed delay=0s）。
4. **stagger 动画时长取 `--duration-slow`（320ms）**：设计未给单项时长，取现有阶梯 slow 档（入场波浪的单元动作比 hover 反馈重、比页面转场轻）；delay 步进按要求落 `--stagger-step: 24ms` 令牌，cap=12 为常量（单一使用点，落令牌无复用收益，记录取舍）。
5. **按压反馈逐组件手写而非全局规则**：全局 `button:active` 会波及分段单选/开关/下拉行等不想动的控件，且定位 chip（translateY(-50%)）需要组合 transform 特例；逐组件写应用点即交付物要求的清单本体。transform 一律并入该元素既有 transition 属性（无 transition 的补一条 `transform var(--duration-fast) var(--ease-out)`）。
6. **shimmer 循环周期单独落 `--duration-shimmer: 1400ms`**：现有 120/200/320 阶梯是交互反馈时长，1.4s 循环扫描塞进 slow=320ms 会痉挛；ms 值落 tokens.css（组件禁 ms 字面值纪律不变）。
7. **`--skeleton-shimmer` 高光令牌**：任务允许「令牌或 rgba 叠加层」，取令牌（浅 0.65 / 深 0.07 白色叠加）——组件禁散写 rgba 纪律优先于 rgba 直写；双主题同为白色叠加、仅透明度分层，与 `--tag-hover-overlay` 的浅压暗/深提亮策略同思路（骨架底是中性灰，双向提亮即可读）。
8. **stagger 机制经三次演进，终版 = 视图级 `stagger-arm` 入场窗口（`lib/stagger.ts`）**：
   - v1「实例级 seen 集合 + watchEffect(flush:post) 标记」：实测发现 AZIndex 按字母分组渲染多个 NoteList，过滤时分组数变化导致实例卸载/重建，**seen 随实例死亡 → 恢复全量时 6 个单行组全部重播**，违反「过滤不重播」。
   - v2「模块级 seen + route.path 纪元」：多实例共享可变可变状态 + computed 内判定，实测出现 seen 只剩单 key 的异常状态（多实例计算次序与共享态交错，机理未完全定型），判定该方向本质上脆弱，放弃。
   - v3 终版：NoteList **无状态**（前 12 行带 row-in 类与递增内联 delay），动画选择器门控在祖先类 `.stagger-arm` 下；视图（Board/Home/TagDetail）数据就绪时挂该类、`STAGGER_CAP*step + 2*slow`（令牌 parseFloat 推导 = 928ms）后摘除。导航入场播一次波浪；页内过滤/重组重建的列表拿不到祖先类 → 零重播。无跨实例共享状态，结构确定。
   - 过程中还抓到并修复 useStaggerArm 的**布尔反转 bug**：loading 起始即 true，watch 首次回调必然是 `true→false`（数据就绪），初版把「就绪」误判为 true 导致窗口永不武装（调试钩子实测 watch 仅触发一次且 ready=false 定位）。
9. **初始加载会播一次页面 enter 转场（设计未明确，有意保留）**：vue-router 异步解析完成后 RouterView 从空到组件，Vue Transition 视为 enter——首次加载/刷新有 160ms 淡入，与 §6「入场 fade」语义一致，保留。
10. **按压反馈幅度统一 0.98**：实施中曾考虑小尺寸按钮（az-letter 24px）用 0.96 增强可感度，为不私造规格外数值回退为全站统一 0.98；应用点覆盖全部标准 push button + 链接型按钮 + 板块卡（清单见执行计划 §C，与 CSSOM 断言到的 10 组规则一致）。
11. **会话前置提交 `f445919`**：本会话开始时工作区存有上会话（M2' 独立审查）遗留未提交的 `UI-M2实施记录.md`「审查」节与 `AGENTS.md` 进度行，按 M2' 会话处理 M1' 遗留的先例单独 `docs:` 提交清历史，不混入 M3' 提交。
12. **录屏 transition.webm 未交付**：IAB recording 文档在本运行时不可用（`agent.documentation.get("recording")` 报 not found），且当前渲染管道停滞下录屏只能得到静止帧，无动效证据价值；按任务「如有条件」条款降级，转场证据以类生命周期断言 + 终态截图承载。
13. **3000 端口复用上会话遗留 API 服务**：本会话 `npm run dev` 的 server 因 EADDRINUSE 启动失败，但 3000 端口已有上会话遗留的同代码 tsx 服务正常响应（M3' 服务端零改动，索引/监听同一 notes/），复用之；web(5173) 由本会话进程提供。

## 动效时长映射总表（存量 → 令牌）

| 原值 | 归入 | 差值 | 说明 |
|---|---|---|---|
| `0.15s ease`（29 处） | `var(--duration-fast) var(--ease-out)` | 150→120ms（−30ms） | hover/focus 态过渡，全体感更跟手；ease→ease-out 曲线更收 |
| `0.2s ease`（Settings 开关 ×2） | `var(--duration-base) var(--ease-out)` | 0ms | 同值换令牌 |

29 处 0.15s 分布：App.vue ×2、Board.vue ×4、Home.vue ×2（含 board-card 两行）、NoteView.vue ×3、EditView.vue ×4、NewNote.vue ×2、NoteList.vue ×2（含 note-row 两行）、TagBadge.vue ×1、SearchPanel.vue ×2、Tags.vue ×1、Settings.vue ×4（0.2s 两处除外）、AZIndex.vue ×1、NotFound.vue ×1。新动画（转场/stagger/shimmer/按压）不在映射表内（本就是新增，直接令牌）。

## 验证结果矩阵

**dev（localhost:5173，3000 复用遗留同代码 API）+ preview（localhost:4173，生产构建），Chromium 内置浏览器（IAB），视口 1280×720 / 移动 375×812**

> 环境说明（重要，适用于全部动效断言）：本轮 IAB 处于「遮挡窗口节流」状态——`visibilityState=visible` 但 `hasFocus=false`，实测 **rAF 完全停发（0 帧/1.5s）、setTimeout ~10 倍延迟（50ms→554ms）**。这使 Vue Transition（双重 rAF 驱动的类编排）与 CSS 动画时间线冻结在中间态，computed opacity 读到 0，属环境病而非应用缺陷（判据见验证项 4）。验证策略：静态样式断言（CSSOM/类/内联 style）为主 + rAF→setTimeout 垫片驱动编排走通 + 「终态踢」（手动清除转场类呈现终态）+ 截图佐证；M1' 沉淀的「reload 重测」本轮升级为该完整手法，已回写 AGENTS.md。

### 构建与管线（验证项 1）

- [x] `npm run build` 通过两次：实施中期（167 modules）与清理注入后终版（168 modules，含 stagger.ts）；终版产物 `index-CFIIn9rp.css`（395.15KB）/ `index-CDqo7dCE.js`（292.62KB）
- [x] 零新依赖（package.json 未动）；服务端/notes/markdown.ts/tts.ts/theme.ts/index.html/fonts 零接触（git status 核对）

### 走查矩阵 12 页 × 浅/深（验证项 2）

- [x] 12 页面 = 首页 / 词汇 / 短语 / 长难句 / 语法 / 阅读（abandon）/ 编辑（abandon）/ 新建 / 标签 / 标签详情（高频）/ 设置 / 404（/no-such-page-404）
- [x] 浅色 12/12：零横向滚动、内容完整（textEmpty=false）、data-theme=light
- [x] 深色 12/12：零横向滚动、内容完整、data-theme=dark、`.layout` bg=rgb(16,20,24)=#101418
- [x] M2' 状态无回归：阅读页与编辑页 `.note-body` 衬线栈（Charter/Cambria/Noto Serif 命中）、UI 层无衬线、标签 8 色、板块卡 chip/计数色、图标齐全（截图 note-after-transition-light/dark.png、home-after-transition-dark.png）
- [x] 主题切换机制未动：theme-transitioning 守卫规则仍在 no-preference 内（CSSOM 核对 themeTransitionGuard=true）
- [△] 转场类生命周期：垫片驱动下完整走通 leave-from→leave-to→卸载→挂载 enter-from/enter-active→类全部移除（见验证项 4）；走查中 900ms 短等待下 enter 类残留为节流时序，4.5s+ 终态断言与终态踢后均零残留

### 骨架屏（验证项 3，临时 sleep(800ms) 注入后验证，验证后已移除）

- [x] Board：6 行骨架，行容器复用 .note-row 规格（surface/border/radius-md/padding），内容条 16px（--text-md）/13px（--text-xs）；shimmer `skeleton-sweep` 运行中、周期 1.4s（--duration-shimmer）
- [x] NoteView：8 条（标题 27.2px=--text-2xl + IPA + 三段×两行 17px=--text-body，段距 0.9em），卡片复用 .note 规格（padding 48px=--space-7、移动端 20px 同步）
- [x] Home：4 张板块卡骨架（chip 40px + 标签条 + 计数条，同款 auto-fit grid）+ 6 行列表骨架 + 两个小节标题条；SearchPanel 常驻不进骨架（偏离 #1）
- [x] 双主题可读：浅色 surface-2 底 + 0.65 白扫光、深色 #1f2730 底 + 0.07 白扫光（截图 skeleton-board-light/dark.png、skeleton-note-dark.png、skeleton-home-dark/light.png）
- [x] 布局跳动实测：骨架态→加载完成 pageH Home 989→1311、NoteView 720→991——首屏内骨架与真实内容结构对齐（标题/搜索框/卡片格位置无位移），增长发生在首屏以下（已知限制 #5）
- [x] 三处注入（Board.load/Home.onMounted/NoteView.load）验证后全部移除，grep `M3'-TEST-SLEEP`/`__m3seen`/`__m3arm`/`__rafPatched` 归零；13 条 m3-stagger-* 临时词条文件系统建删，notes/ 零残留（git status + API 计数 6 复核）

### 页面转场（验证项 4）

- [x] CSSOM（dev+preview 双源一致）：`.page-enter-active/.page-leave-active` 规则存在且 `transition: opacity/transform var(--duration-page) var(--ease-out)`，位于 no-preference 块内；enter-from `opacity:0; translateY(4px)`、leave-to `opacity:0; translateY(-4px)`
- [x] 编排走通（rAF 垫片驱动）：导航 / → /vocab 依次出现 leave-active+leave-to → board-page enter-from+enter-active → 最终仅 `board-page` 单根、无 page-* 残留——out-in 时序完整
- [x] 终态断言（终态踢后）：/、/vocab、/v/vocab/abandon、/settings 四页 residual=false、opacity=1、无残留 stagger-arm（arm 窗口已按令牌时长自然过期）
- [x] key=route.path 语义：query 变化（板块页搜索）不触发转场（代码语义 + 无转场类出现）
- [△] transition.webm 录屏未交付（偏离 #12），转场视觉证据以终态截图 + 编排断言承载

### 列表 stagger（验证项 5）

- [x] 结构断言（dev+preview 双源）：7 个 NoteList 实例（AZIndex 分组 1+1+13+1+1+1+1）中，每实例前 12 项含 row-in 类且内联 `animation-delay: calc(var(--stagger-step) * i)`（i=0..11），computed 解析 0→0.264s 严格 24ms 递增（--stagger-step）；第 13 项起无类、无内联、computed animation-delay=0s——结构断言 errs=[]
- [x] cap 生效：13 行的 M 组第 13 项（m3 stagger 13）无动画
- [x] 过滤零重播：arm 窗口过期后（模拟用户开始操作），板块内搜索过滤 19→13 行、清除还原 19 行，全程 0 行处于动画态（animationName=none）——含 AZIndex 分组卸载/重建场景（v1 机制在此场景重播 6 行，v3 修复）
- [x] 新导航重播：重新加载后 arm 窗口内 18 行处于动画态（6 单行组×1 + 13 行组×12），符合「每次导航入场播一次」
- [x] 动画结束 opacity=1：CSS 语义保证（backwards fill 只作用于 delay 期，动画结束回归自然态）+ 加载完成截图行全部可见（终态截图）；冻结 timeline 下无法逐帧断言中间过程（已知限制 #1）

### 按压反馈（验证项 6）

- [x] CSSOM：10 组 `:active` transform 规则全部位于 no-preference 块内（dev+preview 双源一致），覆盖执行计划 §C 清单全部应用点；SearchPanel/Board 的定位 chip 为 `translateY(-50%) scale(0.98)` 组合形式
- [x] transform 已并入各元素 transition 属性（或新增独立 transform transition），按压回弹有过渡
- [△] 实按抽查降级：IAB 节流下定位点击超时/按住态无法保持断言（同 M1' 渲染停滞 quirk），以 CSSOM 规则 + 应用点清单代码走查为准

### reduced-motion 全静态（验证项 7）

- [x] 代码走查：全部新增动画（页面转场、stagger row-in、骨架 shimmer、按压 scale）的动画规则与 keyframes 均写入各自组件的 `@media (prefers-reduced-motion: no-preference)` 块，全站 0 处 `prefers-reduced-motion: reduce` 覆盖分支（grep 核对）
- [x] CSSOM 断言（dev+preview 双源）：递归遍历样式表（含 media 嵌套），凡含 animation 的规则、row-in/skeleton keyframes、`:active`+transform 规则全部 inGuard=true，**violations=[]**；theme-transitioning 既有守卫未破坏
- [x] 与 M1' 降级口径一致：browser-use 无法翻转系统 reduced-motion，以「规则位置」为证据

### preview 生产构建复核

- [x] `npm run build` 终版产物经 `npm run preview`（4173）复核：转场 CSSOM（page 规则/两枚 keyframes/10 组 active/零违规）、stagger 结构（6 行 inline delay 递增）、arm 窗口（窗口内 animationName=row-in-*、窗口外 none）、浅色主题渲染——与 dev 一致
- [x] 复核后 preview 进程精确 taskkill //PID //F 关闭（无 //T），4173 释放；两源 localStorage 主题偏好恢复（5173=system、4173 移除）

### 移动端 375×812

- [x] 首页深色：底部导航 5 图标、板块卡单列、零横滚（mobile-home-dark.png）

### IAB 稳定性（本轮重大环境发现）

- [x] 定性实验链：rAF 探针（0 帧/1.5s）→ 50ms setTimeout 实测 554ms → `visibilityState=visible/hasFocus=false` → 判定「遮挡窗口节流」；rAF→setTimeout 垫片驱动 Vue 转场编排完整走通 → **应用逻辑无缺陷**；垫片安装晚于 Vue 首次 rAF 调用时编排仍冻结（原生 rAF 回调已丢失）→ 引入终态踢手法补验证
- [x] 已回写 AGENTS.md「浏览器验证工具」节供后续里程碑使用

## 复检（第二轮，2026-09-01 提交后）

对已提交状态（HEAD = e7fcc12）独立复验四个功能模块，**发现并修复 1 处自留死代码，其余全部通过**：

- [x] **提交隔离与禁区**：`36da2da` 17 文件（15 改 + Skeleton.vue/stagger.ts 新建）全部在 web/src 内；`2abe757..HEAD` 对 server/、notes/、markdown.ts、tts.ts、theme.ts、index.html、fonts.css、build-fonts 脚本、两级 package.json **零改动**；三笔提交 notes/ 零卷入；三份交接提示词保持未跟踪未提交。
- [x] **负向清单逐条（grep 实证）**：依赖零增量；组件内 0.15s/0.2s 等 s 字面值归零；`prefers-reduced-motion: reduce` 覆盖分支全站零处；测试残留（M3'-TEST-SLEEP/__m3seen/__m3arm/__rafPatched）归零；notes/ 无临时词条（m3-stagger-* 建删闭环，API 计数复核 19→6）。
- [x] **构建复现**：HEAD 重新 `npm run build`，产物 hash（index-CFIIn9rp.css / index-CDqo7dCE.js）与实施验证逐字节一致——提交态即验证态。
- [x] **模块 A 页面转场（代码+实测）**：CSSOM 确认 `.page-enter-active/.page-leave-active` 用 `var(--duration-page) var(--ease-out)`、enter-from/leave-to 各 ±4px 位移、全部位于 no-preference 块；垫片驱动的类演化采样完整走通 out-in 全时序（leave-from→leave-to→卸载/挂载 swap→enter-from→enter-to→类全清），终态 `board-page` 单根、零残留；query 变化不触发转场（key=route.path 语义）复核无误。
- [x] **模块 B 骨架屏（重新注入实测后移除）**：Board 6 行（行容器复用 .note-row 规格：surface 底/12px 16px padding/10px 圆角，内容条 16px=--text-md，搜索框常驻不进骨架）；NoteView 8 条（标题 27.2px=--text-2xl，卡片 48px padding/14px 圆角=.note 规格）；Home 4 卡（chip 40px、auto-fit 网格与真实板块卡同列数）+6 行；三处 shimmer 均为 `skeleton-sweep` 1.4s；深色骨架条 #1f2730（--color-surface-2 深色变体）可读。复检注入（1500ms×3）验证后全部移除，grep 归零。
- [x] **模块 C stagger/按压/令牌化**：结构断言（19 行状态下，7 实例 sizes 1+1+13+1+1+1+1）每实例前 12 项 row-in + 内联 `calc(var(--stagger-step) * i)`，M 组 computed delay 0→264ms 严格 24ms 递增，第 13 项无类无内联，errs=[]；arm 窗口时序（+400ms 武装 animationName=row-in-*、+2s 摘除 none）正确；窗口过期后过滤→还原零重播（19 行 0 动画态）；新导航重播正常（6 实例×index0=6 行动画态）；按压 CSSOM 10 组 `:active` 规则全部守卫内（含定位 chip 组合 transform）；存量映射后 s 字面值全站归零。
- [x] **模块 D reduced-motion**：双源（dev + preview 生产构建）CSSOM 递归扫描，凡含 animation 的规则、row-in/skeleton-sweep keyframes、`:active`+transform 规则全部位于 no-preference 块内、**violations=[]**；theme-transitioning 既有守卫未破坏。
- [x] **preview 复核**：4173 生产构建 CSSOM/结构/窗口时序/终态与 dev 一致；复核后进程精确 taskkill //PID //F 关停（无 //T），端口释放；两源 localStorage 仅 5173 存 `en_tool:theme=system`（默认态）、4173 零残留。
- [x] **文档准确性**：记录中产物哈希、10 组按压规则、17 文件 feat 等数字与实测一一对应；§12 标注与 AGENTS「动效实现铁律」「浏览器验证工具（遮挡节流）」回写内容复核无误。
- [x] **发现并修复：NoteView `.hint` 死选择器**（M3' 将加载提示替换为骨架时自留——`.hint, .error` 合并选择器中 `.hint` 已无模板引用；Home 同场景已清理，本处遗漏）→ 移除该选择器，`e9cc588` 单独 fix 提交；修复后 `npm run build` 通过（新产物 index-TmimObfk.css / index-DtATiXad.js）。
- [备注] Board/Tags/TagDetail/Settings/EditView 的 `class="hint"`「加载中…」为 M3' 范围外既有实现（任务明确 EditView 等不在范围），其选择器属正常存活，非死代码；NoteView computed opacity 在遮挡节流下读 0 属已知 IAB computed 残影 quirk（同 [[已知 IAB quirk]]），以类生命周期为断言依据。

## 已知限制

1. **动效逐帧/录屏证据缺失（IAB 遮挡节流）**：rAF 停发 + 定时器 10 倍节流使中间帧不可观测、录屏只有静止帧；转场/stagger 的过程正确性以「垫片驱动编排走通 + CSSOM 规则 + 类生命周期断言」承载，真实浏览器中的 160ms 淡入与 24ms 波浪未逐帧目验（机制为标准 Vue Transition/CSS animation，参数全部来自定稿令牌）。
2. **初始加载 enter 转场保留**：vue-router 异步解析使首次加载/刷新也有 160ms 淡入（偏离 #9）；真实浏览器正常，遮挡节流环境下会冻结到首帧后才完成（环境病范畴，见验证项 2 环境说明）。
3. **stagger-arm 窗口期（数据就绪后 ~928ms）内的过滤重建仍会播波浪**：窗口期即入场波浪播放期，此时列表重建重播在语义上属入场序列的一部分；窗口过期后（常态操作时点）零重播。窗口时长由令牌推导，无魔法数。
4. **AZIndex 页的 stagger 为分组独立波浪**：词汇页按字母分组渲染 7 个 NoteList 实例，各组独立以自己 index 0 起波（非整页统一编号）；标签详情页多分组同理。属组件级实现的自然语义，记录备用。
5. **骨架屏高度为近似对齐**：内容条高度走 `--text-*`、容器规格复用真实组件，但真实正文长度不可预知——加载完成后首屏以下内容高度有变化（实测 Home 989→1311、NoteView 720→991、Board 720→约 1100+）；首屏内（标题/搜索框/卡片段）无位移。
6. **录屏 transition.webm 未交付**（偏离 #12）。
7. **按压反馈无实按帧证据**（验证项 6 △）：CSSOM 规则 + 清单走查为准；`prefers-reduced-motion` 实机翻转同样受 browser-use 限制（与 M1' system 态联动验证同款降级口径）。

## 交付物清单

- 代码提交：`feat(ui): M3' 微动效——页面转场/骨架屏/列表 stagger/按压反馈/存量动效令牌化`（`36da2da`，17 文件：15 改 + Skeleton.vue/stagger.ts 新建；notes/ 零卷入）
- 前置提交：`docs: M2' 独立审查补记与进度标注回写（上会话遗留未提交）`（`f445919`，清工作区历史，不属 M3' 内容）
- 本记录 + `UI优化设计方案.md` §12 标注 + AGENTS.md M3' 回写 + `UI-M3截图/`（9 张）：`docs:` 提交
- 截图：skeleton-board-light / skeleton-board-dark / skeleton-note-dark / skeleton-home-dark / skeleton-home-light / home-after-transition-light / home-after-transition-dark / note-after-transition-light / note-after-transition-dark / mobile-home-dark（10 张，骨架屏浅/深、转场后首页与阅读页终态浅/深、移动端首页深色全部覆盖；transition.webm 未交付见偏离 #12）
