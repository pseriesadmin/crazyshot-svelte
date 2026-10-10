<script lang="ts">
  // PRD.1.7 — ChatBottomSheet: 바텀업 모달 컨테이너
  // 플랜: border-radius 50px 50px 0 0, max-height 85vh, 슬라이드업 애니메이션
  // 접근성: role="dialog" + aria-modal + 포커스 트랩

  import ChatWindow from './ChatWindow.svelte'

  interface Props {
    isOpen: boolean
    userId: string
    userName: string
    userHandle?: string
    contextType?: string
    contextId?: string
    onclose: () => void
  }

  let {
    isOpen,
    userId,
    userName,
    userHandle = '',
    contextType,
    contextId,
    onclose,
  }: Props = $props()

  let dialogEl = $state<HTMLDivElement | null>(null)

  // 열릴 때 포커스 이동
  $effect(() => {
    if (isOpen && dialogEl) {
      dialogEl.focus()
    }
  })

  // 모달이 열려 있는 동안 배경(문서) 스크롤 잠금 — 대화 영역이 비었거나 스크롤이 끝났을 때
  // 터치 스크롤이 배경 화면으로 전이(scroll chaining)되는 현상 방지. 닫힘/언마운트 시 원래 값 복원.
  $effect(() => {
    if (!isOpen) return
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  })

  // 시트 높이를 "지금 실제로 보이는 영역" 기준으로 맞춘다 — iOS Safari(특히 iOS 26)에서 CSS `vh`는 주소창·툴바가 접힌 가장 큰 화면 높이라,
  // 툴바가 펼쳐진 상태에서 93vh 시트의 윗부분(드래그 핸들·프로필·닫기 버튼)이 상단 브라우저 영역 뒤로 밀려 올라가 보이지 않고 닫을 수 없게 된다
  // (2026-10-09 실기기 보고). visualViewport 높이(보이는 영역)를 --sheet-vh로 넘기고 CSS가 그 93%로 제한한다.
  // 키보드가 올라온 동안(입력창 포커스)은 갱신하지 않는다 — 시트가 키보드에 맞춰 줄었다 늘었다 하는 떨림 방지.
  $effect(() => {
    if (!isOpen || !dialogEl) return
    const el = dialogEl
    function sync() {
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) return
      const vv = window.visualViewport
      const h = Math.floor(vv ? vv.height : window.innerHeight)
      if (h > 0) el.style.setProperty('--sheet-vh', `${h}px`)
    }
    sync()
    const vv = window.visualViewport
    window.addEventListener('resize', sync)
    vv?.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('resize', sync)
      vv?.removeEventListener('resize', sync)
      el.style.removeProperty('--sheet-vh')
    }
  })

  // 드래그 핸들을 잡아 아래로 끌어내리면 시트가 손가락을 따라 내려가고, 충분히 내리거나 빠르게 놓으면 내려가는 모션과 함께 닫힌다(2026-10-09, Stephen 지시).
  // 모바일 전용(핸들은 PC에서 숨김). 조금만 내리고 놓으면 제자리로 되돌아간다. 닫기 버튼·ESC·배경 터치는 기존 그대로.
  const DRAG_CLOSE_DISTANCE = 120   // 이 이상 내리면 닫힘(px)
  const DRAG_CLOSE_VELOCITY = 0.6   // 이 속도(px/ms) 이상으로 놓으면 거리와 무관하게 닫힘
  const DRAG_CLOSE_MS = 250         // 내려가며 닫히는 모션 시간(CSS transition과 짝)
  let dragY = $state(0)
  let dragging = $state(false)
  let settling = $state(false)      // 놓은 뒤 transition 구간(되돌아가기·닫히며 내려가기)
  let dragStartY = 0
  let lastMoveY = 0
  let lastMoveT = 0
  let velocity = 0
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    if (isOpen) { dragY = 0; dragging = false; settling = false }
    return () => clearTimeout(closeTimer)
  })

  function onDragStart(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (settling) return
    dragging = true
    dragStartY = e.clientY
    lastMoveY = e.clientY
    lastMoveT = e.timeStamp
    velocity = 0
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onDragMove(e: PointerEvent) {
    if (!dragging) return
    dragY = Math.max(0, e.clientY - dragStartY)           // 위로는 끌리지 않는다
    const dt = e.timeStamp - lastMoveT
    if (dt > 0) velocity = (e.clientY - lastMoveY) / dt   // 아래 방향이 +
    lastMoveY = e.clientY
    lastMoveT = e.timeStamp
  }

  function onDragEnd() {
    if (!dragging) return
    dragging = false
    settling = true
    if (dragY > DRAG_CLOSE_DISTANCE || velocity > DRAG_CLOSE_VELOCITY) {
      dragY = dialogEl ? dialogEl.getBoundingClientRect().height : window.innerHeight   // 화면 아래로 내려가며 닫힘
      closeTimer = setTimeout(() => { onclose() }, DRAG_CLOSE_MS)
    } else {
      dragY = 0                                                                          // 제자리로 복귀
      closeTimer = setTimeout(() => { settling = false }, DRAG_CLOSE_MS)
    }
  }

  // ESC 키로 닫기
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }

  // 백드롭 클릭으로 닫기
  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose()
  }
</script>

