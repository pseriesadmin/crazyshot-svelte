<script lang="ts">
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { matchesSearch } from '$lib/utils/chosungSearch'
  import { extractProductId } from '$lib/utils/qrProductId'
  import { scrollPeek } from '$lib/utils/scrollPeek'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()

  let searchQuery = $state('')

  // 정렬·보기 옵션 (목록보기 / 썸네일형 병렬보기)
  // 상품 상세로 이동 후 되돌아오면 이 컴포넌트가 재마운트되며 $state 기본값으로 리셋되므로,
  // sessionStorage에 저장해 같은 탭 세션 동안 선택한 보기 방식이 유지되도록 함
  const VIEW_MODE_KEY = 'cms-mobile-view-mode'
  let viewMode = $state<'list' | 'grid'>(
    browser && sessionStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list'
  )
  let sortAsc = $state(true)

  $effect(() => {
    if (browser) sessionStorage.setItem(VIEW_MODE_KEY, viewMode)
  })

  // NLSearch(자연어검색엔진) 랭킹 — 필터링 자체는 기존 chosungSearch가 그대로 담당하고,
  // 검색어가 있을 때만 관련도 순으로 재정렬해 검색 기능성을 보강한다 (nlsearch.md §2 정본 재사용).
  let nlRankIds = $state<string[] | null>(null)
  let nlSearchTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const q = searchQuery.trim()
    if (!browser) return
    clearTimeout(nlSearchTimer)
    if (!q) {
      nlRankIds = null
      return
    }
    nlSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cms/mobile-search-rank?q=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const body = await res.json()
        nlRankIds = Array.isArray(body.ids) ? body.ids : null
      } catch {
        // 네트워크 실패 시 기존 chosung 필터 결과만 사용 (조용히 무시)
      }
    }, 250)
  })

  const filtered = $derived.by(() => {
    const base = data.products.filter(p => matchesSearch({ name: p.name, product_code: p.product_code }, searchQuery))
    const q = searchQuery.trim()

    if (q && nlRankIds && nlRankIds.length > 0) {
      const rankOrder = new Map(nlRankIds.map((id, i) => [id, i]))
      return base.slice().sort((a, b) => {
        const ra = rankOrder.has(a.id) ? rankOrder.get(a.id)! : Infinity
        const rb = rankOrder.has(b.id) ? rankOrder.get(b.id)! : Infinity
        if (ra !== rb) return ra - rb
        return a.name.localeCompare(b.name, 'ko')
      })
    }

    return base.slice().sort((a, b) => sortAsc ? a.name.localeCompare(b.name, 'ko') : b.name.localeCompare(a.name, 'ko'))
  })

  function toggleSort(): void {
    sortAsc = !sortAsc
  }

  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.includes('/large_')) return first.replace('/large_', '/thumb_')
    return first
  }

  // ── QR 스캐너 ──────────────────────────────────────────
  let showQrScanner = $state(false)

  // 플로팅 메뉴 스크롤 인터랙션 — 업스크롤 시 절반 숨김, 다운스크롤 시 튀어나오며 노출
  let fabPeek = $state(false)

  function handleQrDetected(raw: string): boolean {
    const id = extractProductId(raw)
    if (!id) return false
    goto(`/cms/mobile/qr/${id}`)
    return true
  }
</script>

