<script setup lang="ts">
/**
 * 空状态（§4）：内联 SVG 简笔插画（摊开的书 + 散点）+ 标题 + 描述 + 可选动作插槽。
 * 插画用 accent-soft 单色系，颜色全部走语义令牌，深浅主题自动适配。
 */
withDefaults(defineProps<{ title: string; description?: string }>(), {
  description: '',
})
</script>

<template>
  <div class="empty-state">
    <svg class="empty-art" viewBox="0 0 128 88" fill="none" aria-hidden="true">
      <!-- 散点：accent 低透明度点缀 -->
      <circle cx="16" cy="20" r="2.5" fill="var(--color-accent)" opacity="0.35" />
      <circle cx="106" cy="14" r="3" fill="var(--color-accent)" opacity="0.22" />
      <circle cx="118" cy="46" r="2" fill="var(--color-accent)" opacity="0.3" />
      <circle cx="10" cy="52" r="2" fill="var(--color-accent)" opacity="0.25" />
      <circle cx="112" cy="72" r="2.5" fill="var(--color-accent)" opacity="0.18" />
      <circle cx="24" cy="74" r="1.8" fill="var(--color-accent)" opacity="0.28" />
      <!-- 摊开的书：左右页 accent-soft 实底 + accent 描边 -->
      <path
        d="M64 30 C57 22 44 19 31 21 L31 64 C44 62 57 65 64 73 Z"
        fill="var(--color-accent-soft)"
        stroke="var(--color-accent)"
        stroke-opacity="0.45"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <path
        d="M64 30 C71 22 84 19 97 21 L97 64 C84 62 71 65 64 73 Z"
        fill="var(--color-accent-soft)"
        stroke="var(--color-accent)"
        stroke-opacity="0.45"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <!-- 书脊与页内行 -->
      <path d="M64 30 V73" stroke="var(--color-accent)" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />
      <path d="M38 32 C47 31 55 33 59 36" stroke="var(--color-accent)" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round" />
      <path d="M38 41 C47 40 55 42 59 45" stroke="var(--color-accent)" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round" />
      <path d="M90 32 C81 31 73 33 69 36" stroke="var(--color-accent)" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round" />
      <path d="M90 41 C81 40 73 42 69 45" stroke="var(--color-accent)" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round" />
      <!-- 基线阴影 -->
      <path d="M30 80 H98" stroke="var(--color-border)" stroke-width="2" stroke-linecap="round" />
    </svg>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <div v-if="$slots.default" class="empty-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  text-align: center;
}

.empty-art {
  width: 128px;
  height: 88px;
  margin-bottom: var(--space-2);
}

.empty-title {
  margin: 0;
  font-weight: 500;
  font-size: var(--text-base);
  color: var(--color-text);
}

.empty-desc {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-width: 320px;
}

.empty-actions {
  margin-top: var(--space-3);
  display: flex;
  gap: var(--space-3);
}
</style>