{#if isOpen}
  <!-- 백드롭: dialog와 형제 관계 → aria-hidden이 dialog를 감싸지 않음 -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={handleBackdropClick} aria-hidden="true"></div>

  <!-- 바텀시트: 백드롭과 형제, 독립적으로 포커스 수신 -->
  <div
    class="bottom-sheet"
    role="dialog"
    aria-modal="true"
    aria-label="크레이지샷 채팅"
    bind:this={dialogEl}
    tabindex="-1"
    onkeydown={handleKeydown}
    style:transform={dragY > 0 || settling ? `translateY(${dragY}px)` : undefined}
    class:dragging
    class:settling
  >
    <!-- 드래그 핸들 — 눈에 보이는 막대(.drag-handle)를 감싼 넓은 터치 영역(.drag-zone). 키보드 사용자는 닫기 버튼·ESC로 닫는다 -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="drag-zone"
      onpointerdown={onDragStart}
      onpointermove={onDragMove}
      onpointerup={onDragEnd}
      onpointercancel={onDragEnd}
    >
      <div class="drag-handle" aria-hidden="true"></div>
    </div>

    <!-- 채팅 창 -->
    <div class="sheet-body">
      <ChatWindow
        {userId}
        {userName}
        {userHandle}
        {contextType}
        {contextId}
        {onclose}
      />
    </div>
  </div>
{/if}

<style>
  /* 백드롭 — opacity 대신 background-color 트랜지션: stacking context 미생성 */
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0);
    z-index: 200;
    animation: fade-in 0.2s ease forwards;
    touch-action: none; /* 백드롭 위 터치 스크롤이 배경으로 전달되지 않도록 */
  }

  @keyframes fade-in {
    from { background: rgba(16, 11, 50, 0); }
    to   { background: rgba(16, 11, 50, 0.45); }
  }

  /* 바텀시트 — 독립 fixed, backdrop과 별개로 위치 */
  .bottom-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 201;
    background: #e1def3;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0; /* 모바일 표준 대형 반경 30px(PC 50px의 0.6배, front-uiux.md §24) — 2026-10-09 Stephen 지시. 기존 50px(--radius-2xl) */
    height: 93vh; /* 구형 브라우저 폴백 */
    height: min(93vh, calc(var(--sheet-vh, 100dvh) * 0.93)); /* 보이는 영역의 93% — iOS Safari 상단 잘림 방지 */
    display: flex;
    flex-direction: column;
    outline: none;
    animation: slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    max-width: 480px;
    margin: 0 auto;
    overscroll-behavior: contain; /* 시트 안 스크롤이 끝나도 배경으로 전이 금지 */
  }

  @keyframes slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  /* 드래그 터치 영역 — 시트 맨 위 36px. 아래 여백을 -20px로 당겨 흐름상 차지하는 높이는 16px(핸들 12px 여백+4px 막대)로 기존과 같고,
     나머지 20px는 헤더 위에 겹쳐 터치만 받는다(z-index) — 기존 배치(핸들·헤더 위치) 그대로 */
  .drag-zone {
    position: relative;
    flex-shrink: 0;
    height: 36px;
    margin-bottom: -20px;
    z-index: 2;
    cursor: grab;
    touch-action: none; /* 끌 때 페이지·목록 스크롤로 해석되지 않게 */
  }
  .bottom-sheet.dragging .drag-zone { cursor: grabbing; }

  /* 끄는 동안은 손가락을 즉시 따라가고(transition 없음), 놓은 뒤에만 부드럽게 되돌아가거나 내려가며 닫힌다 */
  .bottom-sheet.settling {
    transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .bottom-sheet.settling { transition-duration: 0.01ms; }
  }

  /* 드래그 핸들 */
  .drag-handle {
    width: 40px;
    height: 4px;
    background: rgba(59, 47, 138, 0.25);
    border-radius: 2px;
    margin: 12px auto 0;
    flex-shrink: 0;
    /* 끌어내려 닫을 수 있다는 단서 — 막대가 가끔 위아래로 살짝 불규칙하게 튄다(2026-10-09, Stephen 지시) */
    animation: handle-hint 8s ease-in-out 1.2s infinite;
  }
  /* 불규칙한 높이로 짧게 튀고 길게 쉰다(진폭 -4/+1/-2px, 8초 주기의 앞 15%≈1.2초만 움직이고 나머지 약 6.8초는 정지) — 눈에 거슬리지 않게(간격 3.4초→8초로 확대, Stephen 지시 "너무 자주 작동") */
  @keyframes handle-hint {
    0%   { transform: translateY(0); }
    3%   { transform: translateY(-4px); }
    6%   { transform: translateY(1px); }
    9%   { transform: translateY(-2px); }
    12%  { transform: translateY(0.5px); }
    15%  { transform: translateY(0); }
    100% { transform: translateY(0); }
  }
  /* 끄는 중·놓은 뒤 정착 중에는 멈춘다 */
  .bottom-sheet.dragging .drag-handle,
  .bottom-sheet.settling .drag-handle {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .drag-handle { animation: none; }
  }

  /* 채팅 창 래퍼 */
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* PC: 우하단 팝업 */
  @media (min-width: 640px) {
    .bottom-sheet {
      bottom: calc(var(--layout-footer-h, 80px) + 24px + 56px);
      right: 24px;
      left: auto;
      margin: 0;
      width: 380px;
      max-width: 380px;
      height: 640px;
      border-radius: var(--radius-xl);
    }

    .drag-handle,
    .drag-zone {
      display: none;
    }
  }
</style>
