<script lang="ts">
  // 찜 추가 직후 열리는 'MD 추천' 바텀 팝업(2026-11-18 Stephen 지시) — 루트 레이아웃에서 1개만 렌더링.
  // 열림 상태: $lib/stores/wishMdSheet.svelte. 내용: /products 의 MD 추천과 같은 상품(조회: GET /products/_md), 카드는 표준 ProductDPCard 'pick' 변형.
  // 닫기: 바깥(백드롭) 터치 · ✕ · 핸들을 잡아 아래로 끌기 · ESC. 모달은 transform 이 걸린 조상 밖(루트)에 둔다(position:fixed 충돌 방지).
  import { untrack } from 'svelte'
  import ProductDPCard from '$lib/components/products/ProductDPCard.svelte'
  import { wishMdSheet, closeWishMdSheet } from '$lib/stores/wishMdSheet.svelte'
  import { toggleWish } from '$lib/utils/wishlist'
  import type { CustomerBadge } from '$lib/types/badge'

  interface MdProduct {
    id: string
    name: string
    slug: string | null
    image_urls: string[] | null
    base_price_daily: number
    price_12h: number | null
    price_24h: number | null
    sale_only: boolean
    sale_price: number | null
  }
  interface MdPayload {
    products: MdProduct[]
    wishedIds: string[]
    productBadges: Record<string, CustomerBadge[]>
    productCardKeywords: Record<string, string[]>
    mdMobileImages: Record<string, string>
  }

  let payload = $state<MdPayload | null>(null)
  let loading = $state(false)
  let failed = $state(false)
  let wishedSet = $state<Set<string>>(new Set())
  let dialogEl = $state<HTMLDivElement | null>(null)

  async function load(): Promise<void> {
    if (loading) return
    loading = true
    failed = false
    try {
      const res = await fetch('/products/_md')
      if (!res.ok) throw new Error('md_fetch_failed')
      payload = (await res.json()) as MdPayload
      wishedSet = new Set(payload.wishedIds)
    } catch {
      failed = true
    } finally {
      loading = false
    }
  }

  // 열릴 때마다 최신 상태(방금 찜한 상품 반영)로 다시 조회하고 포커스를 시트로 옮긴다
  // load() 안에서 읽는 loading·payload 가 이 효과의 의존성으로 잡히면 조회가 끝날 때마다 다시 조회하는 반복이 생기므로 untrack 으로 감싼다(sp3 M1)
  $effect(() => {
    if (!wishMdSheet.open) return
    untrack(() => { void load() })
  })
  $effect(() => {
    if (wishMdSheet.open && dialogEl) dialogEl.focus()
  })

  // 열려 있는 동안 배경 스크롤 잠금
  $effect(() => {
    if (!wishMdSheet.open) return
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

  // 핸들을 잡아 아래로 끌어내리면 닫힘(ChatBottomSheet 와 같은 기준) — 조금만 내리고 놓으면 제자리 복귀
  const DRAG_CLOSE_DISTANCE = 100
  const DRAG_CLOSE_VELOCITY = 0.6
  const DRAG_CLOSE_MS = 250
  let dragY = $state(0)
  let dragging = $state(false)
  let settling = $state(false)
  let dragStartY = 0
  let lastMoveY = 0
  let lastMoveT = 0
  let velocity = 0
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    if (wishMdSheet.open) { dragY = 0; dragging = false; settling = false }
    return () => clearTimeout(closeTimer)
  })

  function onDragStart(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (settling) return
    dragging = true
    dragStartY = e.clientY
    lastMoveY = e.clientY
    lastMoveT = e.timeStamp
    velocity = 0
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: PointerEvent): void {
    if (!dragging) return
    dragY = Math.max(0, e.clientY - dragStartY)
    const dt = e.timeStamp - lastMoveT
    if (dt > 0) velocity = (e.clientY - lastMoveY) / dt
    lastMoveY = e.clientY
    lastMoveT = e.timeStamp
  }
  function onDragEnd(): void {
    if (!dragging) return
    dragging = false
    settling = true
    if (dragY > DRAG_CLOSE_DISTANCE || velocity > DRAG_CLOSE_VELOCITY) {
      dragY = dialogEl ? dialogEl.getBoundingClientRect().height : window.innerHeight
      closeTimer = setTimeout(closeWishMdSheet, DRAG_CLOSE_MS)
    } else {
      dragY = 0
      closeTimer = setTimeout(() => { settling = false }, DRAG_CLOSE_MS)
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeWishMdSheet()
  }
  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) closeWishMdSheet()
  }

  async function handleWish(id: string | undefined): Promise<void> {
    if (!id) return
    const action = await toggleWish(id)
    if (!action) return
    const next = new Set(wishedSet)
    if (action === 'added') next.add(id); else next.delete(id)
    wishedSet = next
  }
