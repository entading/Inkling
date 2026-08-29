<script setup lang="ts">
import { computed } from 'vue'
import NoteList from './NoteList.vue'
import type { NoteMeta } from '../api'

const props = defineProps<{ notes: NoteMeta[] }>()

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#']

interface Group {
  key: string
  notes: NoteMeta[]
}

/** 首字母为 A–Z 归入对应字母组（大小写归一），否则归入「#」组 */
function groupKey(title: string): string {
  const ch = title.charAt(0)
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase()
  return '#'
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, NoteMeta[]>()
  for (const n of props.notes) {
    const key = groupKey(n.title)
    const list = map.get(key)
    if (list) list.push(n)
    else map.set(key, [n])
  }
  // 字母组按 A–Z、# 收尾，只渲染非空组
  return [...map.entries()].sort((a, b) => {
    const ai = LETTERS.indexOf(a[0])
    const bi = LETTERS.indexOf(b[0])
    return ai - bi
  }).map(([key, notes]) => ({ key, notes }))
})

const present = computed(() => new Set(groups.value.map((g) => g.key)))

const groupEls = new Map<string, HTMLElement>()

function setGroupRef(key: string, el: unknown) {
  if (el) groupEls.set(key, el as HTMLElement)
}

function scrollTo(key: string) {
  groupEls.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="az">
    <nav class="az-rail" aria-label="首字母索引">
      <button
        v-for="letter in LETTERS"
        :key="letter"
        type="button"
        class="az-letter"
        :class="{ disabled: !present.has(letter) }"
        :disabled="!present.has(letter)"
        @click="scrollTo(letter)"
      >
        {{ letter }}
      </button>
    </nav>

    <div class="az-groups">
      <section v-for="g in groups" :key="g.key" class="az-group" :ref="(el) => setGroupRef(g.key, el)">
        <h2 class="az-group-title">{{ g.key }}</h2>
        <NoteList :notes="g.notes" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.az {
  display: flex;
  gap: var(--space-4);
}

.az-rail {
  position: sticky;
  top: var(--space-6);
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: var(--space-2);
  border-right: 1px solid var(--color-border);
}

.az-letter {
  width: 24px;
  padding: 2px 0;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--color-accent);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.az-letter:hover:not(.disabled) {
  background: var(--color-accent-soft);
}

.az-letter.disabled {
  color: var(--color-border);
  cursor: default;
}

.az-groups {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.az-group-title {
  margin: 0 0 var(--space-3);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-accent);
}

@media (max-width: 767px) {
  /* 移动端：竖排索引改为列表顶部横向滚动字母条（类似手机通讯录，设计 3.3） */
  .az {
    flex-direction: column;
    gap: 0;
  }

  .az-rail {
    position: sticky;
    top: 0;
    z-index: var(--z-rail);
    /* 覆盖桌面 align-self:flex-start：竖排改横排后必须撑满容器宽度才能内部滚动 */
    align-self: stretch;
    flex-direction: row;
    padding: var(--space-2) var(--space-1);
    margin-bottom: var(--space-4);
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .az-letter {
    flex: none;
  }

  /* 横向字母条 sticky 在顶部，滚动定位时给分组标题留出不被遮挡的余量；
  56px = 字母条内容高约 36px（--space-2 8px×2 + 字母行高 + 1px border）+ 桌面经典滚动条约 18px + 余量 */
  .az-group {
    scroll-margin-top: 56px;
  }
}
</style>
