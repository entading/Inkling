<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute } from 'vue-router'
import Icon from '../components/Icon.vue'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import { api, type Board, type NoteDetail, type NoteDetailRaw } from '../api'
import { extractFrontmatter, stripFrontmatter } from '../lib/markdown'
import { getSearchIndex, invalidateSearchIndex } from '../lib/search'

const route = useRoute()

const note = ref<NoteDetailRaw | null>(null)
const loading = ref(true)
const loadError = ref('')

/** 编辑器内容 = 整个文件源码（frontmatter 也在其中），保存时全量 PUT */
const draft = ref('')
/** 最近一次成功保存到磁盘的源码，用于判断有无未保存改动 */
const lastSaved = ref('')

/** 草稿恢复提示条 */
const draftRestored = ref(false)

/**
 * frontmatter 丢失软保护：上次保存（或载入）时的 frontmatter 块。
 * 用户可能编辑正文时误删 frontmatter（全量源码编辑语义），丢失时提示并可一键恢复；
 * 不禁止删除——手写文件无 frontmatter 是合法状态，仅保存时二次确认。
 */
const savedFrontmatter = ref<string | null>(null)
const fmLost = computed(
  () => savedFrontmatter.value !== null && extractFrontmatter(draft.value) === null,
)
const fmBannerDismissed = ref(false)

function restoreFrontmatter() {
  if (savedFrontmatter.value && extractFrontmatter(draft.value) === null) {
    // 块自带结尾换行，直接拼接即可
    draft.value = savedFrontmatter.value + draft.value
  }
}

/** 移动端单视图切换（设计 3.3：编辑从简） */
const viewMode = ref<'source' | 'preview'>('source')

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const saveState = ref<SaveState>('idle')
const saveError = ref('')

const dirty = computed(() => draft.value !== lastSaved.value)

/** 实时预览源码（300ms 防抖，渲染前剥离 frontmatter） */
const previewSrc = ref('')

// ---------- localStorage 草稿（key 按 board+slug 维度） ----------

function draftKey(board: Board, slug: string): string {
  return `en_tool:draft:${board}:${slug}`
}

function readDraft(board: Board, slug: string): string | null {
  try {
    return localStorage.getItem(draftKey(board, slug))
  } catch {
    return null
  }
}

function writeDraft(board: Board, slug: string, content: string): void {
  try {
    localStorage.setItem(draftKey(board, slug), content)
  } catch {
    /* 存储不可用（隐私模式等）时静默跳过，不影响编辑 */
  }
}

function clearDraft(board: Board, slug: string): void {
  try {
    localStorage.removeItem(draftKey(board, slug))
  } catch {
    /* 同上 */
  }
}

// ---------- 加载 ----------

async function load() {
  // 仅在编辑页自身路由上加载：离开本页时 route.params 变化也会触发 watch，
  // 此时若继续会发无效请求，且 clearTimeout 会杀掉待写入的 3 秒草稿定时器（丢失草稿）
  if (route.name !== 'note-edit') return
  const board = route.params.board as Board
  const slug = route.params.slug as string
  window.clearTimeout(draftTimer)
  window.clearTimeout(previewTimer)
  loading.value = true
  loadError.value = ''
  draftRestored.value = false
  fmBannerDismissed.value = false
  saveState.value = 'idle'
  saveError.value = ''
  try {
    const detail = await api.note(board, slug)
    note.value = detail
    draft.value = detail.raw
    lastSaved.value = detail.raw
    savedFrontmatter.value = extractFrontmatter(detail.raw)
    previewSrc.value = stripFrontmatter(detail.raw)
    // 检测到草稿 → 恢复源码并提示；与磁盘内容相同则无需打扰
    const saved = readDraft(board, slug)
    if (saved !== null && saved !== detail.raw) {
      draft.value = saved
      previewSrc.value = stripFrontmatter(saved)
      draftRestored.value = true
    }
  } catch (e) {
    note.value = null
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// ---------- 自动暂存草稿（编辑暂停 3 秒）与实时预览（300ms 防抖） ----------

let draftTimer: number | undefined
let previewTimer: number | undefined

watch(draft, (v) => {
  window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    writeDraft(route.params.board as Board, route.params.slug as string, v)
  }, 3000)

  window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    previewSrc.value = stripFrontmatter(v)
  }, 300)
})

