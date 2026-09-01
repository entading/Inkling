<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import Icon, { type IconName } from '../components/Icon.vue'
import NoteList from '../components/NoteList.vue'
import SearchPanel from '../components/SearchPanel.vue'
import Skeleton from '../components/Skeleton.vue'
import { api, type Board, type BoardInfo, type NoteMeta } from '../api'
import { useStaggerArm } from '../lib/stagger'

/** 板块卡图标（§4）：chip 底/图标/计数走 --board-* 个性色，卡片其余部分保持中性色 */
const BOARD_ICONS: Record<Board, IconName> = {
  vocab: 'book',
  phrase: 'link',
  sentence: 'align-left',
  grammar: 'graduation-cap',
}

const boards = ref<BoardInfo[]>([])
const recent = ref<NoteMeta[]>([])
const loading = ref(true)
const error = ref('')

// 入场 stagger 窗口（§6）：数据就绪后短暂挂 stagger-arm 祖先类，波浪后摘除
const staggerArm = useStaggerArm(loading)

/** 移动端右上角菜单（标签/设置入口，设计 3.3） */
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)

function onDocumentClick(e: MouseEvent) {
  if (menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false
}

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  try {
    ;[boards.value, recent.value] = await Promise.all([
      api.boards(),
      api.recent(10),
    ])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="home" :class="{ 'stagger-arm': staggerArm }">
    <div class="home-top">
      <div class="home-heading">
        <p class="eyebrow">个人英语学习知识沉淀库</p>
        <h1 class="title">今天想查点什么？</h1>
      </div>

      <div class="home-actions">
        <RouterLink to="/new" class="new-btn">＋ 新建词条</RouterLink>

        <div ref="menuRoot" class="top-menu">
          <button
            type="button"
            class="menu-btn"
            aria-label="更多"
            aria-haspopup="true"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <div v-if="menuOpen" class="menu-drop">
            <RouterLink to="/tags" class="menu-item" @click="menuOpen = false">标签</RouterLink>
            <RouterLink to="/settings" class="menu-item" @click="menuOpen = false">设置</RouterLink>
          </div>
        </div>
      </div>
    </div>

    <SearchPanel autofocus />

    <p v-if="error" class="error">加载失败：{{ error }}（请确认服务端已启动）</p>
    <div v-else-if="loading" class="home-skeleton" aria-hidden="true">
      <Skeleton class="sk-section" w="56px" />
      <div class="sk-boards">
        <div v-for="i in 4" :key="i" class="sk-board-card">
          <Skeleton class="sk-chip" w="40px" h="40px" r="var(--radius-md)" />
          <Skeleton class="sk-label" />
          <Skeleton class="sk-count" />
        </div>
      </div>
      <Skeleton class="sk-section sk-section-late" w="88px" />
      <div class="sk-rows">
        <div v-for="i in 6" :key="i" class="sk-row">
          <Skeleton class="sk-row-title" />
          <Skeleton class="sk-row-side" />
        </div>
      </div>
    </div>
    <template v-else>
      <h2 class="section-title">板块</h2>
      <div class="boards">
        <RouterLink
          v-for="b in boards"
          :key="b.board"
          :to="`/${b.board}`"
          class="board-card"
          :class="`board-${b.board}`"
        >
          <span class="board-chip"><Icon :name="BOARD_ICONS[b.board]" :size="20" /></span>
          <span class="board-label">{{ b.label }}</span>
          <span class="board-count">{{ b.count }}<span class="unit">条</span></span>
        </RouterLink>
      </div>

      <h2 class="section-title">最近添加</h2>
      <NoteList :notes="recent" />
    </template>
  </div>
</template>

<style scoped>
.home {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.home-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.home-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

/* 主按钮（强调色实心），桌面与移动端均可见（设计 5.1 新建词条快捷入口） */
.new-btn {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  text-decoration: none;
  white-space: nowrap;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.new-btn:hover {
  opacity: 0.88;
}

.title {
  font-size: var(--text-2xl);
  font-weight: 600;
  margin: var(--space-2) 0 var(--space-6);
  letter-spacing: -0.01em;
}

.top-menu {
  position: relative;
  display: none;
}

.menu-btn {
  width: 34px;
  height: 34px;
  font-size: var(--text-lg);
  line-height: 1;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.menu-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.menu-drop {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: var(--z-nav);
  min-width: 120px;
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.menu-item {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--text-base);
  text-decoration: none;
}

.menu-item:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.search-panel {
  margin-bottom: var(--space-7);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: var(--space-7) 0 var(--space-4);
}

.boards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.board-card {
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.board-card:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* 板块个性色（§5）：仅板块卡的 chip 与计数使用 --board-*，侧栏/按钮/链接仍统一宁静蓝 */
.board-chip {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: grid;
  place-items: center;
}

.board-vocab .board-chip {
  background: var(--board-vocab-soft);
  color: var(--board-vocab);
}

.board-phrase .board-chip {
  background: var(--board-phrase-soft);
  color: var(--board-phrase);
}

.board-sentence .board-chip {
  background: var(--board-sentence-soft);
  color: var(--board-sentence);
}

.board-grammar .board-chip {
  background: var(--board-grammar-soft);
  color: var(--board-grammar);
}

.board-vocab .board-count {
  color: var(--board-vocab);
}

.board-phrase .board-count {
  color: var(--board-phrase);
}

.board-sentence .board-count {
  color: var(--board-sentence);
}

.board-grammar .board-count {
  color: var(--board-grammar);
}

.board-label {
  font-weight: 600;
  font-size: var(--text-md);
}

.board-count {
  color: var(--color-accent);
  font-size: var(--text-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.unit {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 2px;
}

.eyebrow {
  color: var(--color-text-secondary);
  font-size: var(--text-base);
  margin: 0 0 var(--space-2);
}

.error {
  color: var(--color-danger);
}

/* 加载骨架（§6）：SearchPanel 常驻在 loading 分支外，骨架只复刻板块卡格与最近添加列表；
   板块卡/行容器沿用真实组件的容器规格，内容条高度走 --text-* */
.home-skeleton {
  display: flex;
  flex-direction: column;
}

.sk-section {
  height: var(--text-lg);
  margin-bottom: var(--space-4);
}

/* 真实 h2.section-title 与上方内容间距为 space-7（搜索框下方一份由其自身 margin 提供） */
.sk-section-late {
  margin-top: var(--space-7);
}

.sk-boards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.sk-board-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.sk-label {
  height: var(--text-md);
  width: 55%;
}

.sk-count {
  height: var(--text-xl);
  width: 30%;
}

.sk-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sk-row {
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

/* 按压反馈（§6）：全部新增动画统一包在 no-preference 内；
   .board-card 的 :active 须在 :hover 规则之后，按下时以 scale 覆盖悬浮 translateY */
@media (prefers-reduced-motion: no-preference) {
  .new-btn:active,
  .menu-btn:active,
  .board-card:active {
    transform: scale(0.98);
  }
}

@media (max-width: 767px) {
  .top-menu {
    display: block;
  }

  .title {
    font-size: var(--text-xl);
    margin-bottom: var(--space-4);
  }

  .search-panel {
    margin-bottom: var(--space-6);
  }

  .section-title {
    margin-top: var(--space-6);
  }

  .board-card {
    padding: var(--space-4);
  }
}
</style>
