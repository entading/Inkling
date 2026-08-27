<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{ tag: string }>()
</script>

<template>
  <RouterLink :to="`/tags/${encodeURIComponent(tag)}`" class="tag-badge">
    {{ tag }}
  </RouterLink>
</template>

<style scoped>
.tag-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: nowrap;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.tag-badge:hover {
  background: var(--color-accent);
  color: #fff;
}
</style>