// ---------- 保存（Ctrl+S / 顶部按钮，全量 PUT 原始源码） ----------

async function save() {
  if (saveState.value === 'saving') return
  // 无改动零请求（M5'）：Ctrl+S 与保存按钮共用本函数，内容未变时不发 PUT
  if (!dirty.value) return
  // frontmatter 被删除时二次确认（可取消后用提示条「恢复」一键还原）
  if (fmLost.value && !window.confirm('frontmatter（标题 / 标签 / 来源等元信息）已被删除，保存后阅读页标题将回退为文件名、标签与来源将丢失。确定保存吗？')) {
    return
  }
  const board = route.params.board as Board
  const slug = route.params.slug as string
  saveState.value = 'saving'
  saveError.value = ''
  try {
    await api.saveNote(board, slug, draft.value)
    // 写盘成功，使前端搜索/标签缓存失效（/tags、搜索立即可见新内容）
    invalidateSearchIndex()
    lastSaved.value = draft.value
    savedFrontmatter.value = extractFrontmatter(draft.value)
    saveState.value = 'saved'
    // 正式保存成功后清除草稿（刷新不再恢复）
    window.clearTimeout(draftTimer)
    clearDraft(board, slug)
  } catch (e) {
    saveState.value = 'error'
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  }
}

// ---------- 编辑器增强（M5'，§9）：工具条 / Tab 缩进 / [[ 补全 / 预览同步滚动 ----------
// 红线：全部只「往 textarea 插文本」，PUT 全量源码语义与保存路径不变。

const sourceInput = ref<HTMLTextAreaElement | null>(null)
const previewPane = ref<HTMLElement | null>(null)

/**
 * 光标处插文本，优先 document.execCommand('insertText')——textarea 上各主流浏览器
 * 仍支持，且原生触发 input 事件（v-model 同步）并保持单一撤销步。
 * 失败/不可用降级 setRangeText（不发 input，需手动派发；会破坏撤销栈，仅兜底）。
 */
function insertTextAtSelection(el: HTMLTextAreaElement, text: string): void {
  let ok = false
  try {
    ok = document.execCommand('insertText', false, text)
  } catch {
    ok = false
  }
  if (!ok) {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** 包裹类插入：有选区包裹选中文本，无选区插占位符并选中占位文本（便于直接改写） */
function wrapSelection(prefix: string, suffix: string, placeholder: string): void {
  const ta = sourceInput.value
  if (!ta) return
  ta.focus()
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const selected = ta.value.slice(start, end) || placeholder
  ta.setSelectionRange(start, end)
  insertTextAtSelection(ta, prefix + selected + suffix)
  ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
}

/**
 * 行首类插入：prefix 加到选区覆盖行的行首。引用（> ）作用于每一覆盖行；
 * 标题（## ）单行语义，仅作用于选区首行。从最后一行向前插，前面的偏移不失效；
 * 逐行 execCommand 各成一个撤销步（多行引用低频，接受）。
 */
function prefixLines(prefix: string, firstLineOnly = false): void {
  const ta = sourceInput.value
  if (!ta) return
  ta.focus()
  const value = ta.value
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  // 收集选区覆盖行的行首偏移（引用=每一覆盖行；H2 单行语义仅首行）
  const starts: number[] = []
  let pos = lineStart
  while (true) {
    starts.push(pos)
    if (firstLineOnly) break
    const nl = value.indexOf('\n', pos)
    if (nl === -1 || nl >= end) break
    pos = nl + 1
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    ta.setSelectionRange(starts[i], starts[i])
    insertTextAtSelection(ta, prefix)
  }
  // 恢复选区覆盖整段插入后的首行（含前缀），便于连续操作
  const lastNl = value.indexOf('\n', starts[starts.length - 1])
  const selEnd = (lastNl === -1 ? value.length : lastNl) + prefix.length * starts.length
  ta.setSelectionRange(lineStart + prefix.length, selEnd)
}

// ---------- [[ 补全浮层（跨板块候选，只读 getSearchIndex，不新增解析正则） ----------

const HINT_CAP = 8

interface WikiHintState {
  /** `[[` 之后第一个字符的位置（即待替换过滤词的起点） */
  from: number
  /** 过滤词（`[[` 到光标之间的文本） */
  query: string
  /** 触发时的光标位置（textarea 滚动时重定位用） */
  caret: number
}

const hint = ref<WikiHintState | null>(null)
const hintItems = ref<NoteDetail[]>([])
const hintActive = ref(0)
const hintPos = ref({ top: 0, left: 0 })
let hintSeq = 0

const HINT_BOARD_LABELS: Record<Board, string> = {
  vocab: '词汇',
  phrase: '短语',
  sentence: '长难句',
  grammar: '语法',
}

/**
 * mirror div 测量光标像素位置：复制 textarea 的字体/盒样式，取 value 前 index 字符
 * 渲染后末尾 span 的偏移（内容坐标），再减去 textarea 滚动量得可见坐标。
 */
function measureCaret(ta: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const style = getComputedStyle(ta)
  const mirror = document.createElement('div')
  for (const prop of [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'padding', 'border-width', 'border-style', 'box-sizing', 'white-space', 'overflow-wrap',
    'word-break', 'tab-size', 'text-indent',
  ]) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop))
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '-9999px'
  mirror.style.left = '-9999px'
  mirror.style.visibility = 'hidden'
  mirror.style.width = `${ta.offsetWidth}px`
  mirror.textContent = ta.value.slice(0, index)
  const tail = document.createElement('span')
  tail.textContent = ta.value.slice(index) || '\u200b'
  mirror.appendChild(tail)
  ta.parentElement?.appendChild(mirror)
  const top = tail.offsetTop
  const left = tail.offsetLeft
  mirror.remove()
  return { top, left }
}

