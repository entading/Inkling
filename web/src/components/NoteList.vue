<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import EmptyState from './EmptyState.vue'
import TagBadge from './TagBadge.vue'
import { STAGGER_CAP } from '../lib/stagger'
import type { NoteMeta } from '../api'

defineProps<{ notes: NoteMeta[] }>()

// ---------- 入场 stagger（§6）----------
// 前 STAGGER_CAP 行携带 row-in 类与递增内联 delay；是否真正播放由
// 祖先 .stagger-arm（视图数据就绪后的入场窗口，见 lib/stagger.ts）门控——导航入场
// 播一次波浪，页内过滤/标签重组重建列表时祖先类已摘除，零重播。
const play = (i: number) => i < STAGGER_CAP
const delay = (i: number) => ({ animationDelay: `calc(var(--stagger-step) * ${i})` })

// ---------- 行内标签溢出展开（UX 迭代：列表行只显示前 3 个标签的「+N」接龙） ----------
// 展开态给 .note-row 挂 tags-expanded 类启用换行（桌面 row-side 默认 nowrap+shrink:0，
// 徽章超宽会顶出卡外，见实施记录），收起后还原。筛选重建列表时展开态随之复位。
const expandedRows = ref<Set<string>>(new Set())

function rowKey(note: NoteMeta): string {
  return `${note.board}/${note.slug}`
}

function isExpanded(note: NoteMeta): boolean {
  return expandedRows.value.has(rowKey(note))
}

function toggleTags(note: NoteMeta): void {
  const key = rowKey(note)
  const next = new Set(expandedRows.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedRows.value = next
}

function visibleTags(note: NoteMeta): string[] {
  return isExpanded(note) ? note.tags : note.tags.slice(0, 3)
}

</script>

<template>
  <ul v-if="notes.length" class="note-list">
    <li
      v-for="(note, i) in notes"
      :key="`${note.board}/${note.slug}`"
      :class="{ 'row-in': play(i) }"
      :style="play(i) ? delay(i) : undefined"
    >
      <!-- 行内标题与标签均为独立链接，避免 <a> 嵌套；tags-expanded 启用换行承接溢出徽章 -->
      <div class="note-row" :class="{ 'tags-expanded': isExpanded(note) }">
        <RouterLink
          :to="`/v/${note.board}/${encodeURIComponent(note.slug)}`"
          class="row-main row-title-link"
        >
          <span class="row-title">{{ note.title }}</span>
          <span v-if="note.ipa" class="row-ipa">{{ note.ipa }}</span>
          <span v-if="note.source" class="row-source">{{ note.source }}</span>
        </RouterLink>
        <div class="row-side">
          <span class="row-board">{{ note.board === 'sentence' ? '长难句' : note.board === 'grammar' ? '语法' : note.board === 'phrase' ? '短语' : '词汇' }}</span>
          <TagBadge v-for="tag in visibleTags(note)" :key="tag" :tag="tag" />
          <button
            v-if="note.tags.length > 3"
            type="button"
            class="tags-toggle"
            :aria-expanded="isExpanded(note)"
            :aria-label="isExpanded(note) ? '收起标签' : `显示其余 ${note.tags.length - 3} 个标签`"
            @click.stop="toggleTags(note)"
          >
            {{ isExpanded(note) ? '收起' : `+${note.tags.length - 3}` }}
          </button>
          <span class="row-updated">{{ note.updated }}</span>
        </div>
      </div>
    </li>
  </ul>
  <EmptyState
    v-else
    title="暂无词条"
    description="这里还没有内容，新建一条开始沉淀。"
  >
    <RouterLink to="/new" class="empty-cta">＋ 新建词条</RouterLink>
  </EmptyState>
</template>

<style scoped>
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.note-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.note-row:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.row-main {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
}

/* 整行可点（UX 打磨）：标题链接伪元素铺满整行，行内任意位置点击 = 打开词条；
   拉伸由伪元素完成而非 <a> 包裹整行——「行内标题与标签均为独立链接，避免嵌套」
   的模板约束不变。标签（.tag-badge）定位提升保持浮在拉伸层之上，跳转标签页不变 */
.row-main::after {
  content: "";
  position: absolute;
  inset: 0;
}

/* 键盘 Tab 聚焦标题链接时，焦点环随拉伸层圈住整行（沿用 M7 全局 focus-visible 约定） */
.row-main:focus-visible {
  outline: none;
}

.row-main:focus-visible::after {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-md);
}

/* 标签悬浮于拉伸层之上（DOM 在后 + 定位提升同层），点击仍进标签页 */
.tag-badge {
  position: relative;
}

.row-title-link {
  text-decoration: none;
  color: var(--color-text);
}

.note-row:hover .row-title {
  color: var(--color-accent);
}

.row-title {
  font-weight: 500;
  font-size: var(--text-md);
  /* 超长不可断词标题折行而非撑破：否则 min-content 沿 flex 链（span 子项 min-width:auto）
  顶开 .note-row 造成文档级横滚（同阅读页 .note-title 的 M1 同款处理） */
  overflow-wrap: anywhere;
}

.row-ipa {
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.row-source {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 弹性填充项：行宽不足时由 source 独自吸收挤压（截断省略），
  避免标题/ipa 被挤出断词；超长标题则被钳到剩余宽度内折行 */
  flex: 1 1 0;
  min-width: 0;
}

.row-side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.row-board {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.row-updated {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* 标签溢出指示器：中性 ghost 胶囊（与彩色 TagBadge 区分身份）；position:relative
   浮于拉伸层之上（同 .tag-badge），点击开合不触发整行导航 */
.tags-toggle {
  position: relative;
  padding: 1px 8px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.tags-toggle:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.tags-toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* 展开态换行补丁（防溢出）：桌面 .row-side 默认 nowrap + shrink:0，徽章超宽会
   顶出卡外（实测 scrollWidth 815 > 670）——展开时启用换行，徽章接龙换到副行，
   移动端媒体查询本已有同款规则 */
.note-row.tags-expanded {
  flex-wrap: wrap;
  align-items: flex-start;
}

.note-row.tags-expanded .row-side {
  flex-wrap: wrap;
  max-width: 100%;
}

.empty-cta {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  text-decoration: none;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.empty-cta:hover {
  opacity: 0.88;
}

/* 入场 stagger（§6）：动画门控在视图入场窗口祖先类 .stagger-arm 之下（lib/stagger.ts），
   窗口内挂载的列表播一次波浪（cap 前 12 项逐项递增 delay，内联注入）；页内过滤/重组
   重建的列表拿不到该祖先类 → 零重播。与全部新增动画一致包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .stagger-arm .row-in {
    animation: row-in var(--duration-slow) var(--ease-out) backwards;
  }

  @keyframes row-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .empty-cta:active {
    transform: scale(0.98);
  }
}

@media (max-width: 767px) {
  /* 窄屏侧栏行内容放不下时允许换行：标题一行，板块/标签/日期换行排 */
  .note-row {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2) var(--space-4);
  }

  .row-side {
    flex-wrap: wrap;
    /* flex-shrink:0 的 flex item 按 max-content 计宽，3 个长标签时超出视口；
    封顶后 flex-wrap 才会生效改为换行 */
    max-width: 100%;
  }

  /* 长标签防溢出（迭代⑧展开功能压力测试发现，亦为既有问题）：单枚 32 字上限
  徽章自身宽于窄视口——允许徽章内折行（短标签单行照旧）；完整名称在详情页可看 */
  .row-side :deep(.tag-badge) {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
