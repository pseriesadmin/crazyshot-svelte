<script lang="ts">
  /**
   * ReservationProductFinderModal.svelte
   *
   * 예약 상품 구성 편집용 "상품찾기" 모달.
   * - 메인상품 추가 / 옵션상품 추가 양쪽에서 재사용 가능한 범용 피커.
   * - 선택 결과를 onselect 콜백으로만 노출 — 실제 DB 반영은 호출부(RentalDetailPanel)에서 처리.
   * - Stage 3 구현 (DB/API 변경 없음, 순수 UI)
   *
   * 참조:
   *   - 모달 레이아웃: ProductDetailPanel.svelte .option-modal 패턴
   *   - 카테고리 필터: cms-uiux.md §7-12-A (.cat-pill 표준)
   *   - 검색 인풋: cms-uiux.md §7-2 (.search-in 표준)
   *   - 이미지: image_url은 search-suggestions API가 반환하는 full URL (직접 사용)
   *
   * ⛔ 카테고리 목록은 $lib/utils/productCategoryTaxonomy.ts의 정적 배열을 쓰지 않는다(2026-09-03
   * 버그 수정 — 이전엔 그 파일을 썼으나 실제 등록 상품의 카테고리와 어긋나 있었음). 대신
   * /api/cms/products/category-options에서 "실제 등록된 상품이 쓰고 있는 카테고리"만 실시간
   * 조회한다 — 그 엔드포인트의 상단 주석에 이유가 상세히 설명돼 있다.
   *
   * 2026-09-03(옵션상품 추가 UX 개선, Stephen 지시): 옵션상품 추가 목적(baseProductId 전달)일
   * 때는 그 기본상품에 이미 카탈로그 수준으로 연동된 옵션상품(product_option_links, 고객
   * 상세페이지가 예약 시 보여주는 것과 동일한 목록)을 "추천 옵션상품" 섹션으로 최상단에
   * 먼저 보여준다 — 일반 검색은 그 아래 그대로 유지(연동 안 된 상품도 여전히 선택 가능해야
   * 하므로 검색을 없애지 않음).
   */

  // ── 타입 ─────────────────────────────────────────────────────────────────────

  interface CategoryOption {
    value: string
    label: string
  }

  interface ProductResult {
    id: string
    name: string
    brand: string | null
    category: string | null
    product_code: string | null
    image_url: string | null
    slug: string | null
    price_24h: number | null
  }

  interface SuggestedOption {
    id: string
    name: string
    image_url: string | null
    price_24h: number | null
    is_required: boolean
  }

  export interface FinderSelectedProduct {
    id: string
    name: string
    product_code: string | null
    image_url: string | null
    price_24h: number | null
  }

  interface Props {
    open: boolean
    onclose: () => void
    onselect: (product: FinderSelectedProduct) => void
    /** 옵션상품 추가 목적일 때만 전달 — 이 상품(부모/자식 무관)에 연동된 옵션상품을
     *  "추천 옵션상품"으로 상단에 먼저 보여준다. 메인상품 추가 목적일 때는 생략(일반 검색만). */
    baseProductId?: string | null
  }

  // ── Props ─────────────────────────────────────────────────────────────────────

  let { open, onclose, onselect, baseProductId = null }: Props = $props()

  // ── 상태 ──────────────────────────────────────────────────────────────────────

  let query = $state('')
  let selectedCategory = $state('')
  let results = $state<ProductResult[]>([])
  let loading = $state(false)

  // 카테고리 목록 — 실제 등록 상품 기준 실시간 조회(정적 하드코딩 금지, 위 헤더 주석 참고)
  let categoryOptions = $state<CategoryOption[]>([])
  let categoryLabelMap = $derived<Record<string, string>>(
    Object.fromEntries(categoryOptions.map((c) => [c.value, c.label]))
  )
  let categoriesFetchedOnce = false

  $effect(() => {
    if (!open || categoriesFetchedOnce) return
    categoriesFetchedOnce = true
    fetch('/api/cms/products/category-options')
      .then(async (res) => {
        if (!res.ok) return
        const d = await res.json() as { categories?: CategoryOption[] }
        categoryOptions = Array.isArray(d.categories) ? d.categories : []
      })
      .catch(() => { /* 조회 실패 시 "전체"만 노출 — 하드코딩 폴백 없음 */ })
  })

  // 추천 옵션상품(product_option_links) — baseProductId가 있을 때만, 값이 바뀔 때마다 재조회
  let suggestedOptions = $state<SuggestedOption[]>([])
  let suggestedLoading = $state(false)
  let suggestedFetchedForId: string | null = null

  $effect(() => {
    if (!open || !baseProductId) return
    if (suggestedFetchedForId === baseProductId) return
    suggestedFetchedForId = baseProductId
    suggestedOptions = []
    suggestedLoading = true
    fetch(`/api/cms/products/${baseProductId}/option-links`)
      .then(async (res) => {
        if (!res.ok) return
        const d = await res.json() as { options?: SuggestedOption[] }
        suggestedOptions = Array.isArray(d.options) ? d.options : []
      })
      .catch(() => { /* 실패 시 추천 섹션만 비고, 일반 검색은 그대로 사용 가능 */ })
      .finally(() => { suggestedLoading = false })
  })

  function selectSuggested(item: SuggestedOption): void {
    onselect({
      id: item.id,
      name: item.name,
      product_code: null,
      image_url: item.image_url,
      price_24h: item.price_24h,
    })
    onclose()
  }

  // ── 디바운스 검색 ──────────────────────────────────────────────────────────────

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let fetchController: AbortController | null = null

  $effect(() => {
    // 의존성 추적: query, selectedCategory
    const q = query
    const cat = selectedCategory

    // 기존 타이머/컨트롤러 정리
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (fetchController !== null) {
      fetchController.abort()
      fetchController = null
    }

    if (!q.trim()) {
      results = []
      loading = false
      return
    }

    loading = true

    debounceTimer = setTimeout(() => {
      const controller = new AbortController()
      fetchController = controller

      const params = new URLSearchParams({
        q: q.trim(),
        limit: '20',
        activeOnly: 'true',
      })
      if (cat) params.set('category', cat)

      fetch(`/api/cms/products/search-suggestions?${params}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            results = []
            return
          }
          const data = await res.json()
          // 배열 여부 안전 확인 (에러 응답 { error: ... } 방어)
          results = Array.isArray(data) ? (data as ProductResult[]) : []
        })
        .catch((err) => {
          // AbortError는 정상 취소 — 무시
          if (err instanceof Error && err.name !== 'AbortError') {
            results = []
          }
        })
        .finally(() => {
          if (fetchController === controller) {
            loading = false
            fetchController = null
          }
        })
    }, 300)

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (fetchController !== null) {
        fetchController.abort()
        fetchController = null
      }
    }
  })

  // 모달 닫힐 때 상태 초기화
  $effect(() => {
    if (!open) {
      query = ''
      selectedCategory = ''
      results = []
      loading = false
      suggestedOptions = []
      suggestedFetchedForId = null
    }
  })

  // ── 핸들러 ────────────────────────────────────────────────────────────────────

  function selectProduct(item: ProductResult): void {
    onselect({
      id: item.id,
      name: item.name,
      product_code: item.product_code,
      image_url: item.image_url,
      price_24h: item.price_24h,
    })
    onclose()
  }

  function handleBackdropKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
  }

  function handleModalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
  }
</script>

{#if open}
  <!-- 백드롭 -->
  <div
    class="finder-backdrop"
    onclick={onclose}
    onkeydown={handleBackdropKeydown}
    role="presentation"
  >
    <!-- 모달 -->
    <div
      class="finder-modal"
      role="dialog"
      aria-modal="true"
      aria-label="상품찾기"
      onkeydown={handleModalKeydown}
      onclick={(e) => e.stopPropagation()}
    >

      <!-- 헤더 -->
      <div class="finder-header">
        <p class="finder-title">상품찾기</p>
        <button
          type="button"
          class="finder-close"
          onclick={onclose}
          aria-label="닫기"
        >✕</button>
      </div>

      {#if baseProductId}
        <!-- 옵션상품 추가 모드: 카탈로그에 연동 설정된 옵션(product_option_links)으로만 제한
             — 일반 검색은 노출하지 않는다(Stephen 확정, 2026-09-03 — 기본상품과 무관한 임의
             상품이 옵션으로 붙는 정합성 위험을 원천 차단). 연동된 옵션이 없으면 그대로 빈 상태
             안내만 표시하고, 이 모달에서 일반 검색으로 대체 선택할 수 없다 — 옵션을 연동하려면
             먼저 그 상품의 등록 화면("옵션상품" 탭)에서 연동을 설정해야 한다. -->
        <div class="finder-results">
          {#if suggestedLoading}
            <p class="finder-empty">연동된 옵션상품 조회 중...</p>
          {:else if suggestedOptions.length === 0}
            <p class="finder-empty">이 상품에 연동된 옵션상품이 없습니다.<br />상품 등록 화면의 "옵션상품" 탭에서 먼저 연동해주세요.</p>
          {:else}
            <ul class="finder-list" role="list">
              {#each suggestedOptions as item (item.id)}
                <li class="finder-item">
                  {#if item.image_url}
                    <img src={item.image_url} alt={item.name} class="finder-thumb" width="56" height="56" loading="lazy" />
                  {:else}
                    <div class="finder-thumb finder-thumb--empty" aria-label="이미지 없음"><span aria-hidden="true">—</span></div>
                  {/if}
                  <div class="finder-info">
                    <p class="finder-name">{item.name}</p>
                    {#if item.is_required}
                      <p class="finder-meta">필수 옵션</p>
                    {/if}
                  </div>
                  <button type="button" class="finder-add" onclick={() => selectSuggested(item)} aria-label="{item.name} 추가">추가</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <!-- 메인상품 추가 모드: 카테고리 필터 + 일반 검색(§7-12-A/§7-2) -->
        <div class="cat-pills">
          <button
            type="button"
            class="cat-pill"
            class:active={selectedCategory === ''}
            onclick={() => { selectedCategory = '' }}
          >전체</button>
          {#each categoryOptions as opt (opt.value)}
            <button
              type="button"
              class="cat-pill"
              class:active={selectedCategory === opt.value}
              onclick={() => { selectedCategory = opt.value }}
            >{opt.label}</button>
          {/each}
        </div>

        <div class="finder-search-wrap">
          <input
            class="search-in"
            type="text"
            placeholder="상품명을 검색하세요"
            bind:value={query}
            aria-label="상품 검색"
          />
        </div>

        <div class="finder-results">
          {#if loading}
            <p class="finder-empty">검색 중...</p>
          {:else if !query.trim()}
            <p class="finder-empty">
              {selectedCategory
                ? `'${categoryLabelMap[selectedCategory] ?? selectedCategory}' 카테고리 내 상품명을 검색하세요.`
                : '상품명을 입력하면 검색 결과가 표시됩니다.'}
            </p>
          {:else if results.length === 0}
            <p class="finder-empty">검색 결과가 없습니다.</p>
          {:else}
            <ul class="finder-list" role="list">
              {#each results as item (item.id)}
                <li class="finder-item">
                  <!-- 썸네일 -->
                  {#if item.image_url}
                    <img
                      src={item.image_url}
                      alt={item.name}
                      class="finder-thumb"
                      width="56"
                      height="56"
                      loading="lazy"
                    />
                  {:else}
                    <div class="finder-thumb finder-thumb--empty" aria-label="이미지 없음">
                      <span aria-hidden="true">—</span>
                    </div>
                  {/if}

                  <!-- 상품 정보 -->
                  <div class="finder-info">
                    <p class="finder-name">{item.name}</p>
                    {#if item.brand || item.category}
                      <p class="finder-meta">
                        {#if item.category}{categoryLabelMap[item.category] ?? item.category}{/if}
                        {#if item.brand && item.category} · {/if}
                        {#if item.brand}{item.brand}{/if}
                      </p>
                    {/if}
                  </div>

                  <!-- 추가 버튼 (min 44px 터치 타겟) -->
                  <button
                    type="button"
                    class="finder-add"
                    onclick={() => selectProduct(item)}
                    aria-label="{item.name} 추가"
                  >추가</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

    </div>
  </div>
{/if}

<style>
  /* ── 백드롭 ──────────────────────────────────────────────────────────────── */
  .finder-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16, 11, 50, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── 모달 컨테이너 ────────────────────────────────────────────────────────── */
  .finder-modal {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px 28px;
    box-shadow: 0 4px 20px rgba(16, 11, 50, 0.2);
    overflow: hidden;
  }

  /* ── 헤더 ────────────────────────────────────────────────────────────────── */
  .finder-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .finder-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    margin: 0;
  }

  .finder-close {
    width: 32px;
    height: 32px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 14px;
    color: var(--cs-text-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s;
    flex-shrink: 0;
  }

  .finder-close:hover {
    background: rgba(255, 53, 53, 0.1);
    color: var(--cs-red-badge);
  }

  /* ── 카테고리 필터 pills (§7-12-A 상세패널형) ────────────────────────────── */
  .cat-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
  }

  .cat-pill {
    height: 34px;
    padding: 0 18px;
    border-radius: var(--radius-xl, 30px);
    border: none;
    background: var(--cs-lilac);
    font: 700 13px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .cat-pill.active {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .cat-pill:hover:not(.active) {
    color: var(--cs-purple);
  }

  /* ── 검색 인풋 (§7-2) ────────────────────────────────────────────────────── */
  .finder-search-wrap {
    flex-shrink: 0;
  }

  .search-in {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
  }

  .search-in::placeholder {
    color: var(--cs-text-placeholder);
  }

  .search-in:focus {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  /* ── 검색 결과 영역 ─────────────────────────────────────────────────────── */
  .finder-results {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .finder-empty {
    padding: 24px 0;
    text-align: center;
    color: var(--cs-text-light);
    font: var(--text-pc-script-12);
    margin: 0;
  }

  /* ── 결과 목록 ───────────────────────────────────────────────────────────── */
  .finder-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .finder-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    min-height: 44px; /* 터치 타겟 최소 보장 */
  }

  /* ── 썸네일 ──────────────────────────────────────────────────────────────── */
  .finder-thumb {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .finder-thumb--empty {
    background: var(--cs-lilac);
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* ── 상품 정보 ────────────────────────────────────────────────────────────── */
  .finder-info {
    flex: 1;
    min-width: 0;
  }

  .finder-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0 0 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .finder-meta {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* ── 추가 버튼 (min 44px 터치 타겟) ────────────────────────────────────── */
  .finder-add {
    flex-shrink: 0;
    height: 44px;
    min-width: 56px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }

  .finder-add:hover {
    background: var(--cs-purple-hover);
  }
</style>
