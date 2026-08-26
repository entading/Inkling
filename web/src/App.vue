<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { boardRoutes } from './router'
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">E</span>
        <span class="brand-name">EN_tool</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink to="/" class="nav-item" exact-active-class="active">首页</RouterLink>
        <RouterLink
          v-for="r in boardRoutes"
          :key="r.path"
          :to="r.path"
          class="nav-item"
          active-class="active"
        >
          {{ r.label }}
        </RouterLink>
      </nav>

      <p class="sidebar-foot">Markdown 文件即数据</p>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  width: var(--sidebar-width);
  flex-shrink: 0;
  height: 100vh;
  padding: var(--space-6) var(--space-4);
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  color: var(--color-text);
  padding: var(--space-2) var(--space-3);
}

.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: #fff;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.brand-name {
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: 0.01em;
}

.nav {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.nav-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 500;
}

.sidebar-foot {
  margin-top: auto;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  padding: 0 var(--space-3);
}

.content {
  flex: 1;
  min-width: 0;
  padding: var(--space-6) var(--space-7);
}
</style>
