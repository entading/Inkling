import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** stagger 波浪覆盖的行数上限：第 13 项起无动画无 delay（§6 cap 前 12 项） */
export const STAGGER_CAP = 12

/**
 * 页面级入场 stagger 开关（§6）。
 *
 * NoteList 的入场动画选择器门控在祖先类 `.stagger-arm` 之下：视图在「数据就绪」时挂上
 * 该类，波浪走完（cap × 步进 + 2×动画时长，全部由令牌推导）后摘除。于是：页面导航入场
 * 时列表播一次波浪；页内搜索过滤/标签重组导致 NoteList 卸载重建时（如 AZIndex 分组数
 * 变化），祖先类已摘除 → 零重播零闪烁。窗口计时从数据就绪起算，慢数据（骨架屏期）也
 * 不会错过入场。reduced-motion 下动画规则本身不生效，此类无副作用。
 */
export function useStaggerArm(loading: Ref<boolean>) {
  const armed = ref(false)
  let timer: number | undefined

  watch(loading, (isLoading) => {
    window.clearTimeout(timer)
    if (!isLoading) {
      // 数据就绪 → 武装入场窗口；loading 起始即 true，首次变化必然是 true→false（就绪）
      armed.value = true
      const css = getComputedStyle(document.documentElement)
      const step = parseFloat(css.getPropertyValue('--stagger-step')) || 24
      const slow = parseFloat(css.getPropertyValue('--duration-slow')) || 320
      timer = window.setTimeout(() => {
        armed.value = false
      }, STAGGER_CAP * step + 2 * slow)
    } else {
      armed.value = false
    }
  })

  onBeforeUnmount(() => window.clearTimeout(timer))

  return armed
}
