<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, useRoute } from 'vue-router'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import { api, type Board, type NoteDetailRaw } from '../api'
import { stripFrontmatter } from '../lib/markdown'

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
  const board = route.params.board as Board
  const slug = route.params.slug as string
  window.clearTimeout(draftTimer)
  window.clearTimeout(previewTimer)
  loading.value = true
  loadError.value = ''
  draftRestored.value = false
  saveState.value = 'idle'
  saveError.value = ''
  try {
    const detail = await api.note(board, slug)
    note.value = detail
    draft.value = detail.raw
    lastSaved.value = detail.raw
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
  const board = route.params.board as Board
  const slug = route.params.slug as string
  saveState.value = 'saving'
  saveError.value = ''
  try {
    await api.saveNote(board, slug, draft.value)
    lastSaved.value = draft.value
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
  return !dirty.value || window.confirm('当前有未保存的修改，确定离开？（草稿最多保留到最近一次自动暂存）')
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
          v-model="draft"
          class="source-input"
          spellcheck="false"
          aria-label="Markdown 源码"
        />
      </div>
      <div class="pane pane-preview" :class="{ active: viewMode === 'preview' }">
        <MarkdownViewer :body="previewSrc" />
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
  font-size: 0.9rem;
  transition: color 0.15s ease;
}

.back-link:hover {
  color: var(--color-accent);
}

.edit-title {
  font-size: 1.05rem;
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
  font-size: 0.85rem;
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
  font-size: 0.9rem;
  font-family: inherit;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.save-btn:hover {
  opacity: 0.88;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 移动端「源码/预览」chip，参考板块页搜索框 chip 样式 */
.edit-toolbar {
  display: none;
}

.view-chips {
  display: flex;
  gap: var(--space-2);
}

.chip {
  padding: 3px 14px;
  font-size: 0.82rem;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
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
  font-size: 0.85rem;
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
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.banner-close:hover {
  color: var(--color-text);
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
  display: flex;
}

.source-input {
  flex: 1;
  width: 100%;
  padding: var(--space-4);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Cascadia Mono', 'Courier New', monospace;
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  resize: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.source-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
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
  font-size: 0.85rem;
  color: var(--color-danger);
}

@media (max-width: 767px) {
  .edit-page {
    height: auto;
    min-height: 60vh;
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
