<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import TagBadge from '../components/TagBadge.vue'
import MarkdownViewer, { type TocItem } from '../components/MarkdownViewer.vue'
import Skeleton from '../components/Skeleton.vue'
import { api, type Board, type NoteDetailRaw, type NoteMeta } from '../api'
import { getBacklinks, stripCodeText, type Backlink } from '../lib/backlinks'
import { isLegalWikiText, parseWikiTarget, setLinkIndex, WIKI_LINK_RE } from '../lib/markdown'
import { BOARD_LABELS, getSearchIndex, invalidateSearchIndex } from '../lib/search'
import { isTtsSupported, speak } from '../lib/tts'

/** 面包屑用板块全称（与板块页标题一致）；反链徽章等窄位仍用 BOARD_LABELS 短名 */
const BOARD_PAGE_LABELS: Record<Board, string> = {
  vocab: '词汇 · Vocab',
  phrase: '短语 · Phrase',
  sentence: '长难句 · Sentence',
  grammar: '语法 · Grammar',
}

const route = useRoute()
const router = useRouter()
const note = ref<NoteDetailRaw | null>(null)
const error = ref('')
const loading = ref(true)
const backlinks = ref<Backlink[]>([])

// ---------- 词条朗读（M6）：不支持 TTS 的浏览器静默隐藏喇叭 ----------
const ttsSupported = isTtsSupported()

function speakTitle() {
  if (note.value) speak(note.value.title)
}

// ---------- 选中朗读浮动工具条（M6，仅阅读页；编辑页预览不挂） ----------

const barVisible = ref(false)
const barX = ref(0)
const barY = ref(0)
const barEl = ref<HTMLElement | null>(null)

/** 选区有效性：非空、起点与终点都落在 .note 内（标题/正文/反向引用面板皆在其中）、文本非纯空白。
 * 起止都校验：从正文拖到侧边栏这类跨容器选区不应触发工具条、不应把词条外文本读出来 */
function selectionInNote(): { rect: DOMRect } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  if (!sel.toString().trim()) return null
  const at = (node: Node | null): boolean => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null)
    return !!el && !!el.closest('.note')
  }
  if (!at(sel.anchorNode) || !at(sel.focusNode)) return null
  return { rect: sel.getRangeAt(0).getBoundingClientRect() }
}

/** 用选区矩形定位工具条：默认在选区上方居中，顶部放不下翻转到下方，水平 clamp 视口 */
function placeBar(rect: DOMRect): void {
  const bar = barEl.value
  const w = bar?.offsetWidth ?? 76
  const h = bar?.offsetHeight ?? 38
  const m = 8
  let x = rect.left + rect.width / 2 - w / 2
  x = Math.min(Math.max(x, m), window.innerWidth - w - m)
  let y = rect.top - h - m
  if (y < m) y = rect.bottom + m
  // 选区滚出视口上缘时翻转分支的 y 可为负，钳在顶边距内避免工具条半截出画
  y = Math.max(m, Math.min(y, window.innerHeight - h - m))
  barX.value = x
  barY.value = y
}

function showBar(rect: DOMRect): void {
  if (!barVisible.value) {
    // 首次显示先移到屏外，渲染后实测尺寸再定位（nextTick 在绘制前执行，不闪烁）
    barVisible.value = true
    barX.value = -9999
    barY.value = -9999
    void nextTick(() => placeBar(rect))
  } else {
    placeBar(rect)
  }
}

function onSelectionChange(): void {
  if (!ttsSupported) return
  const hit = selectionInNote()
  if (hit) showBar(hit.rect)
  else barVisible.value = false
}

function onScroll(): void {
  if (!barVisible.value) return
  const hit = selectionInNote()
  if (hit) placeBar(hit.rect)
  else barVisible.value = false
}

