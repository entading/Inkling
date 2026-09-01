<script setup lang="ts">
/**
 * 骨架屏原子组件（§6）：surface-2 底 + 高光扫过（shimmer）。
 * 尺寸走 props 或使用处 class 控制（height/width 可为任意 CSS 值，
 * 内容尺寸一律引用 --text-* 令牌以贴合真实文本，见使用处）。
 */
const props = defineProps<{
  /** 宽度，如 '40%'、'40px'；缺省 100% */
  w?: string
  /** 高度，如 'var(--text-lg)'；缺省 var(--text-md) */
  h?: string
  /** 圆角；缺省 var(--radius-sm) */
  r?: string
}>()
</script>

<template>
  <span
    class="skeleton"
    aria-hidden="true"
    :style="{ width: props.w, height: props.h, borderRadius: props.r }"
  />
</template>

<style scoped>
.skeleton {
  display: block;
  width: 100%;
  height: var(--text-md);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  position: relative;
  overflow: hidden;
}

/* shimmer 与全部新增动画一致：默认静态，仅在系统允许动效时启用（含 keyframes 同块） */
@media (prefers-reduced-motion: no-preference) {
  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent,
      var(--skeleton-shimmer),
      transparent
    );
    animation: skeleton-sweep var(--duration-shimmer) linear infinite;
  }

  @keyframes skeleton-sweep {
    to {
      transform: translateX(100%);
    }
  }
}
</style>
