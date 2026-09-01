<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import NoteList from '../components/NoteList.vue'
import AZIndex from '../components/AZIndex.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import { api, type Board, type NoteDetail, type NoteMeta } from '../api'
import { getSearchIndex, searchBoard } from '../lib/search'
import { useStaggerArm } from '../lib/stagger'

const props = defineProps<{ board: Board }>()

const route = useRoute()
const router = useRouter()

const boardLabels: Record<Board, string> = {
  vocab: '词汇 · Vocab',
  phrase: '短语 · Phrase',
  sentence: '长难句 · Sentence',
  grammar: '语法 · Grammar',
}

const notes = ref<NoteMeta[]>([])
const loading = ref(true)
const error = ref('')

// 入场 stagger 窗口（§6）：数据就绪后短暂挂 stagger-arm 祖先类，波浪后摘除
const staggerArm = useStaggerArm(loading)

const query = ref('')
const fulltext = ref(false)
const indexData = ref<NoteDetail[] | null>(null)
const indexError = ref('')

// ---------- 筛选 / 排序 / 密度（M5'，§10）：route.query 为筛选态唯一事实来源 ----------

type SortMode = 'alpha' | 'updated'
type Density = 'cozy' | 'compact'

const activeTags = ref<string[]>([])
const sort = ref<SortMode | ''>('')
const density = ref<Density>('cozy')

try {
  if (localStorage.getItem('en_tool:density') === 'compact') density.value = 'compact'
} catch {
  /* 存储不可用（隐私模式等）时用默认舒适档 */
}

function setDensity(d: Density): void {
  density.value = d
  try {
    localStorage.setItem('en_tool:density', d)
  } catch {
    /* 同上 */
  }
}

/** 当前板块标签聚合（tag→count，count 降序、同数按标签升序）。
 * 口径 = 仅词条携带的标签（笔记 frontmatter 聚合），不含注册表中 count=0 的标签——
 * 板块页筛的是「词条拥有的标签」（v1.1 设计 §3），勿接入 tagRegistryRef */
