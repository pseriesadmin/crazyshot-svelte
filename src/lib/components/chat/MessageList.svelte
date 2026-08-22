<script lang="ts">
  // PRD.1.7 — MessageList: 스크롤 메시지 목록
  // Figma node: 2497:8699 (chat list)
  // Realtime INSERT → pushMessage → 자동 하단 스크롤

  import MessageBubble from './MessageBubble.svelte'
  import type { ChatMessage, ActionPayload, CtaModalRequest } from '$lib/types/chat'

  // 당일 이전 대화카드는 시간(HH:MM)만 있어 며칠 치인지 헷갈림 — 날짜가 바뀌는 지점마다
  // 구분 배지를 끼워 넣는다(카카오톡 등과 동일한 관례). 오늘/어제는 상대 표현, 그 외는 절대 날짜.
  function isSameLocalDay(isoA: string, isoB: string): boolean {
    const a = new Date(isoA)
    const b = new Date(isoB)
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  }

  function formatDateDivider(iso: string): string {
    const d = new Date(iso)
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
    if (diffDays === 0) return '오늘'
    if (diffDays === 1) return '어제'
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  interface Props {
    messages: ChatMessage[]
    currentUserId: string
    isAdmin?: boolean
    /** 이전(더 오래된) 메시지가 더 남아있는지 — 위로 스크롤 시 로딩 트리거 표시용 */
    hasMoreOlder?: boolean
    /** 부모가 이전 메시지 조회 중일 때 true — 중복 트리거 방지 + 상단 로딩 표시 */
    isLoadingOlder?: boolean
    /** 위로 스크롤해 상단 근처에 도달하면 호출 — 부모가 이전 페이지를 불러와 messages 앞에 prepend */
    onloadmore?: () => void
    onaction?: (payload: ActionPayload) => void
    ondelete?: (messageId: string) => void
    onbookmark?: (messageId: string) => void
    /** COUPON_GIFT_CARD 승인·거절 콜백 */
    oncouponapprove?: (messageId: string, reject: boolean) => void
    /** 관리자 CTA 레이어 모달 오픈 요청 — AdminChatPanel 최상위에서 렌더링하기 위해 위로 전달 */
    onctamodal?: (info: CtaModalRequest) => void
  }

  let {
    messages,
    currentUserId,
    isAdmin = false,
    hasMoreOlder = false,
    isLoadingOlder = false,
    onloadmore,
    onaction,
    ondelete,
    onbookmark,
    oncouponapprove,
    onctamodal,
  }: Props = $props()

  let listEl = $state<HTMLDivElement | null>(null)
  // 실제 버블들을 담는 내부 wrapper — 이 요소의 콘텐츠 크기 변화(이미지·폰트 로드 등으로 인한
  // 지연 레이아웃 포함)를 ResizeObserver로 감지하기 위해 listEl(스크롤 컨테이너)과 분리함.
  // listEl 자신은 flex:1로 고정 크기라 내부 콘텐츠가 커져도 ResizeObserver가 반응하지 않음.
  let innerEl = $state<HTMLDivElement | null>(null)
  // 사용자가 과거 대화를 읽으려 위로 스크롤한 상태가 아니면(=바닥 근처) 계속 바닥에 고정
  let stickToBottom = $state(true)
  const BOTTOM_THRESHOLD = 80
  const TOP_LOAD_THRESHOLD = 80

  // 위로 스크롤해 이전 메시지 로딩을 트리거했을 때만 true — messages 변경 effect가
  // "새 메시지 도착(하단 고정)"과 "이전 메시지 prepend(스크롤 위치 보존)"를 구분하는 용도
  let awaitingOlderMessages = false
  let preLoadScrollHeight = 0
  let preLoadScrollTop = 0

  // 세션을 열 때 "위에서부터 로딩되는 것처럼 보이는" 플래시 완전 차단용 — 최초 스크롤 보정이
  // 끝나기 전까지는 목록 자체를 안 보이게 숨긴다(카카오톡 등은 이 방식으로 초기 위치를 감춤).
  // 세션 전환마다 컴포넌트가 새로 마운트되므로 매번 false로 리셋됨 — 세션마다 재적용.
  let isPositioned = $state(false)

  // 카카오톡 등 메신저 앱과 동일하게 세션을 여는 즉시 바닥에 확실히 붙이기 위한 다중 프레임 보정.
  // 레이아웃 미확정(패널 마운트 직후 높이 계산 전)·이미지/폰트 지연 로딩·리렌더 타이밍 등
  // 단일 스냅샷으로는 못 잡는 모든 경우를 브루트포스로 흡수한다(10프레임 ≈ 160ms, 각 프레임마다
  // stickToBottom이 풀렸으면 즉시 중단 — 사용자가 그 사이 위로 스크롤하면 강제로 안 끌어내림).
  function pinToBottomAcrossFrames(): void {
    let frames = 0
    function tick() {
      if (!listEl || !stickToBottom) return
      listEl.scrollTop = listEl.scrollHeight
      frames += 1
      if (frames < 10) requestAnimationFrame(tick)
    }
    tick()
  }

  // 세션을 처음 여는 순간(마운트)만 무조건 바닥으로 고정한다 — 이후(예: 과거 대화를 읽는 중
  // 실시간으로 새 메시지가 도착)에는 사용자가 이미 바닥 근처에 있을 때만 따라 내려간다.
  // 예전엔 messages.length가 바뀔 때마다 무조건 stickToBottom=true로 강제 리셋해버려서,
  // 위로 스크롤해 지난 대화를 보는 도중 새 메시지가 하나라도 오면 화면이 강제로 바닥까지
  // 끌려 내려가 "위로 스크롤이 안 먹는다"는 심각한 UX 오류로 나타났음(2026-08-15 Stephen 리포트).
  let hasInitialized = false

  // 메시지 배열이 바뀔 때마다: prepend였으면 스크롤 위치 보존, 최초 오픈이면 무조건 하단 고정,
  // 그 외(새 메시지 도착 등)는 사용자가 이미 바닥에 있을 때만 따라 내려감
  $effect(() => {
    // messages 참조로 반응성 트리거
    void messages.length
    if (!listEl) return
    if (awaitingOlderMessages) {
      awaitingOlderMessages = false
      // .message-list에 scroll-behavior:smooth를 걸지 않으므로 이 대입은 항상 즉시 이동
      // — 애니메이션 없이 정확한 위치로 복원되어 화면이 튀지 않음
      listEl.scrollTop = listEl.scrollHeight - preLoadScrollHeight + preLoadScrollTop
      return
    }
    if (!hasInitialized) {
      hasInitialized = true
      stickToBottom = true
      pinToBottomAcrossFrames()
      isPositioned = true
      return
    }
    if (stickToBottom) pinToBottomAcrossFrames()
  })

  // 세션을 열 때 상품카드·첨부이미지 등이 뒤늦게 로드되며 목록 실제 높이가 위 effect의
  // scrollHeight 스냅샷 이후에도 계속 커질 수 있음(진짜 바닥보다 위에서 멈춰 보이는 원인) —
  // innerEl(콘텐츠 wrapper)의 크기 변화를 ResizeObserver로 직접 관찰해 바닥 고정 상태일 때마다
  // 재보정한다. observe() 호출 시 최초 1회도 자동 발동되어 초기 레이아웃 확정 후 재확인도 겸함.
  $effect(() => {
    if (!listEl || !innerEl) return
    const el = listEl
    const ro = new ResizeObserver(() => {
      if (stickToBottom) el.scrollTop = el.scrollHeight
    })
    ro.observe(innerEl)
    return () => ro.disconnect()
  })

  $effect(() => {
    if (!listEl) return
    const el = listEl
    function handleScroll() {
      stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
      if (!awaitingOlderMessages && hasMoreOlder && !isLoadingOlder && el.scrollTop < TOP_LOAD_THRESHOLD) {
        awaitingOlderMessages = true
        preLoadScrollHeight = el.scrollHeight
        preLoadScrollTop = el.scrollTop
        onloadmore?.()
        // 안전망: 결과가 0건이라 messages.length가 안 바뀌면 위 effect가 못 돌아 플래그가
        // 영구히 걸려있을 수 있음 — 일정 시간 후 자동 해제해 다음 스크롤 트리거를 막지 않음
        setTimeout(() => { awaitingOlderMessages = false }, 5000)
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  })
</script>

<div
  class="message-list"
  class:positioned={isPositioned}
  bind:this={listEl}
  role="log"
  aria-live="polite"
  aria-label="채팅 메시지 목록"
>
  {#if messages.length === 0}
    <div class="empty-state">
      <p>무엇이든 물어보세요!</p>
      <p class="empty-sub">촬영장비 렌탈에 관해 궁금한 점을 남겨주세요.</p>
    </div>
  {:else}
    <div class="message-list-inner" bind:this={innerEl}>
      {#if isLoadingOlder}
        <p class="load-older-status">이전 대화 불러오는 중...</p>
      {/if}
      {#each messages as message, i (message.id)}
        {#if i === 0 || !isSameLocalDay(messages[i - 1].created_at, message.created_at)}
          <div class="date-divider" role="separator">
            <span class="date-divider-badge">{formatDateDivider(message.created_at)}</span>
          </div>
        {/if}
        <MessageBubble
          {message}
          isOwn={currentUserId === 'admin'
            ? message.sender_type === 'admin'
            : message.sender_type === 'user'}
          {isAdmin}
          {onaction}
          {ondelete}
          {onbookmark}
          {oncouponapprove}
          {onctamodal}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Figma node 2497:8699 — chat list */
  .message-list {
    display: flex;
    flex-direction: column; /* .empty-state의 flex:1 중앙정렬용 — 콘텐츠 유무와 무관하게 유지 */
    padding: 20px;
    flex: 1 0 0;
    overflow-y: auto;
    width: 100%;
    min-height: 0;
    /* ⚠️ scroll-behavior:smooth 절대 금지 — Chrome/Firefox는 scrollTo()뿐 아니라
       el.scrollTop = x 직접 대입에도 이 값을 적용해 애니메이션시킨다(스펙 통합 이후 동작).
       이 컴포넌트의 모든 scrollTop 대입은 "즉시 보정"(초기 바닥 고정·prepend 위치 복원)
       목적이라, smooth가 걸려 있으면 그 보정 자체가 눈에 보이는 "위→아래 스크롤 애니메이션"
       으로 노출된다 — 아래 visibility 차단 로직과 별개로 실제 재현되던 근본 원인이었음
       (2026-08-15). 스크롤 애니메이션이 필요하면 반드시 호출부에서 scrollTo({behavior:'smooth'})
       처럼 명시적으로만 사용할 것 — 컨테이너 전역 CSS로 걸지 않는다. */
    /* 최초 스크롤 위치가 확정되기 전(위에서부터 보이는 플래시) 숨김 — 위치 확정 즉시 visible 전환 */
    visibility: hidden;
  }
  .message-list.positioned {
    visibility: visible;
  }

  /* 실제 버블들의 wrapper — ResizeObserver가 이 요소의 콘텐츠 크기 변화를 감지(스크립트 참고) */
  .message-list-inner {
    display: flex;
    flex-direction: column;
    gap: 30px; /* Figma: gap-[30px] */
  }

  /* 스크롤바 스타일 */
  .message-list::-webkit-scrollbar {
    width: 4px;
  }
  .message-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .message-list::-webkit-scrollbar-thumb {
    background: var(--cs-points, #c1bbec);
    border-radius: 2px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 40px 20px;
    text-align: center;
  }

  .empty-state p {
    font: 700 16px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    margin: 0;
  }

  .empty-sub {
    font: 400 13px/1.5 'Noto Sans KR', sans-serif !important;
    color: var(--cs-text-mid, #777777) !important;
  }

  .load-older-status {
    margin: 0 0 -10px; /* 다음 버블과의 gap:30px 여백을 자연스럽게 흡수 */
    padding: 8px 0;
    text-align: center;
    font: 400 12px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaaaaa);
  }

  /* 날짜가 바뀌는 지점 구분 배지 — 카카오톡 등과 동일한 관례(오늘/어제/절대날짜) */
  .date-divider {
    display: flex;
    justify-content: center;
  }

  .date-divider-badge {
    padding: 4px 14px;
    border-radius: var(--radius-full, 9999px);
    background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text-mid, #777777);
    font: 700 12px/1.4 'Noto Sans KR', sans-serif;
  }
</style>