/** 重定位浮层到光标下方（textarea 滚动/内容变化后调用） */
function positionHint(): void {
  const ta = sourceInput.value
  const pane = ta?.parentElement
  const h = hint.value
  if (!ta || !pane || !h) return
  const { top, left } = measureCaret(ta, h.caret)
  const taRect = ta.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
  hintPos.value = {
    top: taRect.top - paneRect.top + top - ta.scrollTop + lineHeight + 2,
    left: taRect.left - paneRect.left + left - ta.scrollLeft,
  }
}

/** 检测光标前未闭合 `[[`：命中则开/更新浮层，失配（输入 `]]`、换行、移动出去）关闭 */
function detectWikiHint(): void {
  const ta = sourceInput.value
  if (!ta) return
  const caret = ta.selectionStart
  const m = /\[\[([^\[\]\n]*)$/.exec(ta.value.slice(0, caret))
  if (!m) {
    closeWikiHint()
    return
  }
  const query = m[1]
  if (hint.value && hint.value.caret === caret && hint.value.query === query) return
  hint.value = { from: caret - query.length, query, caret }
  positionHint()
  void fillHintItems(query)
}

async function fillHintItems(query: string): Promise<void> {
  const seq = ++hintSeq
  try {
    const index = await getSearchIndex()
    // 等待期间浮层已关/过滤词已变/更新请求已更新 → 丢弃本轮结果
    if (!hint.value || hint.value.query !== query || seq !== hintSeq) return
    const q = query.trim().toLowerCase()
    const scored: { note: NoteDetail; rank: number }[] = []
    for (const note of index) {
      const title = note.title.toLowerCase()
      const slug = note.slug.toLowerCase()
      let rank = -1
      if (!q) rank = 2
      else if (title.startsWith(q) || slug.startsWith(q)) rank = 0
      else if (title.includes(q) || slug.includes(q)) rank = 1
      if (rank >= 0) scored.push({ note, rank })
    }
    scored.sort((a, b) => a.rank - b.rank)
    hintItems.value = scored.slice(0, HINT_CAP).map((s) => s.note)
    hintActive.value = 0
  } catch {
    hintItems.value = []
  }
}

function closeWikiHint(): void {
  hint.value = null
  hintItems.value = []
  hintActive.value = 0
}

/** 插入候选：替换 `[过滤词` 中的过滤词为 `{目标}]]`——vocab 目标裸 slug、非 vocab 带 board/ 前缀 */
function insertWikiHint(item: NoteDetail): void {
  const ta = sourceInput.value
  const h = hint.value
  if (!ta || !h) return
  const target = item.board === 'vocab' ? item.slug : `${item.board}/${item.slug}`
  ta.focus()
  ta.setSelectionRange(h.from, Math.max(ta.selectionStart, h.from))
  insertTextAtSelection(ta, `${target}]]`)
  closeWikiHint()
}

/**
 * textarea 键盘处理：补全开启时 ↑↓/Enter/Tab/Esc 优先（Esc 阻断向上传播，不触发页面级行为）；
 * Tab 补全开启=接受当前候选（编辑器惯例），关闭=插入两空格缩进。
 */
function onSourceKeydown(e: KeyboardEvent): void {
  if (hint.value) {
    const count = hintItems.value.length
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault()
      hintActive.value = (hintActive.value + 1) % count
      return
    }
    if (e.key === 'ArrowUp' && count) {
      e.preventDefault()
      hintActive.value = (hintActive.value - 1 + count) % count
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && count) {
      e.preventDefault()
      e.stopPropagation()
      insertWikiHint(hintItems.value[hintActive.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeWikiHint()
      return
    }
  }
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    const ta = sourceInput.value
    if (ta) insertTextAtSelection(ta, '  ')
  }
}

// ---------- 预览同步滚动（桌面分屏）：textarea 滚动比例单向映射到预览容器 ----------

const isMobileViewport =
  typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
let previewRaf = 0

function syncPreviewScroll(): void {
  if (previewRaf) return
  previewRaf = window.requestAnimationFrame(() => {
    previewRaf = 0
    const ta = sourceInput.value
    const pv = previewPane.value
    if (!ta || !pv) return
    const taMax = ta.scrollHeight - ta.clientHeight
    const pvMax = pv.scrollHeight - pv.clientHeight
    if (taMax <= 0 || pvMax <= 0) return
    pv.scrollTop = (ta.scrollTop / taMax) * pvMax
  })
}

function onSourceScroll(): void {
  // textarea 滚动时浮层跟随光标重定位
  if (hint.value) positionHint()
  if (isMobileViewport?.matches) return
  syncPreviewScroll()
}

// ---------- 拖入 md 文件替换源码 ----------

const dragOver = ref(false)
const dropError = ref('')
let dragDepth = 0

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dragOver.value = true
}

function onDragOver(e: DragEvent) {
  if (hasFiles(e)) e.preventDefault() // 允许 drop
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}

function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.md')) {
    dropError.value = `仅支持 .md 文件，收到「${file.name}」`
    return
  }
  if (draft.value.trim() && !window.confirm('当前内容尚未保存，拖入文件将替换全部源码，确定？')) {
    return
  }
  void file.text().then((text) => {
    draft.value = text
    dropError.value = ''
  })
}