const boardTags = computed(() => {
  const counts = new Map<string, number>()
  for (const n of notes.value) {
    for (const tag of n.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
})

/** 生效排序：无显式参数时 = 既有服务端规则（vocab 字母序，其余 updated 倒序） */
const effectiveSort = computed<SortMode>(() =>
  sort.value || (props.board === 'vocab' ? 'alpha' : 'updated'),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    notes.value = await api.notes(props.board)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 全文模式需要正文，从 search-index（缓存的 Promise）取本板块数据 */
async function loadIndex() {
  if (indexData.value || indexError.value) return
  try {
    indexData.value = await getSearchIndex()
  } catch (e) {
    indexError.value = `全文索引加载失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 过滤管线：搜索（既有 searchBoard）→ 标签 OR → 排序（对齐服务端 scanner 规则） */
const filtered = computed<NoteMeta[]>(() => {
  let list = notes.value
  const q = query.value.trim()
  if (q) {
    list = searchBoard(list, q, indexData.value?.filter((n) => n.board === props.board) ?? null, {
      fulltext: fulltext.value,
    })
  }
  if (activeTags.value.length) {
    list = list.filter((n) => n.tags.some((t) => activeTags.value.includes(t)))
  }
  if (sort.value === 'alpha') {
    list = [...list].sort((a, b) => a.title.localeCompare(b.title))
  } else if (sort.value === 'updated') {
    list = [...list].sort((a, b) => b.updated.localeCompare(a.updated))
  }
  return list
})

const hasFilter = computed(() => query.value.trim() !== '' || activeTags.value.length > 0)

const emptyTitle = computed(() => {
  const q = query.value.trim()
  if (q && activeTags.value.length) return `没有匹配「${q}」与所选标签的词条`
  if (q) return `没有匹配「${q}」的词条`
  return '没有符合所选标签的词条'
})

function syncFromRoute() {
  const q = route.query.q
  const ft = route.query.fulltext
  const t = route.query.tags
  const s = route.query.sort
  query.value = typeof q === 'string' ? q : ''
  fulltext.value = ft === '1' || ft === 'true'
  activeTags.value = typeof t === 'string' && t ? t.split(',').filter(Boolean) : []
  sort.value = s === 'alpha' || s === 'updated' ? s : ''
  if (fulltext.value) void loadIndex()
}

/**
 * 筛选态写回 URL：tags/sort 变更走 push（浏览器 back 可逐态回溯）。
 * 搜索词取内存值（输入框本身不写 URL 的既有行为不变；但已输入的 q 会随本次
 * 筛选操作一并入 URL，保证 AND 组合与分享语义完整）。tags 空 / sort 回默认时删键。
 */
function pushRouteQuery(tags: string[], sortValue: SortMode | ''): void {
  const next: Record<string, string> = {}
  const q = query.value.trim()
  if (q) next.q = q
  if (fulltext.value) next.fulltext = '1'
  if (tags.length) next.tags = tags.join(',')
  if (sortValue) next.sort = sortValue
  void router.push({ query: next })
}

function toggleTag(tag: string): void {
  const tags = activeTags.value.includes(tag)
    ? activeTags.value.filter((t) => t !== tag)
    : [...activeTags.value, tag]
  pushRouteQuery(tags, sort.value)
}

/** 点击当前生效序 = 清显式参数回默认（观感不变、URL 收敛）；点另一序 = 写显式参数 */
function setSort(mode: SortMode): void {
  pushRouteQuery(activeTags.value, mode === effectiveSort.value ? '' : mode)
}

function clearAllFilters(): void {
  const next: Record<string, string> = {}
  if (fulltext.value) next.fulltext = '1'
  void router.push({ query: next })
}

function toggleFulltext() {
  fulltext.value = !fulltext.value
  if (fulltext.value) void loadIndex()
}

onMounted(() => {
  void load()
  syncFromRoute()
})
watch(() => props.board, load)
watch(() => route.query, syncFromRoute)
</script>

<template>
  <div
    class="board-page"
    :class="{ 'stagger-arm': staggerArm, 'density-compact': density === 'compact' }"
  >
    <header class="board-header">
      <h1 class="board-title">{{ boardLabels[board] }}</h1>
      <div class="board-header-right">
        <p class="board-meta">{{ filtered.length }} / {{ notes.length }} 条词条</p>
        <RouterLink :to="`/new?board=${board}`" class="new-link">＋ 新建</RouterLink>
      </div>
    </header>

    <div class="board-search">
      <svg class="board-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      <input
        v-model="query"
        class="board-search-input"
        type="text"
        placeholder="在本板块内过滤（标题 / 标签 / 音标 / 来源）"
        aria-label="板块内搜索"
      />
      <button
        type="button"
        class="chip"
        :class="{ active: fulltext }"
        :aria-pressed="fulltext"
        @click="toggleFulltext"
      >
        全文
      </button>
    </div>
    <p v-if="indexError" class="error">{{ indexError }}</p>
    <p v-else-if="fulltext && !indexData && query.trim()" class="hint">全文索引加载中…</p>

    <!-- 筛选行（M5'）：标签 chips（OR 多选，与搜索 AND）+ 右侧排序/密度段控件 -->
    <div class="board-filters">
      <div v-if="boardTags.length" class="tag-chips" role="group" aria-label="按标签筛选">
        <button
          v-for="t in boardTags"
          :key="t.tag"
          type="button"
          class="fchip"
          :class="{ active: activeTags.includes(t.tag) }"
          :aria-pressed="activeTags.includes(t.tag)"
          @click="toggleTag(t.tag)"
        >
          # {{ t.tag }}<span class="fchip-count">{{ t.count }}</span>
        </button>
      </div>
      <div class="list-controls">
        <div class="seg" role="group" aria-label="排序方式">
          <button
            type="button"
            class="fchip"
            :class="{ active: effectiveSort === 'alpha' }"
            :aria-pressed="effectiveSort === 'alpha'"
            @click="setSort('alpha')"
          >
            字母序
          </button>
          <button
            type="button"
            class="fchip"
            :class="{ active: effectiveSort === 'updated' }"
            :aria-pressed="effectiveSort === 'updated'"
            @click="setSort('updated')"
          >
            最近更新
          </button>
        </div>
        <div class="seg" role="group" aria-label="列表密度">
          <button
            type="button"
            class="fchip"
            :class="{ active: density === 'compact' }"
            :aria-pressed="density === 'compact'"
            @click="setDensity('compact')"
          >
            紧凑
          </button>
          <button
            type="button"
            class="fchip"
            :class="{ active: density === 'cozy' }"
            :aria-pressed="density === 'cozy'"
            @click="setDensity('cozy')"
          >
            舒适
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <div v-else-if="loading" class="board-skeleton" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="skeleton-row">
        <Skeleton class="sk-row-title" />
        <Skeleton class="sk-row-side" />
      </div>
    </div>
    <EmptyState
      v-else-if="hasFilter && filtered.length === 0"
      :title="emptyTitle"
      description="换个条件试试，或清除全部筛选查看全部词条。"
    >
      <button type="button" class="empty-clear" @click="clearAllFilters">清除全部筛选</button>
    </EmptyState>
    <AZIndex v-else-if="board === 'vocab' && sort !== 'updated'" :notes="filtered" />
    <!-- 词汇板显式选「最近更新」时切扁平列表：字母分组会重排updated 序使其不可见
         （M5' 显隐决策，AZIndex 组件零改动） -->
    <NoteList v-else :notes="filtered" />
  </div>
</template>

<style scoped>
.board-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.board-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.board-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.board-meta {
  color: var(--color-text-secondary);
  font-size: var(--text-base);
}

.board-header-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* 次级按钮（描边），带当前板块跳新建页（设计 3.2 板块页「新建」入口） */
.new-link {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.new-link:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.board-search {
  position: relative;
  margin-bottom: var(--space-4);
}

.board-search-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.board-search-input {
  width: 100%;
  padding: 10px 44px 10px 38px;
  font-size: var(--text-base);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.board-search-input::placeholder {
  color: var(--color-text-secondary);
}

.board-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.chip {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 10px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-bg);
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

/* 筛选行（M5' §10）：标签 chips OR 多选 + 右侧排序/密度段控件；fchip 与既有
   .chip（搜索框内 absolute 全文切换）命名区分，视觉同族 */
.board-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-6);
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.list-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.fchip {
  padding: 4px 13px;
  font-size: var(--text-sm);
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

.fchip:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* 排序/密度分段控件：灰底轨道 + 活动段白底浮起（视图控制语言，与标签筛选项区分） */
.seg {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
}

.seg .fchip {
  padding: 4px 14px;
  background: transparent;
  border-color: transparent;
}

.seg .fchip:hover {
  color: var(--color-text);
  border-color: transparent;
  background: transparent;
}

.seg .fchip.active {
  color: var(--color-accent);
  background: var(--color-surface);
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.fchip.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.fchip-count {
  margin-left: var(--space-1);
  font-variant-numeric: tabular-nums;
}

/* 密度-紧凑（M5'）：仅覆盖行 padding 两档，NoteList 组件零改动（:deep 穿透；
   AZIndex 分组内的列表同受根类作用） */
.density-compact :deep(.note-row) {
  padding: var(--space-2) var(--space-3);
}

.hint,
.error {
  color: var(--color-text-secondary);
}

/* 空态 CTA：清除搜索还原列表（语义与描述互补，见实施记录） */
.empty-clear {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.empty-clear:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.error {
  color: var(--color-danger);
}

/* 加载骨架（§6）：行容器复用 .note-row 的规格（surface 底/border/radius/padding），
   内容条高度走 --text-* 贴合真实文本，减少加载完成时的布局跳动 */
.board-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skeleton-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sk-row-title {
  height: var(--text-md);
  width: 42%;
}

.sk-row-side {
  height: var(--text-xs);
  width: 24%;
}

/* 按压反馈（§6）：全部新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .new-link:active,
  .empty-clear:active,
  .fchip:active {
    transform: scale(0.98);
  }

  /* chip 以 translateY(-50%) 垂直居中，:active 需组合保留否则按住时会跳位 */
  .chip:active {
    transform: translateY(-50%) scale(0.98);
  }
}

@media (max-width: 767px) {
  .board-header {
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .board-search {
    margin-bottom: var(--space-4);
  }

  .board-search-input {
    padding: 9px 42px 9px 34px;
  }
}
</style>
