<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { enhance, deserialize } from '$app/forms'
  import { fly, slide } from 'svelte/transition'
  import { invalidateAll } from '$app/navigation'
  import ProductDetailPanel from '$lib/components/cms/ProductDetailPanel.svelte'
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
  import type { PageData } from './$types'
  import { csToast } from '$lib/utils/toast'
  import type { SelectedProductDetail } from '$lib/server/products/loadSelectedProductDetail'
  import { baseCodeDisplay } from '$lib/utils/baseCodeDisplay'

  interface Props { data: PageData }
  let { data }: Props = $props()

  // PERF-6: 상품 선택/해제(카드 클릭·패널 닫기)는 SvelteKit shallow routing(replaceState)으로
  // 처리 — goto()로 전체 load()를 재실행하던 기존 방식과 달리 목록/카테고리/집계 쿼리를
  // 다시 부르지 않고 loadSelectedProductDetail() 결과만 클라이언트에서 새로 받아온다.
  // 탭 저장·토글·삭제 등 invalidateAll() 기반 흐름은 완전히 그대로 유지됨(ProductDetailPanel
  // 무변경) — 그 경우 data 자체가 최신값으로 교체되므로 아래 activeDetail이 자동으로 반영한다.
  const EMPTY_DETAIL: SelectedProductDetail = {
    selectedProduct: null,
    selectedPriceRules: [],
    rootProduct: null,
    inventoryList: [],
    rootRentalStatusCounts: null,
  }

  function extractServerDetail(d: PageData): SelectedProductDetail {
    return {
      selectedProduct: d.selectedProduct,
      selectedPriceRules: d.selectedPriceRules,
      rootProduct: d.rootProduct,
      inventoryList: d.inventoryList,
      rootRentalStatusCounts: d.rootProduct ? (d.rentalStatusCounts?.[d.rootProduct.id] ?? null) : null,
    }
  }

  let overrideDetail = $state<SelectedProductDetail | 'loading' | null>(null)
  let fetchedForId = $state<string | null>(null)

  // page.state에 selectedId 키가 있으면 shallow-routing으로 전환된 선택(클라이언트 소스),
  // 없으면 마지막 실제 load() 결과(data.selectedId, 최초 진입·새로고침·딥링크·invalidateAll 등)
  const activeSelectedId = $derived(
    'selectedId' in page.state ? (page.state.selectedId ?? null) : data.selectedId
  )

  $effect(() => {
    const id = activeSelectedId
    if (id === data.selectedId) {
      // 서버가 이미 이 선택 기준으로 로드된 상태 — 별도 fetch 불필요(아래 activeDetail이
      // data를 직접 사용). invalidateAll() 이후에도 이 분기라 저장 직후 최신값이 자동 반영됨
      overrideDetail = null
      fetchedForId = null
      return
    }
    if (id === fetchedForId && overrideDetail !== null) return // 이미 조회 완료/진행 중인 id
    if (id === null) {
      overrideDetail = null
      fetchedForId = null
      return
    }
    overrideDetail = 'loading'
    fetchedForId = id
    fetch(`/cms/products/${id}/detail`)
      .then((r) => {
        if (!r.ok) throw new Error(`상세 조회에 실패했습니다 (status ${r.status})`)
        return r.json() as Promise<SelectedProductDetail>
      })
      .then((json) => {
        if (fetchedForId === id) overrideDetail = json
      })
      .catch((e) => {
        if (fetchedForId === id) {
          overrideDetail = null
          fetchedForId = null
          csToast.error(e instanceof Error ? e.message : '상세 조회에 실패했습니다.')
          // 조회 실패 시 URL(?selected=)만 남고 패널은 빈 채로 열린 상태가 되는 불일치를
          // 방지 — 명시적으로 패널을 닫아 선택 상태와 화면을 다시 맞춘다
          if (activeSelectedId === id) closePanel()
        }
      })
  })

  const activeDetail = $derived<SelectedProductDetail>(
    activeSelectedId === data.selectedId
      ? extractServerDetail(data)
      : (overrideDetail === 'loading' || overrideDetail === null ? EMPTY_DETAIL : overrideDetail)
  )

  const CATEGORIES = $derived([
    { value: 'all', label: '전체' },
    ...data.categories,
  ])

  // 카드 배지용: product_category 값 → 레이블 (depth=0 기준, 서버 제공)
  const CATEGORY_LABEL = $derived<Record<string, string>>(data.categoryLabels ?? {})

  let searchInput = $state(data.q)

  $effect(() => {
    searchInput = data.q
  })

  type SortMode = 'newest' | 'oldest' | 'asc' | 'desc'
  const SORT_CYCLE: SortMode[] = ['asc', 'desc', 'newest', 'oldest']
  const SORT_LABELS: Record<SortMode, string> = {
    asc: '오름순',
    desc: '내림순',
    newest: '최신 등록순',
    oldest: '과거 등록순',
  }

  function nextSort() {
    const current = data.sort as SortMode
    const idx = SORT_CYCLE.indexOf(current)
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]
    const params = new URLSearchParams(window.location.search)
    params.set('sort', next)
    params.delete('page')
    params.delete('selected')
    goto(`/cms/products?${params.toString()}`)
  }

  // 페이지네이션
  function goToPage(p: number) {
    const params = new URLSearchParams(window.location.search)
    params.set('page', p.toString())
    params.delete('selected')
    goto(`/cms/products?${params.toString()}`)
  }

  const panelOpen = $derived(!!activeDetail.rootProduct)
  let repBodyOpen = $state(true)

  // PERF-6: goto() 대신 shallow routing — URL은 그대로 갱신(공유·새로고침 가능)하되 load()
  // 전체 재실행 없이 위 $effect가 상세 데이터만 fetch한다.
  // ⚠️ pushState가 아닌 replaceState 사용 — 원본 코드가 goto(..., {replaceState:true})를 쓴
  // 이유(카드 클릭마다 브라우저 히스토리 항목이 쌓이면 "뒤로가기" 한 번으로 페이지를 벗어날 수
  // 없고 클릭한 횟수만큼 눌러야 하는 문제)를 그대로 승계해야 함 — pushState로 바꾸면 카드를
  // 여러 번 클릭할 때마다 히스토리가 쌓이는 회귀가 생김.
  function selectProduct(id: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('selected', id)
    replaceState(url, { selectedId: id })
  }

  function closePanel() {
    const url = new URL(window.location.href)
    url.searchParams.delete('selected')
    replaceState(url, { selectedId: null })
  }

  function onCategoryClick(value: string) {
    const params = new URLSearchParams()
    if (value !== 'all') params.set('category', value)
    if (searchInput) params.set('q', searchInput)
    if (data.sort !== 'newest') params.set('sort', data.sort)
    // page 리셋 (카테고리 변경 시 1페이지로)
    goto(`/cms/products?${params.toString()}`)
  }

  function runSearch(): void {
    const params = new URLSearchParams()
    if (data.category !== 'all') params.set('category', data.category)
    const q = searchInput.trim()
    if (q) params.set('q', q)
    if (data.sort !== 'newest') params.set('sort', data.sort)
    // page 리셋 (검색 시 1페이지로)
    goto(`/cms/products?${params.toString()}`)
  }

  function onSearch(e: Event) {
    e.preventDefault()
    runSearch()
  }

  function formatPrice(price: number | null): string {
    if (price == null) return '—'
    return price.toLocaleString('ko-KR') + '원'
  }


  function thumbUrl(imageUrls: string[]): string {
    const first = imageUrls[0]
    if (!first) return ''
    if (first.startsWith('http')) return first
    return `https://res.cloudinary.com/crazyshot/image/upload/w_108,h_108,c_fill,f_auto,q_auto/${first}.jpg`
  }

  // BND-REGWARN-2: 상품 등록 후 경고 코드 → 한글 설명 매핑 + 1회 toast 표시
  const REG_WARN_MSG: Record<string, string> = {
    qr:      'QR 코드 생성에 실패했습니다. 상품 상세에서 QR을 재생성하거나 관리자에게 문의하세요.',
    inv:     '재고(자식 상품) 자동 생성에 실패했습니다. 상품 상세 → 인벤토리에서 수동으로 추가하세요.',
    code:    '품번(product_code) 발행에 실패했습니다. 코드설정 → 품번 탭에서 확인 후 재발행하세요.',
    price:   '가격정책 저장에 실패했습니다. 상품 상세 → 가격정책 탭에서 다시 저장해주세요.',
    options: '옵션상품 연결 저장에 실패했습니다. 상품 상세 → 옵션상품 탭에서 다시 저장해주세요.',
    thumb:   '썸네일 이관이 실패해 원본 이미지를 대신 사용 중입니다. 이미지 탭에서 재업로드를 권장합니다.',
  }

  let regWarnShown = false
  $effect(() => {
    const warns = data.regWarn ?? []
    if (warns.length === 0 || regWarnShown) return
    regWarnShown = true
    for (const code of warns) {
      const msg = REG_WARN_MSG[code] ?? `등록 후 경고: ${code}`
      csToast.warning(msg)
    }
    // URL에서 regWarn 파라미터 제거 (새로고침 시 재노출 방지)
    const params = new URLSearchParams(window.location.search)
    params.delete('regWarn')
    const newUrl = params.toString() ? `/cms/products?${params.toString()}` : '/cms/products'
    goto(newUrl, { replaceState: true, noScroll: true })
  })

  // BND-4: 토글 실패 시 toast 경고 + 토글 상태 롤백 (invalidateAll로 서버 상태 복원)
  function handleToggle() {
    return async ({ result }: { result: { type: string; data?: { error?: string } } }) => {
      if (result.type === 'success') {
        await invalidateAll()
      } else {
        // 실패 시 서버 상태로 롤백
        const errMsg = (result as { data?: { error?: string } }).data?.error ?? '상태 변경에 실패했습니다.'
        csToast.error(errMsg)
        await invalidateAll()
      }
    }
  }

  // QR-4: 재고 다건 QR 일괄 인쇄
  let selectedInvIds = $state(new Set<string>())

  // QR-STALE-1: selectedInvIds가 rootProduct(대표 상품)와 무관하게 유지돼, 다른 상품으로
  // 이동해도 이전 상품에서 체크한 id가 그대로 남아있었다 — "선택 N개 QR 인쇄" 버튼은
  // 그 N을 계속 보여주는데 실제 화면 체크박스는 전부 비어있고, 클릭하면 현재 상품의
  // inventoryList에 그 id가 없어 "품번이 발행된 항목을 선택하세요" 경고만 뜨는 막다른 상태가
  // 됐음. 대표 상품이 바뀔 때만 선택을 초기화한다(같은 상품 내 invalidateAll/자식 재선택으로는
  // 유지되어야 하므로 rootProduct.id 변경 여부로만 판단).
  let lastRootProductId = $state<string | null>(null)
  $effect(() => {
    const currentRootId = activeDetail.rootProduct?.id ?? null
    if (currentRootId !== lastRootProductId) {
      selectedInvIds = new Set()
      lastRootProductId = currentRootId
    }
  })

  function toggleInvSelect(id: string) {
    const next = new Set(selectedInvIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedInvIds = next
    deleteInvPending = false // 선택이 바뀌면 삭제 무장 해제 — 다른 대상을 삭제하는 사고 방지
  }

  // INV-DEL-1: 선택 재고 일괄 삭제 — 기존 상품 삭제(handleDeleteProduct)와 동일한
  // "1차 클릭: 토스트 경고 후 무장 / 2차 클릭: 실제 삭제" 안전장치 재사용
  let deleteInvPending = $state(false)
  let isDeletingInv = $state(false)

  async function deleteSelectedInv() {
    if (!deleteInvPending) {
      deleteInvPending = true
      csToast.warning('한번 더 누르면 선택한 재고가 삭제됩니다.')
      return
    }
    isDeletingInv = true
    try {
      const fd = new FormData()
      fd.append('ids', Array.from(selectedInvIds).join(','))
      const res = await fetch('?/deleteSelectedInventory', { method: 'POST', body: fd })
      const result = deserialize(await res.text()) as { type: string; data?: { error?: string } }
      if (result.type !== 'success') {
        throw new Error(result.data?.error ?? `삭제 요청이 실패했습니다 (status ${res.status})`)
      }
      csToast.success(`${selectedInvIds.size}개 재고가 삭제됐습니다.`)
      selectedInvIds = new Set()
      await invalidateAll()
    } catch (e) {
      csToast.error(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    } finally {
      isDeletingInv = false
      deleteInvPending = false
    }
  }

  // QR-AUTO-1: '빠른 재고 등록'으로 생성된 재고는 몇 개든 즉시 QR 노출 영역(일괄 인쇄)에 반영
  // ⚠️ printSelectedQR()을 여기서 자동 호출하지 않는다 — form 제출 → invalidateAll 등 여러 await를
  // 거친 뒤 window.open()을 호출하면 사용자 제스처 유효기간이 끝나 브라우저가 거의 항상 팝업으로
  // 차단한다(등록은 성공했는데 매번 에러 토스트가 뜨는 원인이었음). 체크박스만 선택해두고, 실제
  // 인쇄창 열기는 이미 노출된 "선택 N개 QR 인쇄" 버튼의 직접 클릭에 맡긴다(그 클릭은 진짜 사용자
  // 제스처라 절대 차단되지 않음).
  // REFRESH-STALE-1(2026-08-25): 다른 상품을 먼저 shallow-routing으로 조회한 뒤(카드 클릭,
  // overrideDetail 경로) 그 화면에서 "빠른 재고 등록"을 실행하면, invalidateAll()이 진행되는
  // 동안 activeSelectedId가 원래 load() 기준 상품(data.selectedId, 이 경우와 무관한 다른
  // 상품에 멈춰 있을 수 있음)으로 잠시 되돌아가는 순간이 생긴다(콘솔 계측으로 직접 재현·확인).
  // 그 결과 방금 재고를 등록한 상품이 아니라 엉뚱한 상품의 패널이 뜨고, 정작 등록한 상품의
  // 재고 목록은 갱신되지 않는다(하단 선택 수량 배지만 정상 — selectedInvIds는 별도 상태라
  // 영향 없음). expectedProductId(ProductDetailPanel이 폼 제출 "시작 시점"에 고정해 넘겨주는
  // 값 — invalidateAll() 도중 재평가되는 reactive 참조가 아님)로 selectProduct()를 재호출해
  // 선택 상태를 명시적으로 복구한다(이미 정확히 그 상품이 선택된 상태면 멱등이라 안전).
  function handleInventoryCreated(ids: string[], expectedProductId: string) {
    selectedInvIds = new Set(ids)
    selectProduct(expectedProductId)
  }

  async function printSelectedQR() {
    const selected = (activeDetail.inventoryList ?? []).filter(
      (u: { id: string; product_code: string | null }) => selectedInvIds.has(u.id) && u.product_code
    )
    if (selected.length === 0) {
      csToast.warning('품번이 발행된 항목을 선택하세요.')
      return
    }
    const QRCode = (await import('qrcode')).default
    const items: Array<{ code: string; dataUrl: string }> = await Promise.all(
      selected.map(async (u: { id: string; product_code: string | null }) => ({
        code: u.product_code!,
        dataUrl: await QRCode.toDataURL(u.product_code!, {
          width: 160,
          margin: 2,
          color: { dark: '#100B32', light: '#FFFFFF' },
        }),
      }))
    )
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>QR 일괄 인쇄</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #fff; }
    .qr-grid { display: flex; flex-wrap: wrap; gap: 12px; padding: 16px; }
    .qr-item { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 1px solid #ddd; padding: 10px; border-radius: 8px; width: 180px; box-sizing: border-box; }
    .qr-img { width: 160px; height: 160px; display: block; }
    .qr-code { font-size: 11px; font-weight: 700; color: #100B32; text-align: center; word-break: break-all; }
    @media print { body { margin: 0; } .qr-grid { gap: 8px; padding: 8px; } }
  </style>
</head>
<body>
  <div class="qr-grid">
    ${items.map(({ code, dataUrl }) => `
      <div class="qr-item">
        <img class="qr-img" src="${dataUrl}" alt="${code}" />
        <span class="qr-code">${code}</span>
      </div>
    `).join('')}
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    } else {
      csToast.error('팝업이 차단됐습니다. 팝업 허용 후 다시 시도하세요.')
    }
  }
</script>

<svelte:head><title>상품목록 — CrazyShot CMS</title></svelte:head>

<div class="products-wrap">

  <!-- 카테고리 탭 -->
  <div class="cat-tabs" role="tablist" aria-label="상품 카테고리">
    {#each CATEGORIES as cat}
      <button
        role="tab"
        aria-selected={data.category === cat.value}
        class="cat-tab"
        class:active={data.category === cat.value}
        onclick={() => onCategoryClick(cat.value as string)}
        type="button"
      >{cat.label}</button>
    {/each}
  </div>

  <!-- 검색 + 등록 버튼 -->
  <div class="toolbar">
    <form class="search-form" onsubmit={onSearch}>
      <div class="search-field">
        <CmsSimilarNameInput
          id="product-search"
          bind:value={searchInput}
          source="product_search"
          minChars={1}
          overlayLayer={true}
          listLabel="상품 검색 제안"
          placeholder="상품명·브랜드·키워드 검색"
          categoryLabels={CATEGORY_LABEL}
          onselect={() => runSearch()}
        >
          {#snippet field(c)}
            <input
              type="search"
              class="f-input search-input"
              id={c.id}
              placeholder={c.placeholder}
              value={c.value}
              oninput={c.oninput}
              onkeydown={(e) => {
                c.onkeydown(e)
                if (e.key === 'Enter' && !e.defaultPrevented) {
                  e.preventDefault()
                  runSearch()
                }
              }}
              onfocus={c.onfocus}
              onblur={c.onblur}
              aria-label="상품 검색"
              aria-autocomplete={c.ariaAutocomplete}
              aria-expanded={c.ariaExpanded}
              aria-controls={c.ariaControls}
              autocomplete="off"
            />
          {/snippet}
        </CmsSimilarNameInput>
      </div>
    </form>
    <div class="tb-actions">
      <button
        type="button"
        class="sort-btn"
        onclick={nextSort}
        aria-label="정렬: {SORT_LABELS[data.sort as SortMode]}"
        title={SORT_LABELS[data.sort as SortMode]}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
          <rect width="30" height="30" rx="15" fill={data.sort !== 'newest' ? 'rgba(59,47,138,0.08)' : '#F6F6F6'}/>
          <path d="M12.999 12V21L9 16.7651M17 18V9L21 13.2349"
            stroke={data.sort !== 'newest' ? '#3B2F8A' : '#AAAAAA'}
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="sort-label" class:sort-label-active={data.sort !== 'newest'}>{SORT_LABELS[data.sort as SortMode]}</span>
      </button>
      <a href="/cms/products/new" class="cta-btn">+ 상품등록</a>
    </div>
  </div>

  <!-- 페이지네이션 상단 (검색 레이아웃과 카드목록 사이) -->
  <div class="pagination-row">
    <CmsPagination
      page={data.page}
      totalPages={data.totalPages}
      onpage={goToPage}
      variant="top"
      ariaLabel="상품 목록 페이지 탐색"
    />
    <span class="count-badge">총 {data.totalCount ?? 0}건</span>
  </div>

  <!-- 마스터-디테일 레이아웃 -->
  <div class="master-detail">

    <!-- 카드 목록 패널 -->
    <div class="list-pane" class:narrow={panelOpen}>

      {#if data.products.length === 0}
        <div class="empty-state">
          <p class="empty-msg">등록된 상품이 없습니다.</p>
          <a href="/cms/products/new" class="cta-btn">첫 상품 등록하기</a>
        </div>
      {:else}
        <div class="card-list" role="list">
          {#each data.products as product (product.id)}
            {@const rsc = data.rentalStatusCounts?.[product.id]}
            <div
              class="product-card"
              class:selected={activeSelectedId === product.id}
              role="listitem"
            >
              <!-- 카드 클릭 영역 (썸네일 + 정보) -->
              <button
                class="card-body"
                onclick={() => selectProduct(product.id)}
                aria-pressed={activeSelectedId === product.id}
                aria-label={`${product.name} 상세 보기`}
                type="button"
              >
                <!-- 썸네일 -->
                <div class="card-thumb-wrap">
                  {#if product.image_urls.length > 0}
                    <img
                      src={thumbUrl(product.image_urls)}
                      alt={product.name}
                      class="card-thumb"
                      width="60"
                      height="60"
                      loading="lazy"
                    />
                  {:else}
                    <div class="card-thumb-empty" aria-label="이미지 없음">📷</div>
                  {/if}
                </div>

                <!-- 상품 정보 -->
                <div class="card-info">
                  <div class="card-info-top">
                    <span class="cat-badge">{CATEGORY_LABEL[product.category] ?? product.category}</span>
                    {#if product.sale_only}<span class="sale-only-badge">판매전용</span>{/if}
                    <span class="stock-badge" class:stock-zero={product.assetCount === 0}>{product.assetCount}(on) / {product.assetTotal ?? 0}</span>
                  </div>
                  {#if rsc && (rsc.holding + rsc.outgoing + rsc.renting + rsc.returning + rsc.returned) > 0}
                    <div class="rs-row">
                      {#if rsc.holding > 0}<span class="rs-chip">예약중 {rsc.holding}</span>{/if}
                      {#if rsc.outgoing > 0}<span class="rs-chip">반출중 {rsc.outgoing}</span>{/if}
                      {#if rsc.renting > 0}<span class="rs-chip rs-chip--active">대여중 {rsc.renting}</span>{/if}
                      {#if rsc.returning > 0}<span class="rs-chip">반납중 {rsc.returning}</span>{/if}
                      {#if rsc.returned > 0}<span class="rs-chip rs-chip--done">반납완료 {rsc.returned}</span>{/if}
                    </div>
                  {/if}
                  <p class="card-name">{product.name}</p>
                  {#if product.brand}
                    <p class="card-brand">{product.brand}</p>
                  {/if}
                  <div class="card-bottom-row">
                    <div class="card-prices">
                      <span class="price-badge">12H {formatPrice(product.price12h)}</span>
                      <span class="price-badge">Day {formatPrice(product.price24h)}</span>
                    </div>
                  </div>
                </div>
              </button>

              <!-- 상태 토글 (카드 우측 하단) -->
              <div class="card-actions">
                <form
                  method="POST"
                  action="?/toggleStatus"
                  use:enhance={handleToggle}
                  class="toggle-form"
                >
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="is_active" value={product.is_active.toString()} />
                  <button
                    type="submit"
                    class="status-toggle"
                    class:on={product.is_active}
                    aria-label={product.is_active ? '미노출로 전환' : '노출로 전환'}
                    title={product.is_active ? '클릭하여 미노출' : '클릭하여 노출'}
                  >
                    <span class="toggle-track">
                      <span class="toggle-thumb"></span>
                    </span>
                  </button>
                </form>
              </div>
            </div>
          {/each}
        </div>

        <!-- 페이지네이션 하단 -->
        <CmsPagination
          page={data.page}
          totalPages={data.totalPages}
          onpage={goToPage}
          variant="bottom"
          ariaLabel="상품 목록 페이지 탐색 (하단)"
        />
      {/if}
    </div>

    <!-- 상세 뷰어 패널 -->
    {#if panelOpen && activeDetail.rootProduct}
      {@const rp = activeDetail.rootProduct}
      {@const isRootOpen = activeSelectedId === rp.id}
      {@const rpsc = activeDetail.rootRentalStatusCounts}
      {@const baseCode = baseCodeDisplay(rp)}
      <div class="detail-pane" transition:fly={{ x: 24, duration: 200 }}>

        <!-- 섹션 1: 대표 상품정보 등록관리 -->
        <div class="rep-section" class:rep-section--open={isRootOpen}>
          {#if isRootOpen}
            <button type="button" class="rep-close-btn" onclick={closePanel} aria-label="패널 닫기">✕</button>
          {/if}
          <button
            type="button"
            class="rep-header"
            onclick={() => {
              if (isRootOpen) { repBodyOpen = !repBodyOpen }
              else { repBodyOpen = true; selectProduct(rp.id) }
            }}
            aria-expanded={isRootOpen}
            aria-label="대표 상품정보 {isRootOpen ? '접기' : '펼치기'}"
          >
            <!-- 섹션 레이블 -->
            <span class="rep-section-label">대표 상품정보 등록관리</span>
            <!-- 미니 카드 -->
            <div class="rep-card">
              <div class="rep-card-thumb-wrap">
                {#if rp.image_urls.length > 0}
                  <img
                    src={thumbUrl(rp.image_urls)}
                    alt={rp.name}
                    class="rep-card-thumb"
                    width="108"
                    height="108"
                    loading="lazy"
                  />
                {:else}
                  <div class="rep-card-thumb-empty" aria-label="이미지 없음">📷</div>
                {/if}
              </div>
              <div class="rep-card-info">
                <div class="rep-card-top">
                  <span class="cat-badge">{CATEGORY_LABEL[rp.category] ?? rp.category}</span>
                  {#if rp.sale_only}<span class="sale-only-badge">판매전용</span>{/if}
                  <span class="stock-badge" class:stock-zero={rp.assetCount === 0}>{rp.assetCount}(on) / {rp.assetTotal ?? 0}</span>
                </div>
                <!-- QR-LABEL-1: QR만으로는 코드를 읽을 수 없어 기준 품번을 텍스트로 병기.
                     실제 채번값이 아닌 코드 구조 + 순번 '0'으로 재구성 표시(QR-LABEL-2) —
                     재고로 카운트되는 실제 자식 품번과 혼동 방지 -->
                {#if baseCode}
                  <p class="rep-card-code">기준 품번 <span class="rep-card-code-val">{baseCode}</span></p>
                {/if}
                {#if rpsc && (rpsc.holding + rpsc.outgoing + rpsc.renting + rpsc.returning + rpsc.returned) > 0}
                  <div class="rs-row">
                    {#if rpsc.holding > 0}<span class="rs-chip">예약중 {rpsc.holding}</span>{/if}
                    {#if rpsc.outgoing > 0}<span class="rs-chip">반출중 {rpsc.outgoing}</span>{/if}
                    {#if rpsc.renting > 0}<span class="rs-chip rs-chip--active">대여중 {rpsc.renting}</span>{/if}
                    {#if rpsc.returning > 0}<span class="rs-chip">반납중 {rpsc.returning}</span>{/if}
                    {#if rpsc.returned > 0}<span class="rs-chip rs-chip--done">반납완료 {rpsc.returned}</span>{/if}
                  </div>
                {/if}
                <p class="rep-card-name">{rp.name}</p>
                {#if rp.brand}<p class="card-brand">{rp.brand}</p>{/if}
                <div class="rep-card-prices">
                  <span class="price-badge">12H {formatPrice(rp.price12h)}</span>
                  <span class="price-badge">Day {formatPrice(rp.price24h)}</span>
                </div>
              </div>
              <svg class="rep-chevron" class:rep-chevron--open={isRootOpen && repBodyOpen}
                width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </button>
          <!-- 대표 상품 패널 (부모 선택 시) -->
          {#if isRootOpen && repBodyOpen && activeDetail.selectedProduct}
            <div class="rep-body" transition:slide={{ duration: 220 }}>
              {#key activeSelectedId}
                <ProductDetailPanel
                  product={activeDetail.selectedProduct}
                  priceRules={activeDetail.selectedPriceRules}
                  categories={data.categories}
                  categoryLabel={CATEGORY_LABEL[activeDetail.selectedProduct.category] ?? activeDetail.selectedProduct.category}
                  initialTab={data.initialTab}
                  inventoryList={activeDetail.inventoryList}
                  partnerComboItems={data.partnerComboItems}
                  rentalPeriods={data.rentalPeriods}
                  rentalMethods={data.rentalMethods}
                  pickupPoints={data.pickupPoints}
                  shippingSettings={data.shippingSettings}
                  rentalStatusCounts={activeDetail.rootRentalStatusCounts}
                  onclose={closePanel}
                  oninventorycreated={handleInventoryCreated}
                />
              {/key}
            </div>
          {/if}
        </div>

        <!-- 섹션 2: 실 상품코드 반영 목록 -->
        <div class="inv-section">
          {#if activeDetail.inventoryList && activeDetail.inventoryList.length > 0}
            <div class="inv-accordion">
              {#each activeDetail.inventoryList as unit, idx (unit.id)}
                {@const isActive = activeSelectedId === unit.id}
                <div class="inv-acc-item" class:inv-acc-item--active={isActive}>
                  <!-- 아코디언 헤더 행 -->
                  <div class="inv-acc-header">
                    <!-- QR-4: 개별 선택 체크박스 (품번 있는 항목만) -->
                    {#if unit.product_code}
                      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                      <span class="inv-check-wrap" onclick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          class="inv-check"
                          checked={selectedInvIds.has(unit.id)}
                          onchange={(e) => { e.stopPropagation(); toggleInvSelect(unit.id) }}
                          aria-label="{unit.product_code} QR 인쇄 선택"
                        />
                      </span>
                    {/if}
                    <button
                      type="button"
                      class="inv-acc-trigger"
                      onclick={() => selectProduct(unit.id)}
                      aria-expanded={isActive}
                      aria-label="{unit.product_code ?? '—'} {isActive ? '접기' : '펼치기'}"
                    >
                      <span class="inv-bar-index" class:inv-bar-index--active={isActive}>{idx + 1}</span>
                      <div class="inv-bar-left">
                        <div class="inv-bar-code-group">
                          <span class="inv-bar-label">품번</span>
                          <span class="inv-bar-code" class:inv-bar-code--active={isActive}>{unit.product_code ?? '—'}</span>
                        </div>
                        <span class="inv-bar-name">{unit.name}</span>
                      </div>
                      <!-- 펼침 화살표 -->
                      <svg
                        class="inv-acc-chevron"
                        class:inv-acc-chevron--open={isActive}
                        width="16" height="16" viewBox="0 0 16 16" fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <!-- 토글: 독립 영역 (클릭 전파 없음) -->
                    <form method="POST" action="?/toggleStatus" use:enhance={handleToggle}>
                      <input type="hidden" name="id" value={unit.id} />
                      <input type="hidden" name="is_active" value={unit.is_active.toString()} />
                      <button
                        type="submit"
                        class="inv-bar-toggle"
                        class:inv-bar-toggle--on={unit.is_active}
                        aria-label={unit.is_active ? '미노출로 전환' : '노출로 전환'}
                      >
                        <span class="inv-bar-thumb"></span>
                      </button>
                    </form>
                    {#if isActive}
                      <button type="button" class="inv-acc-close-btn" onclick={closePanel} aria-label="패널 닫기">✕</button>
                    {/if}
                  </div>
                  <!-- 아코디언 바디: 자식 상품 선택 시 (이력 탭만 편집 가능 — isChildProduct 자동 적용) -->
                  {#if isActive && activeDetail.selectedProduct}
                    <div class="inv-acc-body" transition:slide={{ duration: 220 }}>
                      {#key activeSelectedId}
                        <ProductDetailPanel
                          product={activeDetail.selectedProduct}
                          priceRules={activeDetail.selectedPriceRules}
                          categories={data.categories}
                          categoryLabel={CATEGORY_LABEL[activeDetail.selectedProduct.category] ?? activeDetail.selectedProduct.category}
                          initialTab={data.initialTab}
                          inventoryList={activeDetail.inventoryList}
                          partnerComboItems={data.partnerComboItems}
                          rentalPeriods={data.rentalPeriods}
                          rentalMethods={data.rentalMethods}
                          pickupPoints={data.pickupPoints}
                          shippingSettings={data.shippingSettings}
                          onclose={closePanel}
                          oninventorycreated={handleInventoryCreated}
                        />
                      {/key}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="inv-empty-notice">
              재고 미등록 상태입니다. 빠른재고등록으로 실 상품코드를 추가하세요.
            </div>
          {/if}
          <!-- QR-4/INV-DEL-1: 선택 항목 액션 바 — 목록 최하단, 체크 시에만 노출 -->
          {#if selectedInvIds.size > 0}
            <div class="inv-action-bar">
              <button type="button" class="inv-batch-print-btn" onclick={printSelectedQR}>
                선택 {selectedInvIds.size}개 QR 인쇄
              </button>
              <button
                type="button"
                class="inv-batch-delete-btn"
                class:inv-batch-delete-btn--pending={deleteInvPending}
                disabled={isDeletingInv}
                onclick={deleteSelectedInv}
              >{isDeletingInv ? '삭제 중...' : deleteInvPending ? '한번 더 누르면 삭제됩니다' : `${selectedInvIds.size}개 삭제`}</button>
            </div>
          {/if}
        </div>

      </div>
    {/if}

  </div>
</div>

<style>
  .products-wrap {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding: 20px 20px 48px;
  }

  /* 카테고리 탭 */
  .cat-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px;
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    flex-shrink: 0;
  }
  .cat-tab {
    padding: 6px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--cs-text-mid);
    font: var(--text-pc-body-14);
    cursor: pointer;
    min-height: 36px;
    transition: background 0.12s, color 0.12s;
  }
  .cat-tab:hover  { background: var(--cs-lilac); color: var(--cs-text); }
  .cat-tab.active { background: var(--cs-purple); color: var(--cs-white); }

  /* 툴바 */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    position: relative;
    z-index: 30;
  }
  .search-form {
    flex: 1;
    min-width: 0;
  }
  .search-field {
    flex: 1;
    min-width: 0;
    position: relative;
    z-index: 31;
  }
  .search-field :global(.search-input) {
    width: 100%;
    height: 44px;
    box-sizing: border-box;
    display: block;
  }
  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 0 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .tb-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .sort-btn {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    min-height: 44px;
    justify-content: center;
    opacity: 1;
    transition: opacity 0.12s;
  }
  .sort-btn:hover { opacity: 0.75; }
  .sort-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    white-space: nowrap;
    line-height: 1;
  }
  .sort-label-active { color: var(--cs-purple); }
  .cta-btn {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 30px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .cta-btn:hover { background: var(--cs-purple-hover); }

  /* 페이지네이션 상단 행 — CmsPagination은 그대로 중앙정렬 유지, 총 수량 배지만 우측 끝에 배치 */
  .pagination-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
  }
  .pagination-row .count-badge {
    position: absolute;
    right: 0;
  }
  /* CMS 표준 총 수량 배지 — /cms/reservation, /cms/rentals, /cms/customers/inquiry 등과 동일 패턴 */
  .count-badge {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    background: var(--cs-surface-gray);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }

  /* 마스터-디테일 */
  .master-detail {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  /* 카드 목록 패널 */
  .list-pane {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: width 0.22s ease;
  }
  .list-pane.narrow {
    width: 420px;
    flex-shrink: 0;
  }

  /* 카드 목록 */
  .card-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding-right: 4px;
  }
  /* 스크롤바 항상 표시 */
  .card-list::-webkit-scrollbar {
    width: 6px;
  }
  .card-list::-webkit-scrollbar-track {
    background: var(--cs-surface-gray);
    border-radius: 3px;
  }
  .card-list::-webkit-scrollbar-thumb {
    background: rgba(59,47,138,0.20);
    border-radius: 3px;
  }
  .card-list::-webkit-scrollbar-thumb:hover {
    background: rgba(59,47,138,0.35);
  }

  /* 상품 카드 */
  .product-card {
    display: flex;
    align-items: stretch;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    box-shadow: 0px 1px 2px rgba(0,0,0,0.06);
    transition: background 0.15s;
    flex-shrink: 0;
    overflow: hidden;
  }
  .product-card:hover { background: var(--cs-lilac); }
  .product-card.selected { background: rgba(59,47,138,0.06); }

  /* 카드 클릭 영역 */
  .card-body {
    display: flex;
    align-items: center;
    gap: 15px;
    flex: 1;
    min-width: 0;
    padding: 15px 0 15px 20px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  /* 썸네일 */
  .card-thumb-wrap {
    flex-shrink: 0;
    width: 60px;
    height: 60px;
    background: #E8E4F8;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card-thumb {
    width: 60px;
    height: 60px;
    object-fit: cover;
    display: block;
  }
  .card-thumb-empty {
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    color: var(--cs-text-light);
  }

  /* 카드 정보 */
  .card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .card-info-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cat-badge {
    display: inline-block;
    padding: 5px 10px;
    background: var(--cs-lilac);
    color: var(--cs-purple-dark);
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    white-space: nowrap;
  }
  .stock-badge {
    display: inline-block;
    padding: 5px 10px;
    background: #F3F4F6;
    color: var(--cs-text-mid);
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    white-space: nowrap;
  }
  .stock-badge.stock-zero {
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
  }
  .sale-only-badge {
    display: inline-block;
    padding: 5px 10px;
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    white-space: nowrap;
  }
  .card-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-brand {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: var(--cs-text-light);
    margin: 0;
  }
  .card-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .card-prices {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .price-badge {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }

  /* 카드 우측 하단 액션 (토글) */
  .card-actions {
    display: flex;
    align-items: flex-end;
    padding: 0 20px 15px 8px;
    flex-shrink: 0;
  }
  .toggle-form { display: flex; }
  .status-toggle {
    display: flex;
    align-items: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    min-height: 44px;
    min-width: 44px;
    justify-content: center;
  }
  .toggle-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--cs-disabled-toggle);
    border-radius: var(--cms-radius-sm);
    transition: background 0.18s;
    display: block;
    flex-shrink: 0;
    padding: 2px;
    box-sizing: border-box;
  }
  .status-toggle.on .toggle-track { background: var(--cs-purple); }
  .toggle-thumb {
    position: absolute;
    top: 2px; left: 2px;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.18s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18);
    display: block;
  }
  .status-toggle.on .toggle-thumb { transform: translateX(16px); }

  /* 빈 상태 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 60px 20px;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
  }
  .empty-msg {
    font: var(--text-pc-title-16);
    color: var(--cs-text-light);
  }

  /* 상세 패널 */
  .detail-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* 대표 상품정보 섹션 */
  .rep-section {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    border: 1.5px solid transparent;
    overflow: hidden;
    transition: border-color 0.15s;
    flex-shrink: 0;
  }
  .rep-close-btn {
    position: absolute;
    top: 10px;
    right: 14px;
    z-index: 2;
    flex-shrink: 0;
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .rep-close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .rep-section--open {
    border-color: var(--cs-purple);
  }
  .rep-header {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }
  .rep-header:hover { background: rgba(59,47,138,0.03); }
  .rep-section-label {
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-purple);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .rep-card {
    display: flex;
    align-items: center;
    gap: 27px;
  }
  .rep-card-thumb-wrap {
    flex-shrink: 0;
    width: 108px;
    height: 108px;
    background: #E8E4F8;
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rep-card-thumb {
    width: 108px;
    height: 108px;
    object-fit: cover;
    display: block;
  }
  .rep-card-thumb-empty {
    width: 108px;
    height: 108px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: var(--cs-text-light);
  }
  .rep-card-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rep-card-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rep-card-code {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .rep-card-code-val {
    font-weight: 700;
    color: var(--cs-purple);
  }
  .rep-card-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rep-card-prices { display: flex; align-items: center; gap: 6px; }
  .rep-chevron {
    color: var(--cs-text-light);
    flex-shrink: 0;
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s;
  }
  .rep-chevron--open {
    transform: rotate(180deg);
    color: var(--cs-purple);
  }
  .rep-body { overflow: hidden; }

  /* 실 상품코드 반영 목록 섹션 */
  .inv-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  /* QR-4/INV-DEL-1: 선택 항목 액션 바 — 목록 최하단, 스크롤 중에도 항상 보이도록 하단 고정.
     BG 박스 레이아웃 없이 버튼만 배치(cms-uiux.md §7-3 표준 버튼 토큰 그대로 사용) */
  .inv-action-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    position: sticky;
    bottom: 0;
    z-index: 5;
    padding-top: 8px;
  }
  /* QR-4: 일괄 인쇄 버튼 — cms-uiux.md §7-3 .btn-action(소형 인라인 액션) 표준 그대로 */
  .inv-batch-print-btn {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 10px 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.12s;
  }
  .inv-batch-print-btn:hover { background: var(--cs-purple-hover); }
  /* INV-DEL-1: 선택 삭제 버튼 — CMS 표준 삭제 버튼(텍스트형 btn-danger-sm) 색상·반경·폰트는
     그대로, 높이만 같은 액션 바의 .inv-batch-print-btn(34px)과 나란히 정렬되도록 맞춤 */
  .inv-batch-delete-btn {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-error, #E53E3E);
    border: none;
    border-radius: var(--cms-radius-sm);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  .inv-batch-delete-btn:hover:not(:disabled) { opacity: 0.8; }
  .inv-batch-delete-btn--pending { opacity: 0.8; }
  .inv-batch-delete-btn:disabled { opacity: 0.5; cursor: default; }
  /* QR-4: 체크박스 래퍼 */
  .inv-check-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0 4px 0 8px;
  }
  .inv-check {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--cs-purple);
  }
  .inv-empty-notice {
    padding: 20px 16px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    text-align: center;
  }

  /* 재고 아코디언 */
  .inv-accordion {
    display: flex;
    flex-direction: column;
    gap: 20px;
    flex-shrink: 0;
  }
  .inv-acc-item {
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-md);
    border: 1.5px solid transparent;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .inv-acc-item--active {
    border-color: var(--cs-purple);
    background: var(--cs-white);
  }

  /* 아코디언 헤더 행 */
  .inv-acc-header {
    display: flex;
    align-items: center;
    padding: 20px;
  }
  .inv-acc-trigger {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 12px 14px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 48px;
    min-width: 0;
    transition: background 0.12s;
  }
  .inv-acc-trigger:hover { background: rgba(59,47,138,0.04); }
  .inv-acc-item--active .inv-acc-trigger:hover { background: rgba(59,47,138,0.03); }

  /* 순번 인덱스 */
  .inv-bar-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    font-size: 10px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .inv-bar-index--active {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .inv-bar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }
  .inv-bar-code-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .inv-bar-label {
    font: var(--text-pc-descript-10);
    color: #999999;
    flex-shrink: 0;
  }
  .inv-bar-code {
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-text-mid);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .inv-bar-code--active { color: var(--cs-purple); }
  .inv-bar-name {
    font-size: 13px;
    font-weight: 700;
    font-family: 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* 화살표 아이콘 */
  .inv-acc-chevron {
    color: var(--cs-text-light);
    flex-shrink: 0;
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s;
  }
  .inv-acc-chevron--open {
    transform: rotate(180deg);
    color: var(--cs-purple);
  }

  /* 아코디언 바디 */
  .inv-acc-body {
    overflow: hidden;
  }

  /* 토글 버튼 래퍼 */
  .inv-acc-header form {
    padding: 0 8px 0 0;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* 닫기 버튼 — 토글 우측 끝 배치 (자식 상품 ProductDetailPanel에서 이동) */
  .inv-acc-close-btn {
    flex-shrink: 0;
    width: 28px; height: 28px;
    margin-right: 8px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer; min-height: 28px;
    transition: background 0.12s, color 0.12s;
  }
  .inv-acc-close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }
  .inv-bar-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-disabled-toggle);
    cursor: pointer;
    padding: 2px;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .inv-bar-toggle.inv-bar-toggle--on { background: var(--cs-purple); }
  .inv-bar-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .inv-bar-toggle.inv-bar-toggle--on .inv-bar-thumb { transform: translateX(16px); }

  /* 대여 라이프사이클 상태별 재고 카운트 칩 */
  .rs-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 3px;
  }
  .rs-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    border-radius: var(--radius-sm);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }
  .rs-chip--active {
    background: rgba(59, 47, 138, 0.08);
    color: var(--cs-purple);
  }
  .rs-chip--done {
    background: rgba(0, 0, 0, 0.04);
    color: var(--cs-text-light);
  }
</style>
