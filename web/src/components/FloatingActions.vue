<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from './Icon.vue'

/**
 * 浮动操作（M5'，§10）：移动端 FAB（新建词条）+ 桌面/移动通用回顶按钮。
 * 均 fixed 定位、--z-nav 层；FAB 仅 ≤767px 显示（CSS 裁剪），/new 页隐藏（避免自指按钮）。
 */

const route = useRoute()

const showTop = ref(false)
let raf = 0

function updateShowTop(): void {
  if (raf) return
  raf = window.requestAnimationFrame(() => {
    raf = 0
    // 阈值 300px（UX 打磨，原 600）：当前内容规模下全站最长可滚 492px，600 永远无法触发
    showTop.value = window.scrollY > 300
  })
}

function scrollTop(): void {
  // 动效纪律：reduced-motion 用瞬时跳转（auto），不做平滑动画
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', updateShowTop, { passive: true })
  updateShowTop()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(raf)
  window.removeEventListener('scroll', updateShowTop)
})
</script>

<template>
  <!-- 回顶：滚动 >300px 出现，桌面与移动端都有 -->
  <Transition name="pop">
    <button
      v-if="showTop"
      type="button"
      class="back-top"
      aria-label="回到顶部"
      @click="scrollTop"
    >
      <Icon name="arrow-up" :size="20" />
    </button>
  </Transition>

  <!-- 移动端 FAB：右下角 accent 圆钮新建词条 -->
  <RouterLink v-if="route.name !== 'new-note'" to="/new" class="fab" aria-label="新建词条">
    <Icon name="plus" :size="20" />
  </RouterLink>
</template>

<style scoped>
.back-top {
  position: fixed;
  right: var(--space-6);
  bottom: var(--space-6);
  z-index: var(--z-nav);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.back-top:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.fab {
  position: fixed;
  right: var(--space-4);
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: var(--z-nav);
  display: none; /* 桌面隐藏，≤767px 显示 */
  place-items: center;
  width: 48px;
  height: 48px;
  color: var(--color-on-accent);
  background: var(--color-accent);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.fab:hover {
  opacity: 0.9;
}

@media (max-width: 767px) {
  .fab {
    display: grid;
  }

  /* 回顶叠在 FAB 上方 56px（48 高 + 8 间距），避开底导与 FAB */
  .back-top {
    right: var(--space-4);
    bottom: calc(128px + env(safe-area-inset-bottom));
  }
}

/* 出现/消失过渡 + 按压反馈（§6）：全部新增动画统一包在 no-preference 内，
   reduced-motion 下直切（无过渡规则即瞬时） */
@media (prefers-reduced-motion: no-preference) {
  .pop-enter-active,
  .pop-leave-active {
    transition: opacity var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .pop-enter-from,
  .pop-leave-to {
    opacity: 0;
    transform: translateY(4px);
  }

  .back-top:active,
  .fab:active {
    transform: scale(0.98);
  }
}
</style>