// ---------- 离开保护 ----------

function confirmLeave(): boolean {
  if (!dirty.value) return true
  if (!window.confirm('当前有未保存的修改，确定离开？（未保存内容将暂存为草稿，回到本页可恢复）')) {
    return false
  }
  // 立即同步落草稿：可能编辑后不满 3 秒就离开，pending 定时器会随组件卸载被清除
  window.clearTimeout(draftTimer)
  writeDraft(route.params.board as Board, route.params.slug as string, draft.value)
  return true
}

onBeforeRouteLeave(() => confirmLeave())
onBeforeRouteUpdate(() => confirmLeave())

onMounted(() => {
  void load()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.clearTimeout(draftTimer)
  window.clearTimeout(previewTimer)
  window.cancelAnimationFrame(previewRaf)
  window.removeEventListener('keydown', onKeyDown)
})

watch(() => route.params, load)
</script>

<template>
  <div class="edit-page">
    <header class="edit-header">
      <div class="edit-head-left">
        <RouterLink :to="`/v/${route.params.board}/${route.params.slug}`" class="back-link">
          ← 返回阅读页
        </RouterLink>
        <span class="edit-title">{{ note?.title ?? String(route.params.slug) }}</span>
      </div>
      <div class="edit-head-right">
        <span v-if="saveState === 'saving'" class="save-state">保存中…</span>
        <span v-else-if="saveState === 'saved'" class="save-state ok">已保存 ✓</span>
        <span v-else-if="saveState === 'error'" class="save-state fail">保存失败：{{ saveError }}</span>
        <button
          type="button"
          class="save-btn"
          :disabled="saveState === 'saving'"
          @click="save"
        >
          保存
        </button>
      </div>
    </header>

    <div class="edit-toolbar">
      <!-- 格式工具条（§9）：图标按钮，插入只改 textarea 文本，保存路径不变 -->
      <div class="format-toolbar" role="toolbar" aria-label="Markdown 格式工具条">
        <button
          type="button"
          class="tool-btn"
          title="加粗 **文本**"
          aria-label="加粗"
          @mousedown.prevent
          @click="wrapSelection('**', '**', '文本')"
        >
          <Icon name="bold" :size="16" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="斜体 *文本*"
          aria-label="斜体"
          @mousedown.prevent
          @click="wrapSelection('*', '*', '文本')"
        >
          <Icon name="italic" :size="16" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="行内代码 `文本`"
          aria-label="行内代码"
          @mousedown.prevent
          @click="wrapSelection('`', '`', '代码')"
        >
          <Icon name="code" :size="16" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="引用 > （行首）"
          aria-label="引用"
          @mousedown.prevent
          @click="prefixLines('> ')"
        >
          <Icon name="quote" :size="16" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="二级标题 ## （行首）"
          aria-label="二级标题"
          @mousedown.prevent
          @click="prefixLines('## ', true)"
        >
          <Icon name="h2" :size="16" />
        </button>
        <button
          type="button"
          class="tool-btn"
          title="词条链接 [[词条]]"
          aria-label="插入词条链接"
          @mousedown.prevent
          @click="wrapSelection('[[', ']]', '词条')"
        >
          <Icon name="wiki" :size="16" />
        </button>
      </div>
      <div class="view-chips" role="tablist" aria-label="源码/预览切换">
        <button
          type="button"
          class="chip"
          :class="{ active: viewMode === 'source' }"
          :aria-pressed="viewMode === 'source'"
          @click="viewMode = 'source'"
        >
          源码
        </button>
        <button
          type="button"
          class="chip"
          :class="{ active: viewMode === 'preview' }"
          :aria-pressed="viewMode === 'preview'"
          @click="viewMode = 'preview'"
        >
          预览
        </button>
      </div>
    </div>

    <p v-if="draftRestored" class="draft-banner">
      检测到未保存的草稿，已恢复源码（编辑暂停 3 秒自动暂存，保存成功后清除）。
      <button type="button" class="banner-close" aria-label="关闭提示" @click="draftRestored = false">×</button>
    </p>

    <p v-if="fmLost && !fmBannerDismissed" class="draft-banner warn" role="alert">
      检测到 frontmatter（标题 / 标签 / 来源等元信息）已被删除，保存后阅读页标题将回退为文件名。
      <button type="button" class="banner-action" @click="restoreFrontmatter">恢复</button>
      <button type="button" class="banner-close" aria-label="关闭提示" @click="fmBannerDismissed = true">×</button>
    </p>

    <p v-if="loadError" class="error">
      <strong>词条不存在或加载失败</strong>
      <span>{{ loadError }}</span>
    </p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <div
      v-else
      class="editor-split"
      :class="{ 'drag-over': dragOver }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div class="pane pane-source" :class="{ active: viewMode === 'source' }">
        <textarea
          ref="sourceInput"
          v-model="draft"
          class="source-input"
          spellcheck="false"
          aria-label="Markdown 源码"
          @keydown="onSourceKeydown"
          @input="detectWikiHint"
          @click="detectWikiHint"
          @blur="closeWikiHint"
          @scroll.passive="onSourceScroll"
        />
        <!-- [[ 补全浮层（§9）：absolute 于 .pane-source，z-drop 层；
             候选项 mousedown.prevent 保 textarea 焦点（blur 先关浮层会吞掉 click） -->
        <ul
          v-if="hint && hintItems.length"
          class="wiki-hint"
          role="listbox"
          aria-label="词条链接候选"
          :style="{ top: `${hintPos.top}px`, left: `${hintPos.left}px` }"
        >
          <li
            v-for="(item, i) in hintItems"
            :key="`${item.board}/${item.slug}`"
            role="option"
            :aria-selected="i === hintActive"
            :class="{ active: i === hintActive }"
          >
            <button
              type="button"
              class="wiki-hint-item"
              @mousedown.prevent
              @click="insertWikiHint(item)"
            >
              <span class="wiki-hint-title">{{ item.title }}</span>
              <span class="wiki-hint-badge">{{ HINT_BOARD_LABELS[item.board] }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div ref="previewPane" class="pane pane-preview" :class="{ active: viewMode === 'preview' }">
        <MarkdownViewer :body="previewSrc" :interactive="false" />
      </div>
    </div>

    <p v-if="dropError" class="drop-error">{{ dropError }}</p>
  </div>
</template>

<style scoped>
.edit-page {
  max-width: var(--edit-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px); /* .content 上下 padding 各 32px */
}

.edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-bottom: var(--space-3);
}

.edit-head-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.back-link {
  flex-shrink: 0;
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: var(--text-base);
  transition: color var(--duration-fast) var(--ease-out);
}

.back-link:hover {
  color: var(--color-accent);
}

.edit-title {
  font-size: var(--text-lg);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-head-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.save-state {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.save-state.ok {
  color: var(--color-accent);
}

.save-state.fail {
  color: var(--color-danger);
}

.save-btn {
  padding: var(--space-1) var(--space-5);
  font-size: var(--text-base);
  font-family: inherit;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.save-btn:hover {
  opacity: 0.88;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 编辑工具行：桌面只显示格式工具条；移动端右侧追加源码/预览 chips（既有行为） */
.edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
}

.format-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.tool-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tool-btn:hover {
  color: var(--color-accent);
  background: var(--color-surface-2);
}

.view-chips {
  display: none;
  flex-shrink: 0;
}

/* [[ 补全浮层（§9）：z-drop 层，光标下方 absolute 定位（坐标由 mirror div 测量注入） */
.wiki-hint {
  position: absolute;
  z-index: var(--z-drop);
  min-width: 200px;
  max-width: 300px;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.wiki-hint li.active .wiki-hint-item {
  background: var(--color-accent-soft);
}

.wiki-hint-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-text);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.wiki-hint-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiki-hint-badge {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.chip {
  padding: 3px 14px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.chip:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.chip.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.draft-banner {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
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

/* frontmatter 丢失警示变体 */
.draft-banner.warn {
  background: var(--color-danger-soft);
  border-color: var(--color-danger);
  color: var(--color-text);
}

.banner-action {
  border: none;
  background: none;
  color: var(--color-danger);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  transition: transform var(--duration-fast) var(--ease-out);
}

.banner-action:hover {
  opacity: 0.8;
}

/* 按压反馈（§6）：全部新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .save-btn:active,
  .chip:active,
  .tool-btn:active,
  .banner-close:active,
  .banner-action:active {
    transform: scale(0.98);
  }
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

.editor-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-lg);
}

.editor-split.drag-over {
  outline: 2px dashed var(--color-accent);
  outline-offset: 4px;
}

.pane {
  min-height: 0;
  min-width: 0;
}

.pane-source {
  position: relative; /* 补全浮层的定位上下文 */
  display: flex;
}

.source-input {
  flex: 1;
  width: 100%;
  padding: var(--space-4);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Cascadia Mono', 'Courier New', monospace;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  resize: none;
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.source-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.pane-preview {
  overflow-y: auto;
  padding: var(--space-4) var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.drop-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

@media (max-width: 767px) {
  .edit-page {
    height: auto;
    min-height: 60vh;
  }

  .view-chips {
    display: flex;
    gap: var(--space-2);
  }

  .edit-toolbar {
    display: block;
    padding-bottom: var(--space-3);
  }

  .editor-split {
    grid-template-columns: 1fr;
  }

  /* 移动端单视图：只显示当前模式的 pane，页面自然滚动 */
  .pane {
    display: none;
  }

  .pane.active {
    display: block;
  }

  .pane-source.active {
    display: flex;
  }

  .source-input {
    height: 60vh;
  }

  .pane-preview.active {
    max-height: none;
    overflow: visible;
  }
}
</style>
