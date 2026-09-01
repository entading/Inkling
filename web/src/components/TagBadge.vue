<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { tagPairIndex } from '../lib/tagColor'

const props = defineProps<{ tag: string }>()

/** hash(tag)%8 → tokens.css 的 .tag-pair-N 应用类（底色/文字色），hover 叠加 --tag-hover-overlay */
const pairClass = computed(() => `tag-pair-${tagPairIndex(props.tag)}`)
</script>

<template>
  <RouterLink :to="`/tags/${encodeURIComponent(tag)}`" class="tag-badge" :class="pairClass">
    {{ tag }}
  </RouterLink>
</template>

<style scoped>
.tag-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: nowrap;
  text-decoration: none;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

/* hover 统一强化：叠加 --tag-hover-overlay 极淡覆盖（浅色压暗/深色提亮），不动文字色 */
.tag-badge:hover {
  background-image: linear-gradient(var(--tag-hover-overlay), var(--tag-hover-overlay));
}
</style>
