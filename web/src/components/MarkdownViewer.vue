<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { render, setLinkIndex } from '../lib/markdown'
import { getSearchIndex } from '../lib/search'

// interactive=false 用于编辑页预览：链接样式照常渲染（所见即所得），点击不导航
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
})

/** 事件委托：wiki 链接 SPA 跳转；缺失目标跳新建页（stub 创建）。普通 md 链接不受影响 */
function onBodyClick(e: MouseEvent): void {
  if (!props.interactive) return
  const el = (e.target as HTMLElement | null)?.closest('a.wiki-link')
  if (!el) return
  e.preventDefault()
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
</script>

<template>
  <div class="note-body" @click="onBodyClick" v-html="html" />
</template>

<style scoped>
/* 样式迁自 NoteView.vue（M4 抽组件），阅读页与编辑页预览共用 */
.note-body {
  line-height: 1.8;
  font-size: 1rem;
  color: var(--color-text);
}

.note-body :deep(h1) {
  font-size: 1.35rem;
  margin: 1.6em 0 0.6em;
}

.note-body :deep(h2) {
  font-size: 1.15rem;
  margin: 1.5em 0 0.5em;
}

.note-body :deep(h3) {
  font-size: 1.05rem;
}

.note-body :deep(p) {
  margin: 0.6em 0;
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
  background: var(--color-bg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.note-body :deep(code) {
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.9em;
}

.note-body :deep(pre) {
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

.note-body :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(59, 130, 246, 0.3);
}

.note-body :deep(a:hover) {
  border-bottom-color: var(--color-accent);
}

/* 双向链接（M5）：无 href，跳转由根节点事件委托处理 */
.note-body :deep(a.wiki-link) {
  color: var(--color-accent);
  border-bottom: 1px dashed rgba(59, 130, 246, 0.5);
  cursor: pointer;
}

.note-body :deep(a.wiki-link:hover) {
  border-bottom-color: var(--color-accent);
}

/* 全部板块未命中：红色虚线，点击跳新建页创建 stub */
.note-body :deep(a.wiki-link.is-missing) {
  color: var(--color-danger);
  border-bottom: 1px dashed var(--color-danger);
}

.note-body :deep(a.wiki-link.is-missing:hover) {
  border-bottom-style: solid;
}

.note-body :deep(table) {
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

@media (max-width: 767px) {
  .note-body {
    font-size: 0.95rem;
  }

  /* 宽表格在窄屏转为块级滚动容器，避免横向撑破页面 */
  .note-body :deep(table) {
    display: block;
    overflow-x: auto;
  }
}
</style>