function onPointerDown(e: PointerEvent): void {
  // 点在工具条上不隐藏（否则按钮在 click 前被移除）；点别处立即隐藏
  if (barEl.value && e.target instanceof Node && barEl.value.contains(e.target)) return
  barVisible.value = false
}

/** 「朗读」按钮按下时预存选中文本：个别移动端浏览器不完全遵守 pointerdown 的
 * preventDefault，选区在 click 前被折叠时靠它兜底 */
let barSelText = ''

function onBarPointerDown(): void {
  barSelText = window.getSelection()?.toString() ?? ''
}

function onSpeakSelection(): void {
  const live = window.getSelection()?.toString() ?? ''
  const text = live.trim() ? live : barSelText
  if (text.trim()) speak(text)
  barVisible.value = false
}

onMounted(() => {
  if (!ttsSupported) return
  document.addEventListener('selectionchange', onSelectionChange)
  // scroll 不冒泡，capture 才能一并捕获内部容器的滚动；滚动时跟随选区重定位
  window.addEventListener('scroll', onScroll, true)
  // 窗口缩放不触发 selectionchange/scroll，工具条按新视口重定位
  window.addEventListener('resize', onScroll)
  window.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  if (!ttsSupported) return
  document.removeEventListener('selectionchange', onSelectionChange)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
  window.removeEventListener('pointerdown', onPointerDown)
})

async function load() {
  const board = route.params.board as Board
  const slug = route.params.slug as string
  loading.value = true
  error.value = ''
  backlinks.value = []
  // 切换词条后旧选区可能失效（节点被替换）却不触发 selectionchange，工具条主动隐藏
  barVisible.value = false
  missingLinks.value = []
  brokenBannerDismissed.value = false
  deleteError.value = ''
  confirmingDelete.value = false
  // M4'：目录/进度/上下篇随词条切换重置
  toc.value = []
  activeTocId.value = null
  progress.value = 0
  prevNote.value = null
  nextNote.value = null
  try {
    // 上下篇列表与词条并行拉取（服务端已按板块规则排序，板块页同款语义）
    const [detail] = await Promise.all([
      api.note(board, slug),
      api
        .notes(board)
        .then((list) => {
          // 竞态守卫同反向引用：resolve 时已切走词条则丢弃
          if (route.params.board !== board || route.params.slug !== slug) return
          const idx = list.findIndex((n) => n.slug === slug)
          prevNote.value = idx > 0 ? list[idx - 1] : null
          nextNote.value = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
        })
        .catch(() => {
          /* 列表拉取失败：上下篇整块隐藏，不影响阅读 */
        }),
    ])
    note.value = detail
    // 失效链接扫描在链接索引就绪后进行，不阻塞正文渲染
    void refreshMissingLinks()
    // 反向引用并行加载，不阻塞正文；解析完成时若已切走词条则丢弃结果
    void getBacklinks(board, slug)
      .then((list) => {
        if (route.params.board === board && route.params.slug === slug) {
          backlinks.value = list
        }
      })
      .catch(() => {
        backlinks.value = []
      })
    // 正文渲染完成后同步一次进度与目录高亮（后续随滚动更新）
    void nextTick(updateReadingState)
  } catch (e) {
    note.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params, load)

// ---------- 阅读进度条 + TOC scrollspy（§8，M4'）：rAF 节流共用一个滚动监听 ----------

const progress = ref(0)

const toc = ref<TocItem[]>([])
const activeTocId = ref<string | null>(null)

/** 当前节判定阈值：视口顶部以下 120px 内的最后一个标题（≈越过页首一屏标题行的高度） */
const TOC_ACTIVE_OFFSET = 120

function onToc(items: TocItem[]): void {
  toc.value = items
  void nextTick(updateReadingState)
}

function updateReadingState(): void {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  progress.value = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0
  updateScrollSpy()
}

function updateScrollSpy(): void {
  if (toc.value.length === 0) {
    activeTocId.value = null
    return
  }
  const doc = document.documentElement
  // 触底兜底：末节往往不足以滚过判定阈值，触底直接高亮最后一节
  if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
    activeTocId.value = toc.value[toc.value.length - 1].id
    return
  }
  let current = toc.value[0].id
  for (const item of toc.value) {
    const el = document.getElementById(item.id)
    if (!el) break
    if (el.getBoundingClientRect().top > TOC_ACTIVE_OFFSET) break
    current = item.id
  }
  activeTocId.value = current
}

