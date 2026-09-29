// 스크롤로 화면에 들어올 때 서서히 나타나는(페이드인) Svelte action — 이동 없이 투명도만 변경.
// - 마운트 시점에 이미 화면 안에 있으면 숨기지 않고 그대로 표시(깜빡임 방지)
// - prefers-reduced-motion 사용자는 효과 없이 즉시 표시
// - 한 번 나타나면 관찰 해제(다시 숨기지 않음)
export function revealOnScroll(node: HTMLElement, opts: { duration?: number } = {}): { destroy: () => void } {
  const duration = opts.duration ?? 600
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const rect = node.getBoundingClientRect()
  const alreadyVisible = rect.top < window.innerHeight && rect.bottom > 0

  if (reduce || alreadyVisible || typeof IntersectionObserver === 'undefined') {
    return { destroy() {} }
  }

  node.style.opacity = '0'
  node.style.transition = `opacity ${duration}ms ease`
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        node.style.opacity = '1'
        io.disconnect()
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  )
  io.observe(node)

  return { destroy: () => io.disconnect() }
}
