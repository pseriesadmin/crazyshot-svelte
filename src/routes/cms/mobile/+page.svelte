<script lang="ts">
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { matchesSearch } from '$lib/utils/chosungSearch'
  import { extractProductId } from '$lib/utils/qrProductId'
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
          <rect width="30" height="30" rx="15" fill={viewMode === 'list' ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
          <path d="M9 10h12M9 15h12M9 20h12"
            stroke={viewMode === 'list' ? '#3B2F8A' : '#AAAAAA'}
            stroke-width="2" stroke-linecap="round"/>
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
          <rect width="30" height="30" rx="15" fill={viewMode === 'grid' ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
          <rect x="9" y="9" width="5" height="5" rx="1"
            stroke={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'} stroke-width="2"/>
          <rect x="16" y="9" width="5" height="5" rx="1"
            stroke={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'} stroke-width="2"/>
          <rect x="9" y="16" width="5" height="5" rx="1"
            stroke={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'} stroke-width="2"/>
          <rect x="16" y="16" width="5" height="5" rx="1"
            stroke={viewMode === 'grid' ? '#3B2F8A' : '#AAAAAA'} stroke-width="2"/>
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

<!-- 대여목록 FAB (카메라 FAB 위, 하단 우측 고정) -->
<button
  type="button"
  class="rental-list-fab"
  onclick={() => goto('/cms/mobile/rentals')}
  aria-label="대여 목록"
  title="대여 목록"
>
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
</button>

<!-- 카메라 FAB (하단 우측 고정) -->
<button
  type="button"
  class="qr-fab"
  onclick={() => (showQrScanner = true)}
  aria-label="QR 코드 스캔"
  title="상품 QR 스캔"
>
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <!-- 카메라 본체 -->
    <rect x="2" y="7" width="24" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
    <!-- 렌즈 -->
    <circle cx="14" cy="15.5" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
    <!-- 뷰파인더 -->
    <rect x="10" y="4" width="8" height="3" rx="1.5" fill="currentColor"/>
    <!-- QR 힌트 점 -->
    <circle cx="6" cy="11" r="1.2" fill="currentColor"/>
  </svg>
</button>

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
    padding: 14px 21px 0;
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
    gap: 6px;
  }

  .product-list {
    list-style: none;
    margin: 22px 0 0;
    padding: 0 12px 54px;
    display: flex;
    flex-direction: column;
    gap: 14px;
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

  /* ── QR FAB ── */
  .qr-fab {
    position: fixed;
    bottom: 24px;
    right: 20px;
    z-index: 100;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(59,47,138,0.35);
    transition: background 0.15s, transform 0.15s;
  }
  .qr-fab:hover   { background: var(--cs-purple-hover); transform: scale(1.06); }
  .qr-fab:active  { transform: scale(0.96); }

  /* ── 대여목록 FAB (카메라 FAB보다 가벼운 시각적 무게: 흰 배경 + 퍼플 아웃라인) ── */
  .rental-list-fab {
    position: fixed;
    bottom: 96px; /* 24px(qr-fab bottom) + 56px(qr-fab height) + 16px gap */
    right: 20px;
    z-index: 100;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: var(--cs-white);
    color: var(--cs-purple);
    border: 1.5px solid var(--cs-purple);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(16,11,50,0.12);
    transition: background 0.15s, transform 0.15s;
  }
  .rental-list-fab:hover  { background: var(--cs-purple-pale); transform: scale(1.06); }
  .rental-list-fab:active { transform: scale(0.96); }
</style>