</script>

{#if wishMdSheet.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="wms-backdrop" onclick={onBackdropClick} aria-hidden="true"></div>

  <div
    class="wms-sheet"
    class:dragging
    class:settling
    role="dialog"
    aria-modal="true"
    aria-label="MD 추천"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={onKeydown}
    style:transform={dragY > 0 || settling ? `translateY(${dragY}px)` : undefined}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="wms-drag-zone" onpointerdown={onDragStart} onpointermove={onDragMove} onpointerup={onDragEnd} onpointercancel={onDragEnd}>
      <div class="wms-drag-handle" aria-hidden="true"></div>
    </div>

    <div class="wms-head">
      <span class="wms-title">MD 추천</span>
      <button type="button" class="wms-close close-red" onclick={closeWishMdSheet} aria-label="닫기">✕</button>
    </div>

    <div class="wms-body">
      {#if payload && payload.products.length > 0}
        <div class="wms-track">
          {#each payload.products as prod (prod.id)}
            {@const day = prod.price_24h ?? prod.base_price_daily}
            <ProductDPCard
              variant="pick"
              id={prod.id}
              name={prod.name}
              imageUrl={payload.mdMobileImages[prod.id] ?? prod.image_urls?.[0] ?? '/images/products/grid-flat.png'}
              price24h={day > 0 ? day : null}
              price12h={prod.price_12h || null}
              isSaleOnly={prod.sale_only}
              salePrice={prod.sale_price}
              href={`/products/${prod.slug ?? prod.id}`}
              wished={wishedSet.has(prod.id)}
              badges={payload.productBadges[prod.id] ?? []}
              cardKeywords={payload.productCardKeywords[prod.id] ?? []}
              onWishToggle={handleWish}
            />
          {/each}
        </div>
      {:else if loading && !payload}
        <p class="wms-note" role="status">불러오는 중…</p>
      {:else if failed}
        <p class="wms-note" role="alert">MD 추천을 불러오지 못했어요.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wms-backdrop {
    position: fixed;
    inset: 0;
    z-index: 210;                              /* 플로팅 바·채팅(200) 위 */
    background: rgba(16, 11, 50, 0);
    animation: wms-fade 0.2s ease forwards;
    touch-action: none;
  }
  @keyframes wms-fade { to { background: rgba(16, 11, 50, 0.45); } }

  .wms-sheet {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 211;
    margin: 0 auto;
    width: 100%;
    max-width: 720px;
    max-height: 85dvh;
    display: flex;
    flex-direction: column;
    background: var(--cs-white);
    border-radius: 30px 30px 0 0;             /* 모바일 대 반경(PC 50px × 0.60) */
    animation: wms-up 0.3s cubic-bezier(0.2, 0.9, 0.3, 1) both;
    outline: none;
  }
  .wms-sheet.dragging { transition: none; }
  .wms-sheet.settling { transition: transform 0.25s ease; }
  @keyframes wms-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @media (min-width: 768px) {
    .wms-sheet { border-radius: var(--radius-2xl) var(--radius-2xl) 0 0; }
  }

  .wms-drag-zone {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding: 12px 0 4px;
    touch-action: none;
    cursor: grab;
  }
  .wms-drag-handle { width: 44px; height: 5px; border-radius: var(--radius-full); background: var(--cs-lilac); }

  .wms-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 25px 12px;
  }
  .wms-title { font: var(--text-m-title-18B); color: var(--cs-text); }
  @media (min-width: 768px) {
    .wms-title { font: var(--text-pc-title-18); }
    .wms-head { padding: 12px 40px 16px; }
  }
  .wms-close {
    min-width: 44px; min-height: 44px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    color: var(--cs-red-badge);
    -webkit-tap-highlight-color: transparent;
  }
  .wms-close:hover { color: var(--cs-red); }

  .wms-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0 calc(24px + env(safe-area-inset-bottom));
  }
  .wms-track {
    display: flex;
    gap: 15px;
    overflow-x: auto;
    padding: 0 25px 8px;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  .wms-track::-webkit-scrollbar { display: none; }
  .wms-track > :global(*) { scroll-snap-align: start; flex-shrink: 0; }
  @media (min-width: 768px) {
    .wms-track { padding: 0 40px 8px; gap: 20px; }
  }
  .wms-note {
    margin: 0;
    padding: 24px 25px;
    font: var(--text-m-body-16B);
    color: var(--cs-text-light);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .wms-sheet, .wms-backdrop { animation-duration: 0.01ms; }
  }
</style>
