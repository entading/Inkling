<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="not-found">
    <p class="code">404</p>
    <h1 class="title">页面不存在</h1>
    <p class="desc">你要找的词条或页面不在这里。</p>
    <RouterLink to="/" class="home-link">返回首页</RouterLink>
  </div>
</template>

<style scoped>
.not-found {
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: var(--space-7) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.code {
  font-size: 3rem;
  font-weight: 700;
  color: var(--color-accent);
  margin: 0;
}

.title {
  font-size: 1.3rem;
  margin: 0;
}

.desc {
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-4);
}

.home-link {
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: #fff;
  text-decoration: none;
  transition: opacity 0.15s ease;
}

.home-link:hover {
  opacity: 0.88;
}
</style>
