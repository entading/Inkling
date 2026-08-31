<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Board } from '../api'
import { render, setLinkIndex } from '../lib/markdown'
import { findNote, getSearchIndex } from '../lib/search'

// interactive=false 用于编辑页预览：链接样式照常渲染（所见即所得），点击不导航；悬停预览照常显示
const props = withDefaults(defineProps<{ body: string; interactive?: boolean }>(), {
  interactive: true,
})

const router = useRouter()

/** 链接索引就绪后 +1，触发 html 重新计算（未就绪时 [[...]] 按存在渲染，就绪后修正为缺失样式） */
const linkVersion = ref(0)

const html = computed(() => {
  void linkVersion.value
  return render(props.body)
})

onMounted(() => {
  // 拉取/刷新链接存在性索引后重渲染（本地应用闪变亚秒级，可接受）
  void getSearchIndex()
    .then((notes) => {
      setLinkIndex(notes)
      linkVersion.value++
    })
    .catch(() => {
      /* 索引拉取失败：保持按存在渲染，不影响阅读 */
    })
  window.addEventListener('scroll', onScrollHidePreview, true)
  // 窗口缩放同 scroll：链接矩形失效，预览卡停在过期坐标（M6 复检 1 的 sel-bar 同款问题）
  window.addEventListener('resize', onScrollHidePreview)
})

// ---------- wiki 链接跳转（click 与 Enter 键盘委托共用） ----------

/** wiki 链接跳转：存在 → 阅读页；缺失 → 新建页（stub 创建预填） */
function navigateWiki(el: Element): void {
  const board = el.getAttribute('data-board') ?? ''
  const slug = el.getAttribute('data-slug') ?? ''
  if (!el.classList.contains('is-missing')) {
    void router.push(`/v/${encodeURIComponent(board)}/${encodeURIComponent(slug)}`)
    return
  }
  const title = el.getAttribute('data-title') ?? ''
  void router.push(
    `/new?board=${encodeURIComponent(board)}&slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}`,
  )
}

/** 事件委托：wiki 链接 SPA 跳转。普通 md 链接不受影响 */
function onBodyClick(e: MouseEvent): void {
  if (!props.interactive) return
  const el = (e.target as HTMLElement | null)?.closest('a.wiki-link')
  if (!el) return
  e.preventDefault()
  navigateWiki(el)
}

/** 键盘可达（M7）：wiki 链接无 href 但有 tabindex/role，Enter 触发与点击同款跳转 */
function onBodyKeydown(e: KeyboardEvent): void {
  if (!props.interactive) return
  if (e.key !== 'Enter') return
  const el = (e.target as HTMLElement | null)?.closest('a.wiki-link')
  if (!el) return
  e.preventDefault()
  navigateWiki(el)
}

// ---------- wiki 链接悬停预览（M7）：防抖 300ms 显示目标词条卡片 ----------

interface PreviewData {
  title: string
  ipa?: string
  tags: string[]
  source?: string
  excerpt: string
}

const previewVisible = ref(false)
const previewX = ref(0)
const previewY = ref(0)
const previewEl = ref<HTMLElement | null>(null)
const preview = ref<PreviewData | null>(null)

let hoverTimer: number | undefined
/** hover 代数：每次 mouseover/隐藏递增，findNote 是异步的，resolve 时代数已变说明鼠标早已移出，丢弃 */
let hoverSeq = 0