<div class="mob-page">
  <div class="search-wrap">
    <input
      type="search"
      class="search-input"
      placeholder="상품명·자음·품번 검색 (예: 소니, ㅅㄴ, CAM)"
      bind:value={searchQuery}
      aria-label="상품 검색"
    />
  </div>

  {#if data.products.length >= 200}
    <div class="limit-notice" role="alert">최대 200개까지 표시됩니다.</div>
  {/if}

  <div class="list-toolbar">
    <button
      type="button"
      class="toolbar-btn"
      onclick={toggleSort}
      aria-label={sortAsc ? '이름순 오름차순 정렬 중 — 클릭 시 내림차순' : '이름순 내림차순 정렬 중 — 클릭 시 오름차순'}
      title="정렬"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <rect width="30" height="30" rx="15" fill="rgba(59,47,138,0.08)"/>
        <path d="M12.999 12V21L9 16.7651M17 18V9L21 13.2349"
          stroke="#3B2F8A"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="toolbar-view-group" role="group" aria-label="보기 방식 선택">
      <button
        type="button"
        class="toolbar-btn"
        onclick={() => (viewMode = 'list')}
        aria-pressed={viewMode === 'list'}
        aria-label="목록보기"
        title="목록보기"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <circle cx="15" cy="15" r="15" fill={viewMode === 'list' ? '#C1BBEC' : '#F6F6F6'}/>
          <path d="M10 12H20.5M10 18.7778H16.5"
            stroke={viewMode === 'list' ? '#3B2F8A' : '#AAAAAA'}
            stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        onclick={() => (viewMode = 'grid')}
        aria-pressed={viewMode === 'grid'}
        aria-label="썸네일형 병렬보기"
        title="썸네일형 병렬보기"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <circle cx="15" cy="15" r="15" fill={viewMode === 'grid' ? '#C1BBEC' : '#F6F6F6'}/>
          <rect x="6" y="11" width="8" height="8" rx="2.5" fill={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'}/>
          <rect x="16" y="11" width="8" height="8" rx="2.5" fill={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'}/>
        </svg>
      </button>
    </div>
  </div>

  {#if filtered.length === 0}
    <div class="no-data">검색 결과가 없습니다.</div>
  {:else if viewMode === 'grid'}
    <ul class="product-grid" role="list">
      {#each filtered as product (product.id)}
        <li>
          <button
            type="button"
            class="product-card"
            onclick={() => goto(`/cms/mobile/${product.id}`)}
          >
            <div class="product-card-thumb-wrap">
              {#if thumbUrl(product.image_urls)}
                <img
                  src={thumbUrl(product.image_urls)}
                  alt={product.name}
                  class="product-card-thumb"
                  loading="lazy"
                />
              {:else}
                <div class="product-thumb-placeholder" aria-hidden="true">📦</div>
              {/if}
            </div>
            <div class="product-card-info">
              <span class="product-name">{product.name}</span>
              {#if product.product_code}
                <span class="product-code">{product.product_code}</span>
              {/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="product-list" role="list">
      {#each filtered as product (product.id)}
        <li>
          <button
            type="button"
            class="product-item"
            onclick={() => goto(`/cms/mobile/${product.id}`)}
          >
            <div class="product-thumb-wrap">
              {#if thumbUrl(product.image_urls)}
                <img
                  src={thumbUrl(product.image_urls)}
                  alt={product.name}
                  class="product-thumb"
                  loading="lazy"
                />
              {:else}
                <div class="product-thumb-placeholder" aria-hidden="true">📦</div>
              {/if}
            </div>
            <div class="product-info">
              <span class="product-name">{product.name}</span>
              {#if product.product_code}
                <!-- products.md §2-1: 부모는 품번이 영구히 없는 게 정상 — 레거시 부모만 자체
                     product_code를 가짐. 없다고 "미발행"으로 표시하지 않음(발행 예정 아님) -->
                <span class="product-code">{product.product_code}</span>
              {/if}
            </div>
            <span class="product-arrow"><ChevronIcon /></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- 플로팅 아이콘 메뉴 그룹 (대여목록 + 카메라, 하단 우측 고정) -->
<div class="fab-group" class:peek={fabPeek} use:scrollPeek={(v) => (fabPeek = v)}>
  <button
    type="button"
    class="rental-list-fab"
    onclick={() => goto('/cms/mobile/rentals')}
    aria-label="대여 목록"
    title="대여 목록"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(16.5, 13.5)">
        <path d="M5.50195 0.552734V0H11.4268V0.552734C11.4269 0.0478777 11.4273 0.00376604 11.4277 0H11.4521C11.4617 0.000207732 11.4733 0.000442309 11.4854 0.000976562C11.5102 0.0020945 11.5413 0.00449327 11.5762 0.0078125C11.6461 0.0144915 11.7373 0.0265941 11.8418 0.0498047C12.0492 0.0959336 12.3309 0.18971 12.6162 0.379883C13.0867 0.693805 13.4563 1.19576 13.6133 1.9043C14.1644 1.95503 14.5826 2.04988 14.9473 2.23047C15.6296 2.56854 16.1845 3.10811 16.5322 3.77148C16.9275 4.52581 16.9277 5.51345 16.9277 7.48828V16.5166C16.9277 18.4914 16.9275 19.4791 16.5322 20.2334C16.1845 20.8969 15.6297 21.4363 14.9473 21.7744C14.1714 22.1587 13.1553 22.1592 11.124 22.1592H5.80371C3.77246 22.1592 2.75635 22.1588 1.98047 21.7744C1.29818 21.4363 0.743199 20.8968 0.395508 20.2334C0.000285467 19.4791 7.97912e-10 18.4913 0 16.5166V7.48828C1.06551e-08 5.51345 0.000185887 4.52581 0.395508 3.77148C0.743212 3.10806 1.29813 2.56857 1.98047 2.23047C2.34492 2.04993 2.7628 1.95507 3.31348 1.9043C3.47046 1.19536 3.8417 0.693827 4.3125 0.379883C4.59801 0.189565 4.87948 0.095915 5.08691 0.0498047C5.19155 0.0265825 5.28265 0.0144769 5.35254 0.0078125C5.38751 0.00448526 5.41847 0.00208781 5.44336 0.000976562C5.45551 0.000442312 5.46699 0.000207629 5.47656 0H5.50098C5.50145 0.00462108 5.50179 0.0532855 5.50195 0.552734ZM4.83594 15.6426C4.14581 15.6428 3.58602 16.2024 3.58594 16.8926C3.58595 17.5828 4.14576 18.1424 4.83594 18.1426H8.46289C9.15324 18.1426 9.71288 17.5829 9.71289 16.8926C9.7128 16.2023 9.15319 15.6426 8.46289 15.6426H4.83594ZM4.83594 10.752C4.14597 10.7522 3.58628 11.312 3.58594 12.002C3.58594 12.6922 4.14575 13.2518 4.83594 13.252H12.0908C12.781 13.2518 13.3408 12.6922 13.3408 12.002C13.3405 11.312 12.7808 10.7521 12.0908 10.752H4.83594ZM4.83594 5.8623C4.14581 5.86251 3.58602 6.42215 3.58594 7.1123C3.58594 7.80254 4.14575 8.3621 4.83594 8.3623H12.0908C12.781 8.36214 13.3408 7.80256 13.3408 7.1123C13.3407 6.42212 12.781 5.86247 12.0908 5.8623H4.83594Z" fill="white"/>
      </g>
    </svg>
  </button>

  <button
    type="button"
    class="qr-fab"
    onclick={() => (showQrScanner = true)}
    aria-label="QR 코드 스캔"
    title="상품 QR 스캔"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 50 50" fill="none" aria-hidden="true">
      <circle cx="25" cy="25" r="25" fill="#3B2F8A"/>
      <g transform="translate(14.6, 17)">
        <path d="M16.8008 0C19.0097 0.000212977 20.8008 1.79099 20.8008 4V12C20.8008 14.209 19.0097 15.9998 16.8008 16H4C1.79104 15.9998 0 14.209 0 12V4C0 1.79099 1.79104 0.000211051 4 0H16.8008ZM10.4004 4C8.19137 4 6.40059 5.79103 6.40039 8C6.4006 10.209 8.19138 12 10.4004 12C12.6094 12 14.4002 10.209 14.4004 8C14.4002 5.79103 12.6094 4 10.4004 4ZM16.8008 2.40039C15.9172 2.40039 15.2004 3.11651 15.2002 4C15.2004 4.88348 15.9173 5.60059 16.8008 5.60059C17.6841 5.60038 18.4002 4.88335 18.4004 4C18.4002 3.11664 17.6841 2.4006 16.8008 2.40039Z" fill="white"/>
      </g>
    </svg>
  </button>
</div>

<QrScannerOverlay
  bind:open={showQrScanner}
  onDetected={handleQrDetected}
  onClose={() => (showQrScanner = false)}
/>

<style>
  .mob-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    background: var(--cs-lilac);
  }

  .search-wrap {
    padding: 33px 14px 14px;
    background: var(--cs-lilac);
  }

  .search-input {
    width: 100%;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 15px 16px;
    font-size: 15px;
    color: var(--cs-text);
    height: 50px;
  }
  .search-input::placeholder { color: var(--cs-text-placeholder); }
  .search-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  .limit-notice {
    margin: 10px 16px 0;
    padding: 8px 12px;
    background: var(--cs-bg-warning);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--cs-text-warning);
  }

  .no-data {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--cs-text-light);
    padding: 48px 20px;
  }

  /* 정렬 · 보기방식 툴바 */
  .list-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 28px 21px 0;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--cs-text-mid);
    font-size: 13px;
    font-weight: 700;
    padding: 0;
    cursor: pointer;
    line-height: 0;
  }

  .toolbar-view-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .product-list {
    list-style: none;
    margin: 44px 0 0;
    padding: 0 12px 54px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  /* 썸네일형 병렬보기 (가로 최대 2개) */
  .product-grid {
    list-style: none;
    margin: 22px 0 0;
    padding: 0 12px 54px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .product-grid > li {
    min-width: 0;
  }

  .product-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 20px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    min-width: 0;
    transition: background 0.12s;
  }
  .product-card:active { background: rgba(59,47,138,0.06); }

  .product-card-thumb-wrap {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    overflow: hidden;
    background: var(--cs-surface-gray);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .product-card-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .product-card-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .product-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    padding: 25px 18px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    min-height: 64px;
    transition: background 0.12s;
  }
  .product-item:active { background: rgba(59,47,138,0.06); }

  .product-thumb-wrap {
    width: 81px;
    height: 81px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--cs-surface-gray);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .product-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .product-thumb-placeholder {
    font-size: 20px;
  }

  .product-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .product-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .product-code {
    font-size: 12px;
    color: var(--cs-text-mid);
  }

  .product-arrow {
    flex-shrink: 0;
  }

  /* ── QR FAB — 아이콘 SVG 자체에 원형 배경(#3B2F8A) 포함, 버튼은 크기·위치만 담당 ── */
  /* ── 플로팅 아이콘 메뉴 그룹 — 흰 캡슐 배경으로 두 FAB을 하나의 레이아웃으로 묶음 ── */
  .fab-group {
    position: fixed;
    bottom: 24px;
    right: 20px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px; /* 기존 8px의 2배 */
    transform: translateX(0);
  }
  /* 업스크롤 → peek(절반 숨김, 미세 감쇠) / 다운스크롤 → expand(팝아웃, 감쇠 스프링)
   * 표본 수치값 정본: .claude/rules/ui-mobile.md "그룹형 플로팅 메뉴(.fab-group) 감쇠
   * 스프링 바운스 표준" 참고 — duration은 기준값 대비 20% 단축(0.62s→0.5s, 0.28s→0.22s) */
  .fab-group:not(.peek) {
    animation: fab-pop-out 0.5s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  .fab-group.peek {
    animation: fab-peek-in 0.22s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
  }
  @keyframes fab-pop-out {
    0%   { transform: translateX(calc(50% + 20px)); }
    28%  { transform: translateX(-21px); }
    46%  { transform: translateX(10px); }
    61%  { transform: translateX(-5px); }
    73%  { transform: translateX(2.5px); }
    83%  { transform: translateX(-1.2px); }
    91%  { transform: translateX(0.6px); }
    100% { transform: translateX(0); }
  }
  @keyframes fab-peek-in {
    0%   { transform: translateX(0); }
    55%  { transform: translateX(65px); }
    78%  { transform: translateX(53px); }
    92%  { transform: translateX(58.5px); }
    100% { transform: translateX(calc(50% + 20px)); }
  }

  .qr-fab,
  .rental-list-fab {
    width: 75px;
    height: 75px;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }
  .qr-fab:hover, .rental-list-fab:hover   { transform: scale(1.06); }
  .qr-fab:active, .rental-list-fab:active { transform: scale(0.96); }
</style>