/** 点击目录：scrollIntoView 平滑滚动（reduced-motion 用瞬时跳转），不做 URL hash 同步 */
function scrollToToc(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

let scrollRaf = 0

function onWinScroll(): void {
  if (scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    updateReadingState()
  })
}

// ---------- 上下篇（§8，M4'）：页脚链接与 J/K 共用同一跳转 ----------

const prevNote = ref<NoteMeta | null>(null)
const nextNote = ref<NoteMeta | null>(null)

function goSibling(delta: 1 | -1): void {
  const target = delta === 1 ? nextNote.value : prevNote.value
  if (!target || !note.value) return
  void router.push(`/v/${note.value.board}/${encodeURIComponent(target.slug)}`)
}

// ---------- 阅读页键盘快捷键（§8，M4'）：E 编辑 / Esc 返回 / J·K 上下篇 ----------

function onPageKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  // 带修饰键的组合（Ctrl+K 面板、Ctrl+S 保存等）一律不劫持
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  // 文本输入焦点时单键属于输入内容
  const t = e.target
  if (
    t instanceof HTMLElement &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  ) {
    return
  }
  // Esc：删除确认态先取消确认；面板打开时其 document capture 段已 stopPropagation，
  // 本监听收不到事件，优先级天然成立
  if (e.key === 'Escape') {
    if (confirmingDelete.value) {
      confirmingDelete.value = false
    } else if (note.value) {
      void router.push(`/${note.value.board}`)
    }
    return
  }
  if (loading.value || !note.value) return
  const k = e.key.toLowerCase()
  if (k === 'e') {
    e.preventDefault()
    void router.push(`/v/${note.value.board}/${encodeURIComponent(note.value.slug)}/edit`)
  } else if (k === 'j') {
    e.preventDefault()
    goSibling(1)
  } else if (k === 'k') {
    e.preventDefault()
    goSibling(-1)
  }
}

onMounted(() => {
  window.addEventListener('scroll', onWinScroll, { passive: true })
  window.addEventListener('keydown', onPageKeydown)
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(scrollRaf)
  window.removeEventListener('scroll', onWinScroll)
  window.removeEventListener('keydown', onPageKeydown)
})

// ---------- 删除词条（M7）：内联两态确认，非模态弹窗 ----------

const confirmingDelete = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const headActionsEl = ref<HTMLElement | null>(null)

/** 点按钮外取消确认态（点在操作区内不取消，允许在两个按钮间移动） */
function onGlobalPointerDown(e: PointerEvent): void {
  if (!confirmingDelete.value) return
  if (headActionsEl.value && e.target instanceof Node && headActionsEl.value.contains(e.target)) return
  confirmingDelete.value = false
}

onMounted(() => document.addEventListener('pointerdown', onGlobalPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onGlobalPointerDown))

/** 清除该词条的编辑草稿（key 与 EditView 一致），删除后残留草稿无意义 */
function clearDraft(board: Board, slug: string): void {
  try {
    localStorage.removeItem(`en_tool:draft:${board}:${slug}`)
  } catch {
    /* 存储不可用（隐私模式等）时静默跳过 */
  }
}

