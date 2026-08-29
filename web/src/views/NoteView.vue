<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import TagBadge from '../components/TagBadge.vue'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import { api, type Board, type NoteDetailRaw } from '../api'
import { getBacklinks, type Backlink } from '../lib/backlinks'
import { BOARD_LABELS } from '../lib/search'
import { isTtsSupported, speak } from '../lib/tts'

const route = useRoute()
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

/** 选区有效性：非空、落在 .note 内（标题/正文/反向引用面板皆在其中）、文本非纯空白 */
function selectionInNote(): { rect: DOMRect } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  if (!sel.toString().trim()) return null
  const node = sel.anchorNode
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  if (!el || !el.closest('.note')) return null
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
  y = Math.min(y, window.innerHeight - h - m)
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

function onSpeakSelection(): void {
  const text = window.getSelection()?.toString() ?? ''
  if (text.trim()) speak(text)
  barVisible.value = false
}

onMounted(() => {
  if (!ttsSupported) return
  document.addEventListener('selectionchange', onSelectionChange)
  // scroll 不冒泡，capture 才能一并捕获内部容器的滚动；滚动时跟随选区重定位
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  if (!ttsSupported) return
  document.removeEventListener('selectionchange', onSelectionChange)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('pointerdown', onPointerDown)
})

async function load() {
  const board = route.params.board as Board
  const slug = route.params.slug as string
  loading.value = true
  error.value = ''
  backlinks.value = []
  try {
    note.value = await api.note(board, slug)
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
        <RouterLink :to="`/v/${note.board}/${note.slug}/edit`" class="edit-link">编辑</RouterLink>
      </header>

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
        <!-- pointerdown.prevent：阻止按下时选区被折叠，保证 click 时仍能读到选中文本 -->
        <button
          type="button"
          class="sel-bar-btn"
          @pointerdown.prevent
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

/* 选中朗读浮动工具条：fixed 定位，z-index 高于移动端底部导航（App.vue 的 40） */
.sel-bar {
  position: fixed;
  z-index: 50;
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

.edit-link {
  flex-shrink: 0;
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

.note-body {
  margin-top: var(--space-6);
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
