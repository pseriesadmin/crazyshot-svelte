// 플로팅 메뉴 스크롤 숨김/노출 액션 — ui-mobile.md FloatingBar 패턴 준용
// (peek: 화면 우측으로 절반 숨김 / expand: 튀어나오며 노출)
// 업스크롤 → peek(true), 다운스크롤 → expand(false)
export function scrollPeek(node: HTMLElement, onChange: (peek: boolean) => void) {
  const scrollEl = node.closest('.mob-content') as HTMLElement | null
  if (!scrollEl) return {}

  let lastY = scrollEl.scrollTop

  function handleScroll(): void {
    const y = scrollEl!.scrollTop
    if (y > lastY && y > 20) onChange(false)   // 다운스크롤 → 튀어나옴(expand)
    else if (y < lastY) onChange(true)          // 업스크롤 → 절반 숨김(peek)
    lastY = y
  }

  scrollEl.addEventListener('scroll', handleScroll, { passive: true })

  return {
    destroy(): void {
      scrollEl!.removeEventListener('scroll', handleScroll)
    },
  }
}
