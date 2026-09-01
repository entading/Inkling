<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import Fuse from 'fuse.js'
import Icon, { type IconName } from './Icon.vue'
import { api, type Board, type NoteDetail, type NoteMeta } from '../api'
import { BOARD_LABELS, buildFuse, getSearchIndex, runFuse } from '../lib/search'
import { useTheme } from '../lib/theme'

/** 命令面板（§7）：Teleport body 的模态搜索/动作面板。
 * 键盘由 document capture 段独占（面板打开时 stopPropagation 一切 keydown），
 * 阅读页 E/J/K/Esc 与编辑页 Ctrl+S 在面板打开期间收不到事件。 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()

interface PaletteItem {
  /** DOM id 后缀（渲染为 cmd-opt-{id}），须不含空白 */
  id: string
  kind: 'action' | 'note'
  icon?: IconName
  label: string
  ipa?: string
  /** 类型徽标：词条项显示板块名 */
  badge?: string
  /** 右侧补充：词条项显示更新日期 */
  hint?: string
  run: () => void
}

interface PaletteSection {
  label: string
  items: PaletteItem[]
}

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

// ---------- 数据：全量索引（复用缓存）+ 面板内自建扁平 Fuse + 最近更新 ----------

const fuse = shallowRef<Fuse<NoteDetail> | null>(null)
const indexLoading = ref(false)
let lastFuseSource: NoteDetail[] | null = null

/** 索引就绪即建 Fuse（缓存 Promise 复用，不重复拉取）；数组引用变化（写盘失效后）才重建 */
async function ensureFuse(): Promise<void> {
  if (fuse.value || indexLoading.value) return
  indexLoading.value = true
  try {
    const notes = await getSearchIndex()
    if (notes !== lastFuseSource) {
      lastFuseSource = notes
      fuse.value = buildFuse(notes, ['title', 'ipa', 'tags', 'slug'])
    }
  } catch {
    fuse.value = null
  } finally {
    indexLoading.value = false
  }
}

const recent = ref<NoteMeta[]>([])

async function loadRecent(): Promise<void> {
  try {
    recent.value = await api.recent(5)
  } catch {
    recent.value = []
  }
}

// ---------- 词条过滤：debounce 120ms 后跑面板自己的 Fuse ----------

const NOTE_HITS_CAP = 8
const noteHits = ref<NoteDetail[]>([])

let searchTimer: number | undefined

watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(runSearch, 120)
})

function runSearch(): void {
  const q = query.value.trim()
  if (!q || !fuse.value) {
    noteHits.value = []
    return
  }
  noteHits.value = runFuse(fuse.value, q).slice(0, NOTE_HITS_CAP)
}

// ---------- 动作组（主题切换直接复用 theme.ts，勿另起解析） ----------

const theme = useTheme()

function go(path: string): void {
  emit('close')
  void router.push(path)
}

const themeAction = computed<PaletteItem>(() => {
  const dark = theme.resolved.value === 'dark'
  return {
    id: 'act-theme',
    kind: 'action',
    icon: dark ? 'sun' : 'moon',
    label: dark ? '切换浅色主题' : '切换深色主题',
    run: () => {
      emit('close')
      theme.setPreference(dark ? 'light' : 'dark')
    },
  }
})

const actionItems = computed<PaletteItem[]>(() => [
  {
    id: 'act-new',
    kind: 'action',
    icon: 'plus',
    label: '新建词条',
    run: () => go('/new'),
  },
  ...([
    ['vocab', 'book'],
    ['phrase', 'link'],
    ['sentence', 'align-left'],
    ['grammar', 'graduation-cap'],
  ] as ReadonlyArray<[Board, IconName]>).map(([board, icon]) => ({
    id: `act-${board}`,
    kind: 'action' as const,
    icon,
    label: BOARD_LABELS[board],
    run: () => go(`/${board}`),
  })),
  {
    id: 'act-tags',
    kind: 'action',
    icon: 'tag',
    label: '标签',
    run: () => go('/tags'),
  },
  {
    id: 'act-settings',
    kind: 'action',
    icon: 'settings',
    label: '设置',
    run: () => go('/settings'),
  },
  themeAction.value,
])

