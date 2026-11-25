// 가로 스크롤 탭(카테고리 버튼 줄) 인터랙션 액션 (2026-11-25)
//  · 양끝에 더 볼 내용이 있으면 그쪽 가장자리가 부드럽게 흐려진다(클래스 has-left / has-right)
//  · 마우스로는 끌어서 스크롤(터치는 기본 스크롤)
//  · 선택 값이 바뀌면 선택된 탭(.active)이 가운데로 부드럽게 이동한다
//  · 양끝 고무줄 — 끝에서 더 끌면 저항을 받으며 따라 늘어났다가(최대 약 60px), 놓으면 용수철처럼 튕겨 돌아온다(--tab-pull)
//  · 가속도 모션 — 마우스로 끌었다 놓으면 속도를 이어받아 감속하며 미끄러지고(관성), 스크롤 속도에 비례해 버튼이 진행 반대쪽으로 살짝 기울었다가(--tab-skew) 용수철처럼 돌아온다
// 사용: <div use:tabScroller={selectedKey}> — 선택된 버튼에 class="active"가 붙어 있어야 한다.
export function tabScroller(node: HTMLElement, selected: unknown) {
  let down = false
  let startX = 0
  let startLeft = 0
  let moved = false
  let lastX = 0
  let lastT = 0
  let dragV = 0 // 끌기 속도(px/ms)
  let raf = 0

  // 스크롤 속도 → 버튼 기울기. 멈추면 0으로 돌아오고, 버튼의 transform transition(스프링)이 되돌림을 부드럽게 만든다.
  let prevLeft = node.scrollLeft
  let prevT = performance.now()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  function updateSkew(): void {
    const now = performance.now()
    const dt = Math.max(1, now - prevT)
    const v = (node.scrollLeft - prevLeft) / dt // px/ms, 오른쪽으로 스크롤 = +
    prevLeft = node.scrollLeft
    prevT = now
    const skew = Math.max(-9, Math.min(9, -v * 7))
    node.style.setProperty('--tab-skew', String(skew))
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => node.style.setProperty('--tab-skew', '0'), 90)
  }

  function inertia(): void {
    cancelAnimationFrame(raf)
    let v = dragV
    let t = performance.now()
    const step = (now: number): void => {
      const dt = now - t
      t = now
      node.scrollLeft -= v * dt
      v *= Math.pow(0.94, dt / 16) // 마찰 — 매 프레임 6%씩 감속
      if (Math.abs(v) > 0.04) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  // 양끝 고무줄: 끝을 넘어 끌린 만큼의 40%만 버튼이 따라 움직인다. 놓으면 release 클래스로 스프링 전환을 켜고 0으로 돌린다.
  const PULL_RESIST = 0.4
  const PULL_MAX = 60
  function setPull(px: number): void {
    node.classList.remove('tabs-release')
    node.style.setProperty('--tab-pull', String(Math.max(-PULL_MAX, Math.min(PULL_MAX, px))))
  }
  function releasePull(): void {
    node.classList.add('tabs-release')
    node.style.setProperty('--tab-pull', '0')
  }
  function overscrollOf(desiredLeft: number): number {
    const max = node.scrollWidth - node.clientWidth
    if (desiredLeft < 0) return -desiredLeft // 왼쪽 끝을 넘어 오른쪽으로 끌림(+)
    if (desiredLeft > max) return -(desiredLeft - max) // 오른쪽 끝을 넘어 왼쪽으로 끌림(-)
    return 0
  }

  // 터치 — 기본 스크롤은 그대로 두고, 끝에 닿은 뒤의 추가 이동만 고무줄로 보여 준다
  let tStartX = 0
  let tStartLeft = 0
  function onTouchStart(e: TouchEvent): void {
    tStartX = e.touches[0].clientX
    tStartLeft = node.scrollLeft
  }
  function onTouchMove(e: TouchEvent): void {
    const dx = e.touches[0].clientX - tStartX
    const pull = overscrollOf(tStartLeft - dx)
    if (pull !== 0) setPull(pull * PULL_RESIST)
    else if (node.style.getPropertyValue('--tab-pull') !== '0') setPull(0)
  }
  function onTouchEnd(): void { releasePull() }

  function onScroll(): void { updateEdges(); updateSkew() }
  function updateEdges(): void {
    const max = node.scrollWidth - node.clientWidth
    node.classList.toggle('has-left', node.scrollLeft > 2)
    node.classList.toggle('has-right', node.scrollLeft < max - 2)
  }
  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return
    cancelAnimationFrame(raf)
    down = true
    moved = false
    startX = e.clientX
    startLeft = node.scrollLeft
    lastX = e.clientX
    lastT = performance.now()
    dragV = 0
  }
  function onPointerMove(e: PointerEvent): void {
    if (!down) return
    const dx = e.clientX - startX
    if (Math.abs(dx) > 4) moved = true
    node.scrollLeft = startLeft - dx
    const over = overscrollOf(startLeft - dx)
    if (over !== 0) setPull(over * PULL_RESIST)
    else if (node.style.getPropertyValue('--tab-pull') !== '0') setPull(0)
    const now = performance.now()
    const dt = Math.max(1, now - lastT)
    dragV = 0.8 * dragV + 0.2 * ((e.clientX - lastX) / dt) // 최근 이동 속도(부드럽게 평균)
    lastX = e.clientX
    lastT = now
  }
  function onPointerUp(): void {
    if (!down) return
    down = false
    releasePull()
    if (moved && Math.abs(dragV) > 0.1) inertia()
  }
  // 끌고 난 뒤 손을 뗄 때 버튼 클릭이 실행되지 않게 막는다
  function onClickCapture(e: MouseEvent): void {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false }
  }
  function centerActive(): void {
    node.querySelector<HTMLElement>('.active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }

  node.addEventListener('scroll', onScroll, { passive: true })
  node.addEventListener('touchstart', onTouchStart, { passive: true })
  node.addEventListener('touchmove', onTouchMove, { passive: true })
  node.addEventListener('touchend', onTouchEnd, { passive: true })
  node.addEventListener('touchcancel', onTouchEnd, { passive: true })
  node.addEventListener('pointerdown', onPointerDown)
  node.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  node.addEventListener('click', onClickCapture, true)
  const ro = new ResizeObserver(updateEdges)
  ro.observe(node)
  updateEdges()
  queueMicrotask(centerActive)

  return {
    update(): void { queueMicrotask(centerActive); updateEdges() },
    destroy(): void {
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.removeEventListener('touchcancel', onTouchEnd)
      cancelAnimationFrame(raf)
      clearTimeout(idleTimer)
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      node.removeEventListener('click', onClickCapture, true)
      ro.disconnect()
    },
  }
}
