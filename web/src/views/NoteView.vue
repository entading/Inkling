<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import TagBadge from '../components/TagBadge.vue'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import { api, type Board, type NoteDetailRaw } from '../api'
import { getBacklinks, stripCodeText, type Backlink } from '../lib/backlinks'
import { isLegalWikiText, parseWikiTarget, setLinkIndex, WIKI_LINK_RE } from '../lib/markdown'
import { BOARD_LABELS, getSearchIndex, invalidateSearchIndex } from '../lib/search'
import { isTtsSupported, speak } from '../lib/tts'

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
  try {
    note.value = await api.note(board, slug)
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
  } catch (e) {
    note.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params, load)

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
    <p v-if="error" class="error">
      <strong>词条不存在或加载失败</strong>
      <span>{{ error }}</span>
    </p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <article v-else-if="note" class="note">
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
          </div>
          <p v-if="note.ipa" class="ipa">{{ note.ipa }}</p>
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

      <MarkdownViewer :body="note.body" />

      <section v-if="backlinks.length > 0" class="backlinks" aria-label="反向引用">
        <h2 class="backlinks-title">反向引用</h2>
        <ul class="backlinks-list">
          <li v-for="b in backlinks" :key="`${b.board}/${b.slug}`">
            <RouterLink :to="`/v/${b.board}/${encodeURIComponent(b.slug)}`" class="backlink-link">
              <span class="backlink-board">{{ BOARD_LABELS[b.board] }}</span>
              <span class="backlink-title">{{ b.title }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </article>

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

.hint,
.error {
  color: var(--color-text-secondary);
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

.note-head-main {
  min-width: 0;
}

.note-title {
  font-size: 1.7rem;
  font-weight: 700;
  margin: 0 0 var(--space-3);
  letter-spacing: -0.01em;
  /* 超长不可断词标题折行而非撑破（父级 .note-head-main 已有 min-width: 0） */
  overflow-wrap: anywhere;
}

.title-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.speak-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-top: 2px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
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
  font-size: 0.88rem;
  color: var(--color-accent);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.sel-bar-btn:hover {
  background: var(--color-accent-soft);
}

.ipa {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: 1.05rem;
  /* 超长不可断 IPA token 折行而非撑破（M1 .note-title / M5 .missing-banner 同款；
     .ipa 为普通块级，非 flex item，anywhere 单独生效即可） */
  overflow-wrap: anywhere;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
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
  font-size: 0.8rem;
}

.note-meta dd {
  margin: 0;
  font-size: 0.88rem;
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
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.edit-link:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* 删除按钮：常态与「编辑」同款，hover 变危险色；确认态实底红 */
.delete-btn {
  padding: var(--space-1) var(--space-4);
  font-size: 0.88rem;
  line-height: 1.6;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

.delete-btn:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.delete-btn.confirm {
  color: #fff;
  background: var(--color-danger);
  border-color: var(--color-danger);
}

.delete-btn.confirm:hover {
  color: #fff;
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
  font-size: 0.85rem;
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
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.banner-close:hover {
  color: var(--color-text);
}

.delete-error {
  margin: var(--space-3) 0 0;
  font-size: 0.85rem;
  color: var(--color-danger);
}

/* 反向引用面板（M5）：无引用时整节隐藏 */
.backlinks {
  margin-top: var(--space-7);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.backlinks-title {
  margin: 0 0 var(--space-3);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
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
  font-size: 0.92rem;
  color: var(--color-text);
  text-decoration: none;
}

.backlink-link:hover .backlink-title {
  color: var(--color-accent);
}

.backlink-board {
  flex-shrink: 0;
  padding: 0 var(--space-2);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

@media (max-width: 767px) {
  .note {
    padding: 20px;
  }

  .note-title {
    font-size: 1.4rem;
  }

  .note-meta {
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
  }
}
</style>
