<script setup lang="ts">
defineProps<{ tag: string }>()
</script>

<template>
  <span class="tag-badge">{{ tag }}</span>
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
}
</style>
