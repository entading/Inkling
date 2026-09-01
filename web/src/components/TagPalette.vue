<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{ modelValue: number; size?: 'sm' | 'md'; pulse?: boolean }>(), {
  size: 'md',
  pulse: false,
})
const emit = defineEmits<{ (e: 'select', color: number): void }>()

const COLORS = [0, 1, 2, 3, 4, 5, 6, 7]

/**
 * pulse 模式（全染色卡宿主）：卡体洗底即"当前色"，选中环改为点击后亮起→衰减熄灭的
 * 一次性脉冲（--duration-pulse），不留常驻元素；ring 模式（幽灵卡表单/详情页等无洗底
 * 宿主）维持常亮选中环。aria-pressed 恒反映当前色，视觉与语义解耦。
 */
const justSet = ref<number | null>(null)
let pulseTimer: number | undefined

function onSelect(color: number): void {
  emit('select', color)
  if (!props.pulse) return
  justSet.value = color
  window.clearTimeout(pulseTimer)
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-pulse')) || 600
  pulseTimer = window.setTimeout(() => (justSet.value = null), ms)
}

onBeforeUnmount(() => window.clearTimeout(pulseTimer))
</script>

<template>
  <div class="palette" role="group" aria-label="标签颜色">
    <button
      v-for="c in COLORS"
      :key="c"
      type="button"
      class="swatch"
      :class="{
        selected: c === modelValue && !pulse,
        pulsing: c === justSet,
      }"
      :aria-pressed="c === modelValue"
      :aria-label="`色板 ${c + 1}`"
      :title="`色板 ${c + 1}`"
      @click="onSelect(c)"
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

  /* 选中脉冲（pulse 模式）：亮起后衰减熄灭（§6 新增动画连同 keyframes 入 no-preference） */
  .swatch.pulsing {
    animation: swatch-pulse var(--duration-pulse) var(--ease-out);
  }

  @keyframes swatch-pulse {
    0% {
      box-shadow: 0 0 0 2px var(--swatch-ring-gap, var(--color-bg)), 0 0 0 4px var(--color-accent);
    }
    100% {
      box-shadow: 0 0 0 2px transparent, 0 0 0 4px transparent;
    }
  }
}
</style>