/** 摘要：正文第一个非空、非标题（# 开头）的行，粗剥行内标记后截约 120 字符 */
function excerptOf(body: string): string {
  const line = body.split(/\r?\n/).find((l) => {
    const t = l.trim()
    return t && !t.startsWith('#')
  })
  if (!line) return ''
  const text = line
    .replace(/\[\[([^\[\]\r\n]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`_>~]/g, '')
    .trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/** 用链接矩形定位预览卡：默认在链接下方居中，底部放不下翻转到上方，水平/垂直 clamp 视口（同 NoteView sel-bar 模式） */
function placePreview(rect: DOMRect): void {
  const card = previewEl.value
  const w = card?.offsetWidth ?? 260
  const h = card?.offsetHeight ?? 120
  const m = 8
  let x = rect.left + rect.width / 2 - w / 2
  x = Math.min(Math.max(x, m), window.innerWidth - w - m)
  let y = rect.bottom + m
  if (y + h > window.innerHeight - m) y = rect.top - h - m
  y = Math.max(m, Math.min(y, window.innerHeight - h - m))
  previewX.value = x
  previewY.value = y
}

function showPreview(rect: DOMRect): void {
  if (!previewVisible.value) {
    // 首次显示先移到屏外，渲染后实测尺寸再定位（nextTick 在绘制前执行，不闪烁）
    previewVisible.value = true
    previewX.value = -9999
    previewY.value = -9999
  }
  void nextTick(() => placePreview(rect))
}

// ---------- 预览卡「走廊」判定（M7 测试 E-04）：慢速移向卡片时卡片不被间隙 mouseout 提前隐藏 ----------

let hideTimer: number | undefined
let corridorListener: ((e: PointerEvent) => void) | null = null

/** 指针是否落在预览卡四周走廊内（扩 24px，覆盖链接与卡片间 8px 间隙及翻转偏移） */
function nearCardZone(x: number, y: number): boolean {
  const el = previewEl.value
  if (!el) return false
  const r = el.getBoundingClientRect()
  const pad = 24
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
}

/** 延迟隐藏：指针在走廊内（如链接与卡片的间隙上）暂不隐藏，留出移入卡片的时间；
 * 指针离开走廊而不在卡片上则立即隐藏，另有 500ms 兜底定时器防 pointermove 未触达 */
function deferHide(): void {
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(hidePreview, 500)
  if (corridorListener) return
  corridorListener = (e: PointerEvent) => {
    if (!previewVisible.value) return
    if (nearCardZone(e.clientX, e.clientY)) return
    if (e.target instanceof Node && previewEl.value?.contains(e.target)) return
    hidePreview()
  }
  window.addEventListener('pointermove', corridorListener)
}

/** 取消延迟隐藏：进入卡片时调用（卡片保持显示），也由 hidePreview 统一清理 */
function clearCorridor(): void {
  window.clearTimeout(hideTimer)
  hideTimer = undefined
  if (corridorListener) {
    window.removeEventListener('pointermove', corridorListener)
    corridorListener = null
  }
}

function hidePreview(): void {
  hoverSeq++
  window.clearTimeout(hoverTimer)
  hoverTimer = undefined
  clearCorridor()
  previewVisible.value = false
  preview.value = null
}

function onMouseOver(e: MouseEvent): void {
  const el = (e.target as HTMLElement | null)?.closest('a.wiki-link')
  // 缺失目标无预览内容（尚未创建），点击走 stub 创建
  if (!el || el.classList.contains('is-missing')) return
  const board = el.getAttribute('data-board') ?? ''
  const slug = el.getAttribute('data-slug') ?? ''
  const rect = el.getBoundingClientRect()
  const seq = ++hoverSeq
  window.clearTimeout(hoverTimer)
  hoverTimer = window.setTimeout(() => {
    void findNote(board as Board, slug).then((note) => {
      if (!note || seq !== hoverSeq) return // 无数据，或等待索引期间鼠标已移出/换目标：不显示
      preview.value = {
        title: note.title,
        ipa: note.ipa,
        tags: note.tags,
        source: note.source,
        excerpt: excerptOf(note.body),
      }
      showPreview(rect)
    })
  }, 300)
}

function onMouseOut(e: MouseEvent): void {
  const from = (e.target as HTMLElement | null)?.closest('a.wiki-link')
  if (!from) return
  const to = e.relatedTarget instanceof Element ? e.relatedTarget : null
  if (to) {
    // 移入预览卡：保持显示（鼠标可移到卡片上阅读）
    if (previewEl.value?.contains(to)) return
    // 链接内部子元素间移动：不算移出
    if (from.contains(to)) return
  }
  // 慢速移向卡片时指针先落在链接与卡片间的间隙上（mouseout 目标非卡片）：
  // 指针在卡片走廊内则延迟隐藏，让指针自然移入卡片；否则立即隐藏
  if (previewEl.value && nearCardZone(e.clientX, e.clientY)) {
    deferHide()
    return
  }
  hidePreview()
}

/** 滚动时链接矩形已失效，预览卡会停在过期位置挡视线：直接隐藏（重建由下次 mouseover 触发） */
function onScrollHidePreview(): void {
  if (previewVisible.value || hoverTimer !== undefined) hidePreview()
}

onBeforeUnmount(() => {
  window.clearTimeout(hoverTimer)
  clearCorridor()
  window.removeEventListener('scroll', onScrollHidePreview, true)
  window.removeEventListener('resize', onScrollHidePreview)
})

// 切换词条（组件复用、body 替换）时旧预览卡主动隐藏，避免悬停在失效位置
watch(() => props.body, hidePreview)
</script>

<template>
  <div
    class="note-body"
    @click="onBodyClick"
    @keydown.enter="onBodyKeydown"
    @mouseover="onMouseOver"
    @mouseout="onMouseOut"
    v-html="html"
  />

  <!-- 悬停预览卡：Teleport 到 body 避免 .note 的 overflow/层叠上下文裁剪（同 NoteView sel-bar） -->
  <Teleport to="body">
    <div
      v-if="previewVisible && preview"
      ref="previewEl"
      class="wiki-preview"
      :style="{ left: `${previewX}px`, top: `${previewY}px` }"
      @mouseenter="clearCorridor"
      @mouseleave="hidePreview"
    >
      <div class="wiki-preview-head">
        <span class="wiki-preview-title">{{ preview.title }}</span>
        <span v-if="preview.ipa" class="wiki-preview-ipa">{{ preview.ipa }}</span>
      </div>
      <div v-if="preview.tags.length > 0" class="wiki-preview-tags">
        <span v-for="tag in preview.tags.slice(0, 2)" :key="tag" class="wiki-preview-tag">{{ tag }}</span>
      </div>
      <div v-if="preview.source" class="wiki-preview-source">来源：{{ preview.source }}</div>
      <p v-if="preview.excerpt" class="wiki-preview-excerpt">{{ preview.excerpt }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
/* 样式迁自 NoteView.vue（M4 抽组件），阅读页与编辑页预览共用 */
/* 正文衬线层（§3）：整体衬线 + 17px + 1.8 行高；UI 层与 .ipa 不在此组件内，不受影响 */
.note-body {
  font-family: var(--font-serif);
  font-size: var(--text-body);
  line-height: 1.8;
  letter-spacing: 0.01em;
  color: var(--color-text);
  /* 中西文混排自动加间距（Chromium 140+ 渐进增强，旧浏览器整行忽略） */
  text-autospace: normal;
  /* 断行兜底：段首孤行/段尾寡行至少 2 行（可继承至 p/li） */
  orphans: 2;
  widows: 2;
  /* 不可断词长内容防溢出；不影响 CJK 排版 */
  overflow-wrap: anywhere;
}

/* 标题沿用现有字距（§3：letter-spacing 只调正文，不进标题），serif 字形下标题断行取平衡 */
.note-body :deep(h1) {
  font-size: var(--text-xl);
  margin: 1.6em 0 0.6em;
  text-wrap: balance;
  letter-spacing: normal;
}

.note-body :deep(h2) {
  font-size: var(--text-lg);
  margin: 1.5em 0 0.5em;
  text-wrap: balance;
  letter-spacing: normal;
}

/* h3 与正文同字号、靠加粗分层（阶梯内无 1.05 的档位，映射见实施记录） */
.note-body :deep(h3) {
  font-size: var(--text-body);
  text-wrap: balance;
  letter-spacing: normal;
}

.note-body :deep(p) {
  margin: 0.9em 0;
  text-wrap: pretty;
}

.note-body :deep(ul),
.note-body :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.6em;
}

.note-body :deep(li) {
  margin: 0.3em 0;
}

.note-body :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--color-accent);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  /* 引用块多为英文例句，不需要 1.8 的呼吸感（§3） */
  line-height: 1.6;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* 行内代码 / 代码块 / 键盘输入 / 样本输出：保持等宽栈，不被正文衬线污染 */
.note-body :deep(code),
.note-body :deep(kbd),
.note-body :deep(samp) {
  font-family: var(--font-mono);
}

.note-body :deep(code) {
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.9em;
}

.note-body :deep(pre) {
  font-family: var(--font-mono);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  overflow-x: auto;
}

.note-body :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
}

/* 衬线字形下边框下划线会压字形：md/wiki 链接统一迁移到真下划线，可调 offset 与粗细 */
.note-body :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-decoration-color: var(--wiki-underline);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.note-body :deep(a:hover) {
  text-decoration-color: var(--color-accent);
}

/* 双向链接（M5）：无 href，跳转由根节点事件委托处理 */
.note-body :deep(a.wiki-link) {
  color: var(--color-accent);
  text-decoration-style: dashed;
  text-decoration-color: var(--wiki-underline-missing);
  cursor: pointer;
}

.note-body :deep(a.wiki-link:hover) {
  text-decoration-color: var(--color-accent);
}

/* 键盘 Tab 聚焦时叠加底色，长正文里焦点位置更醒目（outline 由全局 focus-visible 提供） */
.note-body :deep(a.wiki-link:focus-visible) {
  background: var(--color-accent-soft);
  text-decoration-style: solid;
}

/* 全部板块未命中：红色虚线，点击跳新建页创建 stub */
.note-body :deep(a.wiki-link.is-missing) {
  color: var(--color-danger);
  border-bottom: 1px dashed var(--color-danger);
}

.note-body :deep(a.wiki-link.is-missing:hover) {
  border-bottom-style: solid;
}

/* 全端块级滚动容器：宽表格在容器内横向滚动，无需页面级横向滚动（移动端规则提升自 M3） */
.note-body :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.95em;
}

.note-body :deep(th),
.note-body :deep(td) {
  border: 1px solid var(--color-border);
  padding: var(--space-2) var(--space-3);
  text-align: left;
}

.note-body :deep(th) {
  background: var(--color-bg);
}

.note-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--space-5) 0;
}

/* 悬停预览卡（M7）：fixed 定位 + Teleport body，宽约 260px 的紧凑卡片 */
.wiki-preview {
  position: fixed;
  z-index: var(--z-float);
  width: 260px;
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.wiki-preview-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.wiki-preview-title {
  font-weight: 600;
  font-size: var(--text-base);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiki-preview-ipa {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.wiki-preview-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.wiki-preview-tag {
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-radius: var(--radius-full);
}

.wiki-preview-source {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.wiki-preview-excerpt {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 767px) {
  .note-body {
    font-size: var(--text-base);
  }
}
</style>
