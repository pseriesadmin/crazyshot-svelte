<script lang="ts">
  // CmsChatFab — CMS 본문 플로팅 채팅 아이콘 (2026-10-19, Stephen 지시: 프론트 채팅 아이콘 UI·기능 그대로 + 드래그 자석 배치 + 옆으로 펼치는 간추림 바)
  // UI: 프론트 FloatingButton(chat/FloatingButton.svelte)의 PC 규격 — 공통 ChatIcon 40px · 드롭섀도 · 호버 확대 · 미읽음 수량 배지 · 빨간 전파 링.
  // 기능: 누르면 응대가 필요한 대화의 "간추림 바"가 개수만큼 아이콘 옆(화면 안쪽 방향)에 세로로 나열된다. 바 사이 간격 6px, 아이콘과 바 화면상 간격 약 12px. 얇고 작은 바(아바타·전체보기 버튼 없음).
  //       아이콘은 드래그로 옮길 수 있고, 놓으면 화면의 네 꼭지점(좌상·우상·좌하·우하) 중 가장 가까운 곳에 여백을 두고 자석처럼 붙는다. 위치는 브라우저에 저장된다.
  import { goto } from '$app/navigation'
  import ChatIcon from '$lib/components/common/ChatIcon.svelte'
  import { formatInboxTime } from '$lib/utils/chatInbox'
  import { requestOpenInChatTab, CHAT_WINDOW_NAME } from '$lib/utils/cmsChatTabBridge'
  import type { ChatInboxItem } from '$lib/utils/cmsChatInbox.svelte'

  interface Props {
    count: number
    items: ChatInboxItem[]
    /** 첫 목록 조회가 끝났는지 — 처음 불러온 개수는 "새 대화"가 아니므로 바운스하지 않기 위함 */
    loaded: boolean
    onDismissEvent: (messageId: string) => void
  }

  let { count, items, loaded, onDismissEvent }: Props = $props()

  type Corner = 'tl' | 'tr' | 'bl' | 'br'
  const SIZE = 40            // 아이콘 크기(프론트 PC 규격)
  const MARGIN = 24          // 화면 가장자리 여백
  const TOP_SAFE = 110       // 상단 꼭지점의 y — 상단바·서브탭을 가리지 않는 위치
  const BAR_GAP_X = 0        // 아이콘 ↔ 바 가로 간격 — 바 목록 자체 여백(12px)이 더해져 화면상 간격은 약 12px
  const DRAG_THRESHOLD = 5
  const POS_KEY = 'cms-chat-fab-pos'

  let open = $state(false)
  let winW = $state(1280)
  let winH = $state(800)
  let corner = $state<Corner>('br')
  let dragging = $state(false)
  let dragX = $state(0)
  let dragY = $state(0)
  let stackH = $state(0)
  let didDrag = false

  const badgeLabel = $derived(count > 99 ? '99+' : String(count))
  const hasUnread = $derived(count > 0 && !open)

  // 응대가 필요한 대화가 있으면(화면을 열 때 이미 쌓여 있던 것 포함) 아이콘이 바운스·틸트하고,
  // 관리자가 아이콘을 선택(열기)하거나 대화가 모두 사라질 때까지 반복한다. 선택해서 확인한 뒤에는 새 대화가 더 늘어날 때만 다시 시작한다.
  let alerting = $state(false)
  let prevCount = 0
  let wasLoaded = false
  $effect(() => {
    const now = count
    if (!wasLoaded) {
      wasLoaded = loaded
      prevCount = now
      if (loaded && now > 0) alerting = true // 첫 조회 결과에 이미 응대 필요 대화가 있는 경우
      return
    }
    if (now > prevCount) alerting = true
    if (now === 0) alerting = false
    prevCount = now
  })
  $effect(() => {
    if (open) alerting = false
  })
  // 모션은 탭이 실제로 보일 때만 재생 — 숨겨진 탭에서는 멈췄다가 다시 보이면 처음부터 재생(모션 자체는 그대로)
  let pageVisible = $state(true)
  $effect(() => {
    const sync = () => { pageVisible = document.visibilityState !== 'hidden' }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  })
  const bouncing = $derived(alerting && !dragging && !open && pageVisible)

  // 저장된 위치 복원 — 이전 버전(가장자리+비율) 저장값은 가장 가까운 꼭지점으로 변환
  $effect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (!raw) return
      const v = JSON.parse(raw) as { corner?: Corner; edge?: string; along?: number }
      if (v.corner && ['tl', 'tr', 'bl', 'br'].includes(v.corner)) {
        corner = v.corner
      } else if (v.edge && typeof v.along === 'number') {
        const bottom = v.edge === 'bottom' || (v.edge !== 'top' && v.along >= 0.5)
        const right = v.edge === 'right' || (v.edge !== 'left' && v.along >= 0.5)
        corner = `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as Corner
      }
    } catch {
      // 저장소 차단·손상 시 기본 위치
    }
  })

  const maxX = $derived(Math.max(MARGIN, winW - SIZE - MARGIN))
  const maxY = $derived(Math.max(TOP_SAFE, winH - SIZE - MARGIN))

  // 꼭지점 → 화면 좌표
  const docked = $derived({
    x: corner === 'tl' || corner === 'bl' ? MARGIN : maxX,
    y: corner === 'tl' || corner === 'tr' ? TOP_SAFE : maxY,
  })
  const posX = $derived(dragging ? dragX : docked.x)
  const posY = $derived(dragging ? dragY : docked.y)

  // 바는 아이콘이 화면 오른쪽 절반이면 왼쪽으로, 왼쪽 절반이면 오른쪽으로 펼친다
  const barsOnLeft = $derived(posX + SIZE / 2 > winW / 2)
  const barsTop = $derived.by(() => {
    const centered = posY + SIZE / 2 - stackH / 2
    return Math.min(Math.max(12, centered), Math.max(12, winH - stackH - 12))
  })
  const barsMaxH = $derived(Math.max(120, winH - 24))

  let startPointer = { x: 0, y: 0, offX: 0, offY: 0 }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startPointer = { x: e.clientX, y: e.clientY, offX: e.clientX - posX, offY: e.clientY - posY }
    didDrag = false
  }

  function onPointerMove(e: PointerEvent): void {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    if (!dragging) {
      if (Math.hypot(e.clientX - startPointer.x, e.clientY - startPointer.y) < DRAG_THRESHOLD) return
      dragging = true
      didDrag = true
      open = false
    }
    dragX = Math.min(Math.max(0, e.clientX - startPointer.offX), winW - SIZE)
    dragY = Math.min(Math.max(0, e.clientY - startPointer.offY), winH - SIZE)
  }

  function onPointerUp(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (!dragging) return
    // 아이콘 중심이 화면의 어느 사분면에 있는지로 가장 가까운 꼭지점을 정한다(위쪽 기준선은 상단바 아래 TOP_SAFE~화면 하단의 중간)
    const cx = dragX + SIZE / 2
    const cy = dragY + SIZE / 2
    const right = cx > winW / 2
    const bottom = cy > (TOP_SAFE + maxY + SIZE) / 2
    corner = `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as Corner
    dragging = false
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ corner }))
    } catch {
      // 저장 실패는 이번 세션 위치만 유지
    }
  }

  function onClick(): void {
    if (didDrag) { didDrag = false; return } // 드래그 직후의 클릭은 열기로 보지 않는다
    open = !open
  }

  // 간추림 바 선택 — 채팅 대화 화면이 이미 열려 있는 브라우저 탭이 있으면 그 탭에서 해당 대화를 열고(앞으로 가져오기 시도),
  // 없으면 새 창(이후 같은 이름의 창 재사용)으로 연다. 이 탭은 현재 화면을 그대로 유지한다.
  async function openSession(item: ChatInboxItem): Promise<void> {
    if (item.kind === 'event') onDismissEvent(item.message_id)
    open = false
    const handled = await requestOpenInChatTab(item.session_id)
    if (!handled) window.open(`/cms/chat?session=${item.session_id}`, CHAT_WINDOW_NAME)
  }

