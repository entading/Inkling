<script setup lang="ts">
withDefaults(defineProps<{ modelValue: number; size?: 'sm' | 'md' }>(), { size: 'md' })
const emit = defineEmits<{ (e: 'select', color: number): void }>()

const COLORS = [0, 1, 2, 3, 4, 5, 6, 7]
</script>

<template>
  <div class="palette" role="group" aria-label="标签颜色">
    <button
      v-for="c in COLORS"
      :key="c"
      type="button"
      class="swatch"
      :class="{ selected: c === modelValue }"
      :aria-pressed="c === modelValue"
      :aria-label="`色板 ${c + 1}`"
      :title="`色板 ${c + 1}`"
      @click="emit('select', c)"
    >
      <!-- 色点必须由内层 span 承接 .tag-pair-N：scoped 类特异性（含 [data-v]）压过全局应用类，
           本组件任何 scoped 规则都不得给 dot 设 background/color（M2' 铁律的按钮变体） -->
      <span class="swatch-dot" :class="[`tag-pair-${c}`, size === 'sm' && 'swatch-dot-sm']" />
    </button>
  </div>
</template>

<style scoped>
.palette {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}

.swatch-dot {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

/* 紧凑档：色卡墙卡内使用（三列网格内宽有限） */
.swatch-dot-sm {
  width: 14px;
  height: 14px;
}

/* 选中环缺口色可被宿主覆盖（全染卡上透出卡体洗底，默认透出页面底色） */
.swatch.selected {
  box-shadow: 0 0 0 2px var(--swatch-ring-gap, var(--color-bg)), 0 0 0 4px var(--color-accent);
}

@media (prefers-reduced-motion: no-preference) {
  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch:active {
    transform: scale(0.98);
  }
}
</style>