function noteItemOf(n: Pick<NoteDetail, 'board' | 'slug' | 'title' | 'ipa' | 'updated'>): PaletteItem {
  return {
    id: `note-${n.board}/${n.slug}`,
    kind: 'note',
    label: n.title,
    ipa: n.ipa,
    badge: BOARD_LABELS[n.board],
    hint: n.updated,
    run: () => go(`/v/${encodeURIComponent(n.board)}/${encodeURIComponent(n.slug)}`),
  }
}

const recentItems = computed<PaletteItem[]>(() => recent.value.map(noteItemOf))
const noteHitItems = computed<PaletteItem[]>(() => noteHits.value.map(noteItemOf))

// ---------- 分组渲染：空 query = 动作 + 最近更新；有 query = 词条在前、动作在后 ----------

const filteredActions = computed<PaletteItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return actionItems.value
  // 动作仅 8 项短中文词，用子串过滤比模糊匹配更可预期（偏离记录 #3）
  return actionItems.value.filter((a) => a.label.toLowerCase().includes(q))
})

const sections = computed<PaletteSection[]>(() => {
  const q = query.value.trim()
  if (!q) {
    return [
      { label: '动作', items: actionItems.value },
      ...(recentItems.value.length > 0 ? [{ label: '最近更新', items: recentItems.value }] : []),
    ]
  }
  return [
    ...(noteHitItems.value.length > 0 ? [{ label: '词条', items: noteHitItems.value }] : []),
    ...(filteredActions.value.length > 0 ? [{ label: '动作', items: filteredActions.value }] : []),
  ]
})

const flatItems = computed<PaletteItem[]>(() => sections.value.flatMap((s) => s.items))
const activeId = computed(() => flatItems.value[activeIndex.value]?.id)
const activeOptionId = computed(() => (activeId.value ? `cmd-opt-${activeId.value}` : undefined))

// 结果集变化（搜索/开面板）后活动项越界则归零；活动项变化滚动到可视区
watch(
  () => flatItems.value.length,
  (len) => {
    if (activeIndex.value >= len) activeIndex.value = 0
  },
)