</script>

<svelte:window
  bind:innerWidth={winW}
  bind:innerHeight={winH}
  onkeydown={(e) => { if (open && e.key === 'Escape') open = false }}
/>

{#if open}
  <div class="cms-fab-backdrop" onclick={() => (open = false)} role="presentation"></div>

  <div
    class="cms-fab-bars"
    class:cms-fab-bars-left={barsOnLeft}
    style:top="{barsTop}px"
    style:max-height="{barsMaxH}px"
    style:left={barsOnLeft ? 'auto' : `${posX + SIZE + BAR_GAP_X}px`}
    style:right={barsOnLeft ? `${winW - posX + BAR_GAP_X}px` : 'auto'}
    bind:clientHeight={stackH}
    role="dialog"
    aria-label="응대가 필요한 대화"
  >
    {#if items.length === 0}
      <p class="fab-bar fab-bar-empty">응대가 필요한 대화가 없습니다.</p>
    {:else}
      {#each items as item, idx (item.message_id)}
        <button type="button" class="fab-bar" style:--i={idx} onclick={() => openSession(item)}>
          <span class="fab-bar-body">
            <span class="fab-bar-line">
              <span class="fab-bar-name">{item.name}</span>
              {#if item.urgent}<span class="fab-bar-tag fab-bar-tag-urgent">긴급</span>{/if}
              {#if item.label}<span class="fab-bar-tag">{item.label}</span>{/if}
            </span>
            <span class="fab-bar-preview">{item.preview}</span>
          </span>
          <span class="fab-bar-time">{formatInboxTime(item.created_at)}</span>
        </button>
      {/each}
    {/if}
    {#if count > items.length}
      <p class="fab-bar-more">외 {count - items.length}건</p>
    {/if}
  </div>
{/if}

<div
  class="cms-fab"
  class:cms-fab-dragging={dragging}
  style:left="{posX}px"
  style:top="{posY}px"
>
  <div class="chat-fab-wrap" class:chat-fab-bounce={bouncing}>
    {#if hasUnread && pageVisible}
      <span class="ripple ripple-1" aria-hidden="true"></span>
      <span class="ripple ripple-2" aria-hidden="true"></span>
    {/if}

    <button
      type="button"
      class="fab-btn"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onclick={onClick}
      aria-label={open ? '채팅 알림 닫기' : `채팅 알림${count > 0 ? ` (응대 필요 ${count}건)` : ''} — 드래그해서 위치를 옮길 수 있습니다`}
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <ChatIcon size={SIZE} />
      {#if hasUnread}
        <span class="unread-badge" aria-hidden="true">{badgeLabel}</span>
      {/if}
    </button>
  </div>
</div>

<style>
  .cms-fab-backdrop { position: fixed; inset: 0; z-index: 150; background: transparent; }

  /* 본문 위 고정 — 모달(200대)보다 아래. 좌표는 인라인 style(left/top)로 지정, 놓았을 때 가장자리로 부드럽게 이동 */
  .cms-fab {
    position: fixed;
    z-index: 151;
    width: 40px;
    height: 40px;
    transition: left 0.22s ease, top 0.22s ease;
  }
  .cms-fab-dragging { transition: none; }

  /* 프론트 FloatingButton(.chat-fab-wrap / .fab-btn / .unread-badge / .ripple) PC 규격 동일 */
  .chat-fab-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 응대 필요 대화 알림 — 바운스 & 틸트(튀어 오르며 좌우로 기울임)를 1.8초 주기로 반복(앞 0.55초 동안 움직이고 나머지는 쉼). 아이콘을 선택하면 멈춘다 */
  .chat-fab-bounce { animation: fab-icon-bounce 1.8s cubic-bezier(0.28, 0.84, 0.42, 1) infinite; transform-origin: 50% 80%; }
  @keyframes fab-icon-bounce {
    0%   { transform: translateY(0) scale(1) rotate(0deg); }
    6%   { transform: translateY(-14px) scale(1.18) rotate(-14deg); }
    12%  { transform: translateY(0) scale(0.92) rotate(11deg); }
    18%  { transform: translateY(-6px) scale(1.07) rotate(-7deg); }
    24%  { transform: translateY(0) scale(0.98) rotate(3deg); }
    30%  { transform: translateY(0) scale(1) rotate(0deg); }
    100% { transform: translateY(0) scale(1) rotate(0deg); }
  }

  .fab-btn {
    background: none;
    border: none;
    outline: none;
    cursor: grab;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
    filter: drop-shadow(0 4px 10px rgba(16, 11, 50, 0.22));
    position: relative;
    z-index: 1;
    touch-action: none;
    user-select: none;
  }
  .fab-btn:hover  { transform: scale(1.07); }
  .fab-btn:active { transform: scale(0.95); cursor: grabbing; }

  .unread-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: var(--radius-full, 999px);
    background: var(--cs-red-badge, #FF3535);
    color: var(--cs-white, #fff);
    border: 1.5px solid var(--cs-white, #fff);
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
    pointer-events: none;
    box-sizing: border-box;
    z-index: 1;
  }

  .ripple {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2.5px solid color-mix(in srgb, var(--cs-red-badge, #FF3535) 80%, transparent);
    opacity: 0;
    pointer-events: none;
    animation: ripple-wave 2.4s ease-out infinite;
  }
  .ripple-2 { animation-delay: 0.8s; }

  @keyframes ripple-wave {
    0%   { transform: scale(1);    opacity: 0.7; }
    100% { transform: scale(1.65); opacity: 0; }
  }

  /* ── 간추림 바 목록 — 아이콘 옆(화면 안쪽)에 세로로 나열, 바 사이 6px. 작고 얇은 글자 토큰 ── */
  .cms-fab-bars {
    position: fixed;
    z-index: 152;
    width: 260px;
    max-width: calc(100vw - 100px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    padding: 12px;                /* 그림자가 스크롤 영역에서 잘리지 않도록 여유 */
    box-sizing: border-box;
  }

  .fab-bar {
    width: 100%;
    min-height: 40px;
    padding: 6px 12px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    box-shadow: 0 2px 8px rgba(16, 11, 50, 0.12);
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    color: var(--cs-text);
    cursor: pointer;
    box-sizing: border-box;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .fab-bar:hover { background: var(--cs-lilac); }

  /* 스케일 팝 + 바운스 — 아이콘 쪽에서 작게 시작해 크게 튀어 오른 뒤 감쇠 진동하며 안착. 바마다 50ms씩 순차 지연 */
  .cms-fab-bars { --pop-origin: left center; }
  .cms-fab-bars-left { --pop-origin: right center; }
  .fab-bar,
  .fab-bar-more {
    transform-origin: var(--pop-origin);
    animation: fab-bar-pop 0.5s ease-out both;
    animation-delay: calc(var(--i, 0) * 50ms);
  }
  @keyframes fab-bar-pop {
    0%   { transform: scale(0.4); opacity: 0; }
    40%  { transform: scale(1.14); opacity: 1; }
    58%  { transform: scale(0.94); }
    74%  { transform: scale(1.04); }
    88%  { transform: scale(0.99); }
    100% { transform: scale(1); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fab-bar,
    .fab-bar-more,
    .chat-fab-bounce,
    .ripple { animation: none; }
  }

  .fab-bar-empty {
    margin: 0;
    justify-content: center;
    font: var(--text-pc-script-12);
    line-height: 1.4;
    color: var(--cs-text-light);
    cursor: default;
  }
  .fab-bar-empty:hover { background: var(--cs-white); }

  .fab-bar-more {
    margin: 0;
    text-align: center;
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }

  .fab-bar-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .fab-bar-line { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .fab-bar-name {
    font: var(--text-pc-script-12);
    line-height: 1.4;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fab-bar-tag {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    font: var(--text-pc-descript-10);
    line-height: 1.6;
  }
  .fab-bar-tag-urgent { background: var(--cs-red-xlight); color: var(--cs-red-badge); }

  .fab-bar-preview {
    font: var(--text-pc-descript-10);
    line-height: 1.4;
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fab-bar-time { flex-shrink: 0; font: var(--text-pc-descript-10); color: var(--cs-text-light); }
</style>