async function doDelete(): Promise<void> {
  if (!note.value || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  const { board, slug } = note.value
  try {
    await api.deleteNote(board, slug)
    // 索引/搜索/标签缓存失效 + 草稿清理；仅当用户仍在本词条页时才回板块页
    // （删除请求在途时点「编辑」跳走的话，不把人从别的页面拽回来）
    invalidateSearchIndex()
    clearDraft(board, slug)
    confirmingDelete.value = false
    // 仅当仍在该词条阅读页才回板块页：编辑路由与阅读页的 params 完全相同，
    // 只比 params 无法区分，须同时校验路由名才是「阅读页」语义
    if (route.name === 'note' && route.params.board === board && route.params.slug === slug) {
      void router.push(`/${board}`)
    }
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleting.value = false
  }
}

// ---------- 失效链接提示条（M7）：扫描正文 [[...]] 中未解析的目标 ----------

interface MissingTarget {
  /** 链接显示文本（原始书写文本，与正文所见一致） */
  display: string
  board: string
  slug: string
  title: string
}

const missingLinks = ref<MissingTarget[]>([])
const brokenBannerDismissed = ref(false)

// 独立正则对象：matchAll 的 clone 会复制原 regex 的 lastIndex，与 inline rule 共用对象会互相污染（M5 教训）
const MISSING_SCAN_RE = new RegExp(WIKI_LINK_RE.source, 'g')

/** 统计正文中失效的 [[...]] 目标：剥离代码文本（与渲染语义一致）+ 去重 + 跳过非法空目标 */
function scanMissingLinks(body: string): MissingTarget[] {
  const seen = new Set<string>()
  const list: MissingTarget[] = []
  for (const m of stripCodeText(body).matchAll(MISSING_SCAN_RE)) {
    const display = m[1].trim()
    // 非法目标（[[x/]]、[[/x]] 等）渲染为字面文本，与 inline rule 同一校验，不计入提示条
    if (!display || !isLegalWikiText(display)) continue
    const target = parseWikiTarget(display)
    if (target.resolved || !target.slug) continue
    const key = `${target.board}/${target.slug}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ display, board: target.board, slug: target.slug, title: target.slug })
  }
  return list
}

/**
 * 等链接索引就绪后扫描（直接复用其缓存；先 setLinkIndex 保证解析用最新存在性数据）。
 * 竞态守卫同反向引用：发起时快照 board/slug，resolve 时已切走词条则丢弃结果，
 * 防止缓存重建窗口期内把旧词条的失效链接写到新词条页面上。
 */
async function refreshMissingLinks(): Promise<void> {
  const board = route.params.board
  const slug = route.params.slug
  try {
    const notes = await getSearchIndex()
    if (route.params.board !== board || route.params.slug !== slug) return
    setLinkIndex(notes)
    if (note.value) missingLinks.value = scanMissingLinks(note.value.body)
  } catch {
    if (route.params.board === board && route.params.slug === slug) {
      missingLinks.value = [] // 索引不可得时不提示，不影响阅读
    }
  }
}
</script>

<template>
  <div class="note-page">
    <!-- 阅读进度条（§8）：fixed 顶部 2px，仅阅读页挂载；宽度由滚动进度驱动，不可滚动时为 0 不显示 -->
    <div v-if="note" class="read-progress" :style="{ width: `${progress}%` }" aria-hidden="true" />

    <div class="note-main">
      <p v-if="error" class="error">
        <strong>词条不存在或加载失败</strong>
        <span>{{ error }}</span>
      </p>
    <div v-else-if="loading" class="note-skeleton" aria-hidden="true">
      <Skeleton class="sk-title" />
      <Skeleton class="sk-ipa" />
      <div class="sk-paras">
        <div v-for="p in 3" :key="p" class="sk-para">
          <Skeleton class="sk-line" />
          <Skeleton class="sk-line sk-line-last" />
        </div>
      </div>
    </div>

    <article v-else-if="note" class="note">
      <RouterLink
        :to="`/${route.params.board}`"
        class="board-crumb"
        :aria-label="`返回${BOARD_LABELS[route.params.board as Board]}板块`"
      >
        ← {{ BOARD_PAGE_LABELS[route.params.board as Board] }}
      </RouterLink>
      <header class="note-header">
        <div class="note-head-main">
          <div class="title-row">
            <h1 class="note-title">{{ note.title }}</h1>
            <button
              v-if="ttsSupported"
              class="speak-btn"
              type="button"
              aria-label="朗读标题"
              title="朗读标题"
              @click="speakTitle"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>
            <p v-if="note.ipa" class="ipa">{{ note.ipa }}</p>
          </div>
          <div class="note-tags">
            <TagBadge v-for="tag in note.tags" :key="tag" :tag="tag" />
          </div>
          <dl class="note-meta">
            <div v-if="note.source"><dt>来源</dt><dd>{{ note.source }}</dd></div>
            <div><dt>创建</dt><dd>{{ note.created }}</dd></div>
            <div><dt>更新</dt><dd>{{ note.updated }}</dd></div>
          </dl>
        </div>
        <div ref="headActionsEl" class="note-head-actions">
          <RouterLink :to="`/v/${note.board}/${note.slug}/edit`" class="edit-link">编辑</RouterLink>
          <!-- 内联两态确认（M7）：点「删除」变「确认删除？」，再点执行，点按钮外取消 -->
          <button
            v-if="confirmingDelete"
            type="button"
            class="delete-btn confirm"
            :disabled="deleting"
            @click="doDelete"
          >
            确认删除？
          </button>
          <button v-else type="button" class="delete-btn" @click="confirmingDelete = true">
            删除
          </button>
        </div>
      </header>

      <p v-if="deleteError" class="delete-error">删除失败：{{ deleteError }}</p>

      <p
        v-if="missingLinks.length > 0 && !brokenBannerDismissed"
        class="missing-banner"
        role="alert"
      >
        本文有 {{ missingLinks.length }} 个失效链接：
        <template v-for="(t, i) in missingLinks" :key="`${t.board}/${t.slug}`">
          <RouterLink
            class="missing-target"
            :to="`/new?board=${encodeURIComponent(t.board)}&slug=${encodeURIComponent(t.slug)}&title=${encodeURIComponent(t.title)}`"
          >{{ t.display }}</RouterLink><span v-if="i < missingLinks.length - 1">、</span>
        </template>
        <button type="button" class="banner-close" aria-label="关闭提示" @click="brokenBannerDismissed = true">×</button>
      </p>

      <MarkdownViewer :body="note.body" @toc="onToc" />

      <section v-if="backlinks.length > 0" class="backlinks" aria-label="反向引用">
        <ul class="backlinks-list">
          <li v-for="b in backlinks" :key="`${b.board}/${b.slug}`">
            <RouterLink :to="`/v/${b.board}/${encodeURIComponent(b.slug)}`" class="backlink-link">
              <span class="backlink-board">{{ BOARD_LABELS[b.board] }}</span>
              <span class="backlink-title">{{ b.title }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <!-- 上下篇（§8）：与板块页同款排序语义；首/尾篇对应侧留空占位保持对称 -->
      <nav v-if="prevNote || nextNote" class="note-pager" aria-label="上下篇">
        <div class="pager-cell">
          <RouterLink
            v-if="prevNote"
            :to="`/v/${note.board}/${encodeURIComponent(prevNote.slug)}`"
            class="pager-link"
          >
            <span class="pager-direction">← 上篇</span>
            <span class="pager-title">{{ prevNote.title }}</span>
          </RouterLink>
        </div>
        <div class="pager-cell pager-cell-right">
          <RouterLink
            v-if="nextNote"
            :to="`/v/${note.board}/${encodeURIComponent(nextNote.slug)}`"
            class="pager-link"
          >
            <span class="pager-direction">下篇 →</span>
            <span class="pager-title">{{ nextNote.title }}</span>
          </RouterLink>
        </div>
      </nav>
      </article>
    </div>

    <!-- TOC 目录（§8）：≥1280px 视口落第 3 列（不占正文文档流），sticky 跟随；无 h2/h3 整块隐藏 -->
    <aside v-if="toc.length > 0" class="toc" aria-label="目录">
      <p class="toc-title">目录</p>
      <ul class="toc-list">
        <li
          v-for="item in toc"
          :key="item.id"
          class="toc-item"
          :class="[item.level === 3 ? 'toc-lv3' : 'toc-lv2', { active: item.id === activeTocId }]"
        >
          <button type="button" class="toc-link" @click="scrollToToc(item.id)">
            {{ item.text }}
          </button>
        </li>
      </ul>
    </aside>

    <!-- 选中朗读浮动工具条：Teleport 到 body 避免 .note 的 overflow/层叠上下文裁剪 -->
    <Teleport to="body">
      <div
        v-if="barVisible"
        ref="barEl"
        class="sel-bar"
        :style="{ left: `${barX}px`, top: `${barY}px` }"
      >
        <!-- pointerdown.prevent：阻止按下时选区被折叠；onBarPointerDown 预存选中文本，
             兜底个别移动端浏览器不完全遵守 preventDefault 的情况 -->
        <button
          type="button"
          class="sel-bar-btn"
          @pointerdown.prevent="onBarPointerDown"
          @click="onSpeakSelection"
        >
          朗读
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.note-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

/* 阅读进度条（§8）：fixed 顶部 2px，仅阅读页挂载；宽度由滚动进度驱动 */
.read-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 2px;
  z-index: var(--z-rail);
  background: var(--color-accent);
  pointer-events: none;
}

/* TOC 目录（§8）：默认隐藏；≥1280px 视口下 .note-page 切三列 grid，目录落第 3 列
   （不占正文文档流）。对称负 margin 伸入 .content 左右 padding 使列宽=边距宽，
   TOC 物理上不可能溢出视口；正文列恒 720px 居中，出现/消失零正文位移零横滚 */
.toc {
  display: none;
}

@media (min-width: 1280px) {
  .note-page {
    max-width: none;
    margin: 0 calc(-1 * var(--space-7));
    display: grid;
    grid-template-columns: 1fr minmax(0, var(--content-max-width)) 1fr;
    align-items: start;
  }

  .note-main {
    grid-column: 2;
    min-width: 0;
  }

  .toc {
    display: block;
    grid-column: 3;
    grid-row: 1;
    position: sticky;
    top: var(--space-6);
    width: min(100%, 240px);
    max-height: calc(100vh - var(--space-7) * 2);
    overflow-y: auto;
    padding-left: var(--space-4);
  }
}

.toc-title {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 1px solid var(--color-border);
}

.toc-item {
  border-left: 2px solid transparent;
  margin-left: -1px; /* 盖住 ul 的 1px 边线，高亮条与边线无缝衔接 */
}

.toc-lv3 .toc-link {
  padding-left: var(--space-5);
}

.toc-link {
  display: block;
  width: 100%;
  padding: var(--space-1) var(--space-2);
  font-family: inherit;
  font-size: var(--text-xs);
  line-height: 1.5;
  text-align: left;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-link:hover {
  color: var(--color-text);
}

/* scrollspy 当前节：accent 字色 + 柔和底 + 左侧高亮条 */
.toc-item.active {
  border-left-color: var(--color-accent);
}

.toc-item.active .toc-link {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* 上下篇页脚（§8）：两列对称网格，隐藏侧留空占位 */
.note-pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.pager-cell {
  min-width: 0;
}

.pager-cell-right {
  text-align: right;
}

.pager-link {
  display: inline-block;
  max-width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.pager-link:hover {
  border-color: var(--color-accent);
}

.pager-direction {
  display: block;
  margin-bottom: 2px;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.pager-title {
  display: block;
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pager-link:hover .pager-title {
  color: var(--color-accent);
}

.error {
  color: var(--color-text-secondary);
}

/* 加载骨架（§6）：容器复用 .note 卡片规格（surface/border/radius-lg/padding/阴影），
   标题/IPA/正文条高度走 --text-*，段距对齐正文 0.9em，减少加载完成时的布局跳动 */
.note-skeleton {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-7);
  box-shadow: var(--shadow-sm);
}

.sk-title {
  height: var(--text-2xl);
  width: 45%;
}

.sk-ipa {
  height: var(--text-lg);
  width: 28%;
  margin-top: var(--space-3);
}

.sk-paras {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 0.9em;
}

.sk-para {
  display: flex;
  flex-direction: column;
  gap: 0.8em;
}

.sk-line {
  height: var(--text-body);
}

.sk-para:nth-child(1) .sk-line-last {
  width: 88%;
}

.sk-para:nth-child(2) .sk-line-last {
  width: 72%;
}

.sk-para:nth-child(3) .sk-line-last {
  width: 55%;
}

/* 按压反馈（§6）：全部新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .speak-btn:active,
  .edit-link:active,
  .delete-btn:active,
  .sel-bar-btn:active,
  .banner-close:active,
  .pager-link:active,
  .toc-link:active {
    transform: scale(0.98);
  }

  /* scrollspy 高亮过渡（§8）：默认静态，显式允许才动 */
  .toc-item {
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .toc-link {
    transition: color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out);
  }
}

.error {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-7) 0;
}

.error strong {
  color: var(--color-text);
}

.note {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-7) var(--space-7) var(--space-7);
  box-shadow: var(--shadow-sm);
}

.note-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

/* 返回板块面包屑（用户拍板方案 A）：卡片顶部独占一行，secondary→hover accent
   对齐编辑页 .back-link 语言；RouterLink 在 header 外避免挤入横向 flex */
.board-crumb {
  display: inline-block;
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out);
}

.board-crumb:hover {
  color: var(--color-accent);
}

.note-head-main {
  min-width: 0;
}

.note-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  margin: 0 0 var(--space-3);
  letter-spacing: -0.01em;
  /* 超长不可断词标题折行而非撑破（父级 .note-head-main 已有 min-width: 0） */
  overflow-wrap: anywhere;
}

.title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}

.speak-btn {
  flex: none;
  display: inline-flex;
  /* 标题右上方、音标之前（用户拍板）：透明底 24px 小喇叭，hover 浮现 soft 底 */
  align-self: flex-start;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.speak-btn:hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* 选中朗读浮动工具条：fixed 定位，z-index 高于移动端底部导航 */
.sel-bar {
  position: fixed;
  z-index: var(--z-float);
  padding: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.sel-bar-btn {
  display: block;
  padding: 6px 18px;
  font-size: var(--text-sm);
  color: var(--color-accent);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}

.sel-bar-btn:hover {
  background: var(--color-accent-soft);
}

.ipa {
  margin: 0;
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: var(--text-lg);
  /* 移入标题行（用户拍板）：行内元信息随标题 baseline 对齐；
     超长不可断 IPA token 折行而非撑破（M1 同款） */
  overflow-wrap: anywhere;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

/* 无标签时空容器隐藏（UX 打磨）：margin 不再空占 16px，标题贴近分隔线；
   有标签时 :empty 自动失配，留白恢复 */
.note-tags:empty {
  display: none;
}

.note-meta {
  display: flex;
  gap: var(--space-6);
  margin: 0;
  padding: var(--space-3) 0 0;
  border-top: 1px solid var(--color-border);
}

.note-meta > div {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.note-meta dt {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.note-meta dd {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.note-head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.edit-link {
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.edit-link:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* 删除按钮：常态与「编辑」同款，hover 变危险色；确认态实底红 */
.delete-btn {
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.6;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.delete-btn:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.delete-btn.confirm {
  color: var(--color-on-accent);
  background: var(--color-danger);
  border-color: var(--color-danger);
}

.delete-btn.confirm:hover {
  color: var(--color-on-accent);
  opacity: 0.9;
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 失效链接提示条（M7）：复用 EditView banner 的危险色变体模式。
   不可断词超长 display（如超长 slug）折行而非撑破（M1 .note-title 同款）；
   overflow-wrap 可继承，.missing-target 内文本直接生效 */
.missing-banner {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  margin: var(--space-5) 0 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}

.missing-target {
  color: var(--color-danger);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.missing-target:hover {
  opacity: 0.8;
}

.banner-close {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
  line-height: 1;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}

.banner-close:hover {
  color: var(--color-text);
}

.delete-error {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

/* 反向引用面板（M5）：无引用时整节隐藏；「反向引用」标题已按用户拍板移除
   （仅留链接，section aria-label 维持无障碍语义），分隔线即区块分界 */
.backlinks {
  margin-top: var(--space-7);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.backlinks-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.backlink-link {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-base);
  color: var(--color-text);
  text-decoration: none;
}

.backlink-link:hover .backlink-title {
  color: var(--color-accent);
}

.backlink-board {
  flex-shrink: 0;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

@media (max-width: 767px) {
  /* 左右收窄至 12px（UX 打磨）：375 视口下正文列 255→~300px；
     上下保持 16px 呼吸。骨架同 padding 贴合真实文本 */
  .note {
    padding: var(--space-4) var(--space-3);
  }

  .note-skeleton {
    padding: var(--space-4) var(--space-3);
  }

  .note-title {
    font-size: var(--text-xl);
  }

  .note-meta {
    flex-wrap: wrap;
    /* 列间 0：间隔全部交给分隔点的对称 margin（原列 gap 24px + 点右 margin 8px
       造成点两侧 3 倍间距差，用户报障） */
    gap: var(--space-2) 0;
  }

  /* 页头纵向堆叠（UX 打磨）：标题区占满全宽——原与编辑/删除同行并排，
     操作组占 131px 挤得标题区仅剩 184px（meta 折两行、标题偏左上局促）；
     操作组下移左对齐（用户拍板，与标题/meta 左缘一线） */
  .note-header {
    flex-direction: column;
    gap: var(--space-2);
  }

  .note-head-actions {
    align-self: flex-start;
  }

  /* 页头精简（UX 打磨方案 A）：meta 统一次级灰、编辑/删除去边框底色降为
     文字链接——标题与正文成为页头主角；删除确认态（实底红）用 :not(.confirm)
     豁免不受弱化影响 */
  /* 分隔点已移除（三轮迭代后定稿，用户报障两次）：移动 323px 宽三项必折行，
     折行时分隔点变行尾/行首悬空装饰，对称 margin 无解；行/列间距 12px +
     dt 灰/dd 白字色已提供视觉分组（桌面 meta 用 space-6 gap 本就无点） */
  .note-meta {
    gap: var(--space-3);
    align-items: baseline;
  }

  .note-meta dd {
    color: var(--color-text-secondary);
  }

  .note-head-actions .edit-link,
  .note-head-actions .delete-btn:not(.confirm) {
    background: transparent;
    border-color: transparent;
    padding: var(--space-1) var(--space-2);
  }

  /* 负 margin 抵消编辑的左 padding：「编辑」文字与上方「创建」文字精确对齐 */
  .note-head-actions .edit-link {
    color: var(--color-accent);
    margin-left: calc(-1 * var(--space-2));
  }

  .note-head-actions .delete-btn:not(.confirm) {
    color: var(--color-text-secondary);
  }

  /* 确认态文字化（UX 打磨，用户拍板）：移动端红字「确认删除？」替代实底红按钮 */
  .note-head-actions .delete-btn.confirm {
    background: transparent;
    border-color: transparent;
    padding: var(--space-1) var(--space-2);
    color: var(--color-danger);
    font-weight: 600;
  }
}
</style>