watch(activeId, () => {
  void nextTick(() => {
    if (!activeId.value) return
    document
      .getElementById(`cmd-opt-${activeId.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
})

// ---------- 开关：焦点进出 + body 滚动锁 + 数据预热 ----------

let previouslyFocused: HTMLElement | null = null

watch(
  () => props.open,
  (open) => {
    if (open) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      query.value = ''
      activeIndex.value = 0
      noteHits.value = []
      void loadRecent()
      void ensureFuse()
      document.body.style.overflow = 'hidden'
      void nextTick(() => {
        inputEl.value?.focus()
        inputEl.value?.select()
      })
    } else {
      document.body.style.overflow = ''
      restoreFocus()
    }
  },
)

function restoreFocus(): void {
  if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
  previouslyFocused = null
}

function close(): void {
  emit('close')
}

// ---------- 键盘：document capture 段独占（铁律级约束，见文件头注释） ----------

function onDocKeydownCapture(e: KeyboardEvent): void {
  if (!props.open) return
  // IME 组合中（拼音候选确认等）：不拦截不处理，让输入法正常工作
  if (e.isComposing || e.keyCode === 229) return
  // 面板打开期间独占键盘：阻止事件抵达阅读页/编辑页的 window 监听
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    close()
    return
  }
  const count = flatItems.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (count > 0) activeIndex.value = (activeIndex.value + 1) % count
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (count > 0) activeIndex.value = (activeIndex.value - 1 + count) % count
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    flatItems.value[activeIndex.value]?.run()
    return
  }
  if (e.key === 'Tab') {
    // 面板内只有输入框一个 Tab 停靠点，阻断 Tab 防焦点逃出模态
    e.preventDefault()
  }
}

function setActive(id: string): void {
  const idx = flatItems.value.findIndex((it) => it.id === id)
  if (idx >= 0) activeIndex.value = idx
}

onMounted(() => {
  document.addEventListener('keydown', onDocKeydownCapture, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydownCapture, true)
  window.clearTimeout(searchTimer)
  // 面板卸载时若仍持锁（如路由跳转强卸载），还原 body 滚动
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd">
      <div v-if="open" class="cmd-root">
        <div class="cmd-mask" @click="close" />
        <div class="cmd-panel" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="cmd-input-row">
            <Icon name="search" :size="16" class="cmd-input-icon" />
            <input
              ref="inputEl"
              v-model="query"
              class="cmd-input"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmd-list"
              :aria-activedescendant="activeOptionId"
              aria-label="搜索词条或执行动作"
              placeholder="搜索词条，或输入动作名…"
              autocomplete="off"
              spellcheck="false"
            />
            <kbd class="cmd-kbd">Esc</kbd>
          </div>
          <div class="cmd-body">
            <p v-if="flatItems.length === 0" class="cmd-empty">
              {{ query.trim() && indexLoading ? '搜索索引加载中…' : '没有匹配的结果' }}
            </p>
            <ul v-else id="cmd-list" class="cmd-list" role="listbox" aria-label="结果列表">
              <template v-for="section in sections" :key="section.label">
                <li class="cmd-group" role="presentation">{{ section.label }}</li>
                <li
                  v-for="item in section.items"
                  :id="`cmd-opt-${item.id}`"
                  :key="item.id"
                  class="cmd-item"
                  role="option"
                  :aria-selected="item.id === activeId"
                  :class="{ active: item.id === activeId }"
                  @mousemove="setActive(item.id)"
                  @click="item.run()"
                >
                  <Icon v-if="item.icon" :name="item.icon" :size="16" class="cmd-item-icon" />
                  <span class="cmd-item-label">{{ item.label }}</span>
                  <span v-if="item.ipa" class="cmd-item-ipa">{{ item.ipa }}</span>
                  <span v-if="item.badge" class="cmd-item-badge">{{ item.badge }}</span>
                  <span v-if="item.hint" class="cmd-item-hint">{{ item.hint }}</span>
                </li>
              </template>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmd-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-float);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 14vh 16px 16px;
}

.cmd-mask {
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
}

.cmd-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: 68vh;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.cmd-input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.cmd-input-icon {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.cmd-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
}

.cmd-input::placeholder {
  color: var(--color-text-secondary);
}

.cmd-kbd {
  flex-shrink: 0;
  padding: 1px 6px;
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.cmd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-1) 0 var(--space-2);
}

.cmd-empty {
  margin: 0;
  padding: var(--space-5) var(--space-4);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.cmd-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cmd-group {
  padding: var(--space-2) var(--space-4) var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  user-select: none;
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  color: var(--color-text);
  font-size: var(--text-base);
  min-width: 0;
}

.cmd-item-icon {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.cmd-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-item-ipa {
  flex-shrink: 0;
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.cmd-item-badge {
  flex-shrink: 0;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.cmd-item-hint {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 活动项高亮：底色 + 图标/文字提为 accent（与侧栏激活态同语义） */
.cmd-item.active {
  background: var(--color-accent-soft);
}

.cmd-item.active,
.cmd-item.active .cmd-item-icon {
  color: var(--color-accent);
}

/* 开关过渡（§6 铁律）：与全部新增动画一致包在 no-preference 内，默认静态直切 */
@media (prefers-reduced-motion: no-preference) {
  .cmd-enter-active,
  .cmd-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .cmd-enter-active .cmd-panel {
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .cmd-enter-from,
  .cmd-leave-to {
    opacity: 0;
  }

  .cmd-enter-from .cmd-panel {
    transform: translateY(6px) scale(0.98);
  }
}

@media (max-width: 767px) {
  .cmd-root {
    padding-top: 8vh;
  }
}
</style>
