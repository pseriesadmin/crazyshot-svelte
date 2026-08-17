<script lang="ts">
  // PRD.1.7 — ChatInput: 메시지 입력 바
  // Figma node: 2497:8789 (Message Input Main)
  // 배경: --cs-points (#C1BBEC), 높이 93px, 첨부 + 입력 + 전송
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import type { SimilarNameItem } from '$lib/types/cms-similar-name'
  import { getCategoryLabel } from '$lib/constants/cannedResponseCategories'

  // 상품검색 팝업 — 타이핑 중 라이브 제안(SuggestPicker류)은 가벼운 소량만 조회하고,
  // 엔터(하이라이트 없을 때)로 명시적 "더 보기"를 눌러야만 더 큰 목록을 조회한다.
  // EXPANDED는 search-suggestions/+server.ts 서버측 상한(Math.min(20, ...))과 동일하게 맞춰
  // 그 이상 요청해도 서버가 어차피 20건으로 잘라내므로 클라이언트 상수도 20을 넘기지 않는다.
  const PRODUCT_SEARCH_DEFAULT_LIMIT = 5
  const PRODUCT_SEARCH_EXPANDED_LIMIT = 20

  interface CannedItem {
    id: string
    title: string
    content: string
    category: string | null
    shortcut: string | null
    usage_count: number
  }

  // GSD-17: @ 멘션 상품 검색 결과 타입 (search-suggestions API 응답과 일치)
  interface ProductItem {
    id: string
    name: string
    image_url: string | null
    slug: string | null
    price_24h: number | null
  }

  // 2-B 쿠폰 직접발송: 쿠폰 목록 타입
  interface CouponItem {
    id: string
    code: string
    description: string | null
    discount_type: string
    discount_value: number
    valid_until: string
  }

  interface Props {
    disabled?: boolean
    placeholder?: string
    /**
     * 메시지 전송 콜백.
     * 관리자가 캔드 리스폰스를 선택해서 보낼 때는 cannedResponseId가 함께 전달됩니다
     * (취소하거나 다른 내용으로 덮어쓴 경우 undefined).
     */
    onsend?: (content: string, cannedResponseId?: string) => void
    onattach?: (file: File) => void
    oninputstart?: () => void
    /** 관리자 모드: true 시 / 트리거로 캔드 리스폰스 드롭다운 활성화 */
    isAdmin?: boolean
    /** GSD-17: @ 멘션으로 상품 선택 시 콜백 — product_link action_card 전송용 */
    onproductmention?: (product: ProductItem) => void
    /** 2-B 쿠폰 직접발송: 쿠폰 선택 시 콜백 */
    oncoupongift?: (coupon: CouponItem) => void
  }

  let {
    disabled = false,
    placeholder = '메시지를 입력하세요...',
    onsend,
    onattach,
    oninputstart,
    isAdmin = false,
    onproductmention,
    oncoupongift,
  }: Props = $props()

  let content = $state('')
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let fileInputEl = $state<HTMLInputElement | null>(null)
  /** §E SYN-8: 현재 전송 예정 메시지의 출처 캔드 리스폰스 ID.
   *  selectCanned() 시점에 설정, 직접 입력(handleInput) 시 즉시 초기화,
   *  handleSend() 시 onsend에 전달 후 초기화. */
  let pendingCannedId = $state<string | null>(null)

  // 캔드 리스폰스 상태 (isAdmin=true 전용)
  let cannedAll = $state<CannedItem[]>([])    // 전체 목록 캐시 (마운트 시 1회 로드)
  let cannedLoaded = $state(false)
  let showDropdown = $state(false)
  let dropdownItems = $state<CannedItem[]>([])
  let dropdownIdx = $state(-1)                // 키보드 포커스 인덱스
  let wrapEl = $state<HTMLDivElement | null>(null)

  // GSD-17: @ 멘션 상품 검색 드롭다운 상태
  let productDropdownItems = $state<ProductItem[]>([])
  let showProductDropdown = $state(false)
  let productDropdownIdx = $state(-1)
  let productSearchTimer = $state<ReturnType<typeof setTimeout> | null>(null)

  // 상품검색 팝업 상태 (isAdmin=true 전용 버튼)
  let showProductSearchPopup = $state(false)
  let productSearchValue = $state('')
  let productSearchLimit = $state(PRODUCT_SEARCH_DEFAULT_LIMIT)

  // 팝업 완전 닫기 — 다음에 다시 열 때 항상 소량(라이브 제안) 기준으로 초기화
  function closeProductSearchPopup(): void {
    showProductSearchPopup = false
    productSearchValue = ''
    productSearchLimit = PRODUCT_SEARCH_DEFAULT_LIMIT
  }

  // 쿠폰 팝업 상태 (isAdmin=true 전용)
  let showCouponPopup = $state(false)
  let couponItems = $state<CouponItem[]>([])
  let couponLoading = $state(false)

  function openCouponPopup(): void {
    if (showCouponPopup) { showCouponPopup = false; return }
    // 상품검색 팝업은 닫기
    closeProductSearchPopup()
    showCouponPopup = true
    if (couponItems.length === 0) {
      couponLoading = true
      fetch('/api/cms/coupons/available')
        .then((r) => r.ok ? r.json() : [])
        .then((data: CouponItem[]) => { couponItems = Array.isArray(data) ? data : [] })
        .catch(() => { couponItems = [] })
        .finally(() => { couponLoading = false })
    }
  }

  function closeCouponPopup(): void {
    showCouponPopup = false
  }

  function handleCouponSelect(coupon: CouponItem): void {
    closeCouponPopup()
    oncoupongift?.(coupon)
    textareaEl?.focus()
  }

  function formatCouponDiscount(item: CouponItem): string {
    if (item.discount_type === 'percentage') return `${item.discount_value}% 할인`
    return `${Number(item.discount_value).toLocaleString()}원 할인`
  }

  let canSend = $derived(content.trim().length > 0 && !disabled)

  // isAdmin=true 시 마운트 시점에 캔드 리스폰스 전체 로드 (매 키입력마다 재조회 없이 클라이언트 캐싱)
  $effect(() => {
    if (!isAdmin || cannedLoaded) return
    cannedLoaded = true
    fetch('/api/cms/canned-responses')
      .then((r) => r.json())
      .then((data: CannedItem[]) => { cannedAll = Array.isArray(data) ? data : [] })
      .catch(() => { /* 로드 실패 시 조용히 무시 */ })
  })

  // 입력값이 '/'로 시작하면 드롭다운 필터링
  $effect(() => {
    if (!isAdmin) return
    const val = content
    if (!val.startsWith('/')) {
      showDropdown = false
      dropdownItems = []
      dropdownIdx = -1
      return
    }
    const query = val.slice(1).toLowerCase()
    if (query === '') {
      // '/' 입력만 → 전체 목록 (사용 순)
      dropdownItems = cannedAll.slice(0, 8)
    } else {
      // 단축키 prefix 매칭 우선 → title / content 포함 순
      const byShortcut = cannedAll.filter(
        (c) => c.shortcut && c.shortcut.toLowerCase().includes('/' + query)
      )
      const byText = cannedAll.filter(
        (c) =>
          !byShortcut.includes(c) &&
          (c.title.toLowerCase().includes(query) ||
           c.content.toLowerCase().includes(query))
      )
      dropdownItems = [...byShortcut, ...byText].slice(0, 8)
    }
    showDropdown = dropdownItems.length > 0
    dropdownIdx = -1
  })

  // GSD-17: @ 멘션 트리거 — 입력 시 300ms 디바운스 후 상품 검색
  $effect(() => {
    if (!isAdmin) return
    const val = content
    if (!val.startsWith('@')) {
      // @ 트리거 아니면 상품 드롭다운 닫기
      showProductDropdown = false
      productDropdownItems = []
      productDropdownIdx = -1
      if (productSearchTimer) { clearTimeout(productSearchTimer); productSearchTimer = null }
      return
    }
    const query = val.slice(1).trim()
    if (!query) {
      showProductDropdown = false
      productDropdownItems = []
      productDropdownIdx = -1
      return
    }
    // 이전 타이머 초기화 후 새 디바운스
    if (productSearchTimer) clearTimeout(productSearchTimer)
    productSearchTimer = setTimeout(() => {
      productSearchTimer = null
      fetch(`/api/cms/products/search-suggestions?q=${encodeURIComponent(query)}&limit=6`)
        .then((r) => r.ok ? r.json() : [])
        .then((items: ProductItem[]) => {
          productDropdownItems = Array.isArray(items) ? items : []
          showProductDropdown = productDropdownItems.length > 0
          productDropdownIdx = -1
        })
        .catch(() => { productDropdownItems = []; showProductDropdown = false })
    }, 300)
  })

  // 바깥 클릭 시 드롭다운 닫기
  $effect(() => {
    if (!isAdmin) return
    function handleOutside(e: MouseEvent) {
      if (wrapEl && !wrapEl.contains(e.target as Node)) {
        showDropdown = false
        showProductDropdown = false
        closeProductSearchPopup()
        closeCouponPopup()
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  })

  // GSD-17: 상품 선택 — 입력창에서 @query 제거 + onproductmention 콜백
  function selectProduct(item: ProductItem): void {
    content = ''
    showProductDropdown = false
    productDropdownItems = []
    productDropdownIdx = -1
    onproductmention?.(item)
    textareaEl?.focus()
    resizeTextarea()
  }

  // 상품검색 팝업에서 선택 — content 미삭제(기존 입력 유지), 팝업만 닫음
  // source="product_search" 응답은 SimilarNameItem 타입 선언에 없는 image_url/slug/price_24h를
  // 실제로 포함한다(search-suggestions/+server.ts ExtendedItem) — @ 멘션 경로(selectProduct)와
  // 동일하게 로컬 캐스트로 연결
  function handlePopupProductSelect(item: SimilarNameItem): void {
    const extended = item as SimilarNameItem & { image_url?: string | null; slug?: string | null; price_24h?: number | null }
    closeProductSearchPopup()
    onproductmention?.({
      id: extended.id,
      name: extended.name,
      image_url: extended.image_url ?? null,
      slug: extended.slug ?? null,
      price_24h: extended.price_24h ?? null,
    })
    textareaEl?.focus()
  }

  // CmsSimilarNameInput의 자체 onkeydown(ctrl.onkeydown)은 화살표로 먼저 하이라이트한 뒤에만
  // Enter가 "선택"으로 동작한다(SuggestPicker와 동일한 공유 패턴) — 그 경로는 그대로 둔다.
  // 하이라이트 없이 바로 Enter를 치면: 타이핑 중 라이브 제안(소량)을 "더 보기"로 확장한다.
  // 수백 건을 항상 조회하는 대신, 명시적 Enter 액션에서만 상한까지 넓게 재조회하는 방식으로
  // 로딩 부담을 낮춘다(bind:limit 변경 → CmsSimilarNameInput 내부 effect가 재검색을 트리거).
  function handleProductSearchKeydown(e: KeyboardEvent, ctrlKeydown: (e: KeyboardEvent) => void): void {
    ctrlKeydown(e)
    if (e.key !== 'Enter' || e.defaultPrevented) return
    if (productSearchLimit < PRODUCT_SEARCH_EXPANDED_LIMIT) {
      e.preventDefault()
      productSearchLimit = PRODUCT_SEARCH_EXPANDED_LIMIT
    }
  }

  function selectCanned(item: CannedItem) {
    content = item.content
    showDropdown = false
    dropdownIdx = -1
    // §E SYN-8: 실제 발신 시점에 동의어 학습이 이뤄지도록 출처 ID를 pendingCannedId로 보관
    pendingCannedId = item.id
    // usage_count 증가는 선택 시점 유지 (이유: API 주석 참조)
    fetch(`/api/cms/canned-responses/${item.id}/use`, { method: 'PATCH' }).catch(() => {})
    // 포커스 복귀
    textareaEl?.focus()
    resizeTextarea()
  }

  function resizeTextarea() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    const maxH = 44
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px'
  }

  function handleSend() {
    const text = content.trim()
    if (!text || disabled) return
    // §E SYN-8: 실제 발신 시점에 cannedResponseId 전달 (선택 후 내용 수정 시 이미 null)
    const cannedId = pendingCannedId
    pendingCannedId = null
    onsend?.(text, cannedId ?? undefined)
    content = ''
    showDropdown = false
    if (textareaEl) textareaEl.style.height = 'auto'
  }

  function handleKeydown(e: KeyboardEvent) {
    // GSD-17: 상품 드롭다운 키보드 탐색
    if (showProductDropdown && isAdmin) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        productDropdownIdx = Math.min(productDropdownIdx + 1, productDropdownItems.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        productDropdownIdx = Math.max(productDropdownIdx - 1, 0)
        return
      }
      if (e.key === 'Enter' && productDropdownIdx >= 0) {
        e.preventDefault()
        selectProduct(productDropdownItems[productDropdownIdx])
        return
      }
      if (e.key === 'Escape') {
        showProductDropdown = false
        productDropdownIdx = -1
        return
      }
    }
    // 캔드 리스폰스 드롭다운 키보드 탐색
    if (showDropdown && isAdmin) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        dropdownIdx = Math.min(dropdownIdx + 1, dropdownItems.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        dropdownIdx = Math.max(dropdownIdx - 1, 0)
        return
      }
      if (e.key === 'Enter' && dropdownIdx >= 0) {
        e.preventDefault()
        selectCanned(dropdownItems[dropdownIdx])
        return
      }
      if (e.key === 'Escape') {
        showDropdown = false
        dropdownIdx = -1
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput() {
    // §E SYN-8: 직접 입력 시 캔드 리스폰스 출처 초기화 (덮어쓰면 학습 신호 무효)
    pendingCannedId = null
    resizeTextarea()
    oninputstart?.()
  }

  function handleAttach() {
    fileInputEl?.click()
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    onattach?.(file)
    input.value = ''
  }

</script>

<div class="input-wrap" bind:this={wrapEl}>
  <!-- GSD-17: @ 멘션 상품 검색 드롭다운 -->
  {#if isAdmin && showProductDropdown}
    <div class="product-dropdown" role="listbox" aria-label="상품 검색 결과">
      {#each productDropdownItems as item, i (item.id)}
        <button
          class="product-item"
          class:selected={i === productDropdownIdx}
          role="option"
          aria-selected={i === productDropdownIdx}
          type="button"
          onmousedown={(e) => { e.preventDefault(); selectProduct(item) }}
        >
          {#if item.image_url}
            {@const imgSrc = item.image_url.startsWith('http')
              ? item.image_url
              : `https://res.cloudinary.com/crazyshot/image/upload/w_40,h_40,c_fill,f_auto,q_auto/${item.image_url}.jpg`}
            <img class="pi-thumb" src={imgSrc} alt="" width="36" height="36" loading="lazy" aria-hidden="true" />
          {:else}
            <div class="pi-thumb pi-thumb--ph" aria-hidden="true"></div>
          {/if}
          <div class="pi-info">
            <span class="pi-name">{item.name}</span>
            {#if item.price_24h}
              <span class="pi-price">{item.price_24h.toLocaleString()}원/일</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}

  <!-- 캔드 리스폰스 드롭다운 (관리자 모드 + '/' 트리거) -->
  {#if isAdmin && showDropdown}
    <div class="canned-dropdown" role="listbox" aria-label="빠른답변 목록">
      {#each dropdownItems as item, i (item.id)}
        <button
          class="canned-item"
          class:selected={i === dropdownIdx}
          role="option"
          aria-selected={i === dropdownIdx}
          type="button"
          onmousedown={(e) => { e.preventDefault(); selectCanned(item) }}
        >
          <span class="ci-title">{item.title}</span>
          {#if item.category}
            <span class="ci-cat">{getCategoryLabel(item.category)}</span>
          {/if}
          {#if item.shortcut}
            <span class="ci-shortcut">{item.shortcut}</span>
          {/if}
          <span class="ci-preview">{item.content.slice(0, 50)}{item.content.length > 50 ? '…' : ''}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- 쿠폰 팝업 (관리자 전용 버튼으로 열림) -->
  {#if isAdmin && showCouponPopup}
    <div class="coupon-popup" role="listbox" aria-label="발급 가능한 쿠폰 목록">
      <p class="coupon-popup-title">쿠폰 선물</p>
      {#if couponLoading}
        <p class="coupon-empty">목록 불러오는 중...</p>
      {:else if couponItems.length === 0}
        <p class="coupon-empty">발급 가능한 쿠폰이 없습니다</p>
      {:else}
        {#each couponItems as coupon (coupon.id)}
          <button
            class="coupon-item"
            type="button"
            role="option"
            aria-selected="false"
            onmousedown={(e) => { e.preventDefault(); handleCouponSelect(coupon) }}
          >
            <div class="coupon-item-main">
              <span class="coupon-discount">{formatCouponDiscount(coupon)}</span>
              <span class="coupon-code-chip">{coupon.code}</span>
            </div>
            {#if coupon.description}
              <span class="coupon-desc">{coupon.description}</span>
            {/if}
            <span class="coupon-until">~{new Date(coupon.valid_until).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 까지</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- 상품검색 팝업 (관리자 전용 버튼으로 열림) -->
  {#if isAdmin && showProductSearchPopup}
    <div class="product-search-popup">
      <CmsSimilarNameInput
        bind:value={productSearchValue}
        id="chat-product-search"
        placeholder="상품명으로 검색..."
        source="product_search"
        overlayLayer={true}
        bind:limit={productSearchLimit}
        onselect={handlePopupProductSelect}
      >
        {#snippet field(ctrl)}
          <input
            class="ps-search-input"
            id={ctrl.id}
            type="search"
            placeholder={ctrl.placeholder}
            value={ctrl.value}
            oninput={ctrl.oninput}
            onkeydown={(e) => handleProductSearchKeydown(e, ctrl.onkeydown)}
            onfocus={ctrl.onfocus}
            onblur={ctrl.onblur}
            aria-autocomplete={ctrl.ariaAutocomplete}
            aria-controls={ctrl.ariaControls}
            autocomplete="off"
          />
        {/snippet}
      </CmsSimilarNameInput>
    </div>
  {/if}

  <div class="input-bar">
    <!-- 숨김 파일 입력 -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
      style="display:none"
      onchange={handleFileChange}
    />

    <!-- pill 컨테이너 — Figma node 2497:8792 -->
    <div class="input-pill">
      <!-- 텍스트 입력 -->
      <textarea
        class="input-field"
        bind:this={textareaEl}
        bind:value={content}
        {placeholder}
        {disabled}
        rows="1"
        maxlength="1000"
        aria-label="메시지 입력"
        oninput={handleInput}
        onkeydown={handleKeydown}
        onfocus={() => { closeProductSearchPopup(); closeCouponPopup() }}
      ></textarea>

      <!-- 오른쪽 아이콘 — 텍스트 없으면 첨부, 있으면 전송으로 교체 -->
      {#if canSend}
        <button
          class="icon-right send-btn"
          onclick={handleSend}
          aria-label="전송"
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
            <circle cx="17.5" cy="17.5" r="17.5" fill="#553FE0"/>
            <path d="M17.5711 24.4998L17.5711 10.4999M11.5 16.5L17.5711 10.4999L23.5 16.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      {:else}
        <div class="icon-group">
          <button
            class="icon-right attach-btn"
            onclick={handleAttach}
            aria-label="파일 첨부"
            {disabled}
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
              <path d="M17.1886 13.8969C17.5791 13.5064 18.2123 13.5064 18.6028 13.8969C18.9933 14.2874 18.9933 14.9206 18.6028 15.3111L14.4309 19.483C13.8639 20.05 13.831 21.0045 14.4309 21.6044C15.0308 22.2042 15.9852 22.1713 16.5522 21.6044L24.3304 13.8262C25.932 12.2246 25.8444 9.68333 24.3304 8.16933C22.8164 6.65533 20.2751 6.5677 18.6735 8.16933L10.8953 15.9475C8.3446 18.4982 8.39217 22.6367 10.8953 25.1399C13.3985 27.6431 17.537 27.6906 20.0877 25.1399L24.2597 20.968C24.6502 20.5774 25.2833 20.5774 25.6739 20.968C26.0644 21.3585 26.0644 21.9917 25.6739 22.3822L21.5019 26.5541C18.1628 29.8933 12.7581 29.8311 9.48112 26.5541C6.20409 23.2771 6.14197 17.8724 9.48112 14.5333L17.2593 6.75512C19.6646 4.3498 23.4705 4.48104 25.7446 6.75512C28.0187 9.02919 28.1499 12.8351 25.7446 15.2404L17.9664 23.0186C16.6393 24.3456 14.4202 24.4221 13.0167 23.0186C11.6131 21.615 11.6896 19.3959 13.0167 18.0688L17.1886 13.8969Z" fill="#A0A1B0"/>
            </svg>
          </button>
          {#if isAdmin}
            <button
              class="icon-right search-btn"
              class:active={showProductSearchPopup}
              onclick={() => { if (showProductSearchPopup) closeProductSearchPopup(); else { closeCouponPopup(); showProductSearchPopup = true } }}
              aria-label="상품검색"
              aria-expanded={showProductSearchPopup}
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
                <circle cx="15" cy="15" r="7.5" stroke="currentColor" stroke-width="2"/>
                <line x1="21" y1="21" x2="28" y2="28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
            <button
              class="icon-right coupon-btn"
              class:active={showCouponPopup}
              onclick={openCouponPopup}
              aria-label="쿠폰 선물"
              aria-expanded={showCouponPopup}
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
                <rect x="5" y="11" width="25" height="13" rx="3" stroke="currentColor" stroke-width="2"/>
                <line x1="17.5" y1="11" x2="17.5" y2="24" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
                <circle cx="17.5" cy="17.5" r="2.5" fill="currentColor"/>
              </svg>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .input-wrap {
    position: relative;
    width: 100%;
  }

  /* GSD-17: @ 멘션 상품 드롭다운 — 입력창 위에 표시 */
  .product-dropdown {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-md, 15px);
    box-shadow: 0 -4px 20px rgba(16, 11, 50, 0.10);
    overflow: hidden;
    z-index: 100;
    max-height: 280px;
    overflow-y: auto;
  }

  .product-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.12s;
    border-bottom: 1px solid rgba(16, 11, 50, 0.05);
    min-height: 44px;
  }
  .product-item:last-child { border-bottom: none; }
  .product-item:hover,
  .product-item.selected { background: var(--cs-lilac, #ECEBF4); }

  .pi-thumb {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .pi-thumb--ph {
    background: var(--cs-lilac);
  }

  .pi-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .pi-name {
    font: 600 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pi-price {
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
  }

  /* 캔드 리스폰스 드롭다운 — 입력창 위에 표시 */
  .canned-dropdown {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-md, 15px);
    box-shadow: 0 -4px 20px rgba(16, 11, 50, 0.10);
    overflow: hidden;
    z-index: 100;
    max-height: 320px;
    overflow-y: auto;
  }

  .canned-item {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-rows: auto auto;
    gap: 2px 8px;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.12s;
    border-bottom: 1px solid rgba(16, 11, 50, 0.05);
  }

  .canned-item:last-child { border-bottom: none; }
  .canned-item:hover,
  .canned-item.selected { background: var(--cs-lilac, #ECEBF4); }

  .ci-title {
    grid-column: 1;
    grid-row: 1;
    font: 600 13px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ci-cat {
    grid-column: 2;
    grid-row: 1;
    font: 600 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-white, #fff);
    background: var(--cs-purple, #3B2F8A);
    border-radius: var(--radius-full, 99px);
    padding: 1px 7px;
    white-space: nowrap;
    align-self: center;
  }

  .ci-shortcut {
    grid-column: 3;
    grid-row: 1;
    font: 500 11px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-sm, 8px);
    padding: 1px 6px;
    white-space: nowrap;
    align-self: center;
  }

  .ci-preview {
    grid-column: 1 / -1;
    grid-row: 2;
    font: 400 12px/1.5 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Figma node 2497:8792 — Message Input Main */
  .input-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    flex-shrink: 0;
    padding: 0;
  }

  /* pill 컨테이너 — surface-gray, 67px, radius 25px */
  .input-pill {
    flex: 1 0 0;
    min-width: 0;
    background: var(--cs-surface-gray);
    border-radius: 25px;
    height: 67px;
    display: flex;
    align-items: center;
    /* 67px 높이의 대형 pill이라 인풋 기본 토큰(중, 16px)보다 한 단계 큰
       카드/패널급 좌우 패딩(--spacing-5, 20px) 적용.
       상하는 기존 12px의 2배값 토큰(--spacing-6, 24px) 적용 */
    padding: var(--spacing-6) var(--spacing-5);
    gap: 8px;
  }

  /* pill 우측 아이콘 공통 (첨부/전송 토글) */
  .icon-right {
    width: 35px;
    height: 35px;
    min-width: 35px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    border-radius: 50%;
    transition: opacity 0.15s;
  }

  .icon-right:hover:not(:disabled) {
    opacity: 0.75;
  }

  .icon-right:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 입력 필드 — 투명 배경, pill 내부 */
  .input-field {
    flex: 1 0 0;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font: 400 16px/22px 'Noto Sans KR', sans-serif;
    color: var(--cs-text);
    letter-spacing: -0.2px;
    resize: none;
    outline: none;
    height: 22px;
    max-height: 44px;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .input-field::-webkit-scrollbar {
    display: none;
  }

  .input-field::placeholder {
    color: var(--cs-text-placeholder);
  }

  .input-field:focus {
    outline: none;
  }

  /* 아이콘 그룹 (첨부 + 상품검색 버튼) */
  .icon-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  /* 상품검색 버튼 */
  .search-btn {
    color: #A0A1B0;
  }

  .search-btn.active {
    color: var(--cs-purple, #3B2F8A);
  }

  /* 상품검색 팝업 — 입력폼 위에 앵커링 (canned-dropdown 동일 패턴) */
  /* 검색입력(1행) + 결과영역(5행) = 6행 예산을 항상 확보(팝업 오픈 즉시, 검색 전에도 면적 유지) */
  .product-search-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    min-height: 300px;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-md, 15px);
    box-shadow: 0 -4px 20px rgba(16, 11, 50, 0.10);
    z-index: 100;
    padding: 15px 20px;   /* padding-card 표준 토큰(15px 20px) — 카드·패널 내부 */
  }

  /* CmsSimilarNameInput 래퍼를 팝업 flex 흐름에 맞춰 세로로 확장 */
  .product-search-popup :global(.cms-similar-name) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .ps-search-input {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-sm, 8px);
    font: 400 14px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text, #100B32);
    background: var(--cs-surface-gray, #f6f6f6);
    outline: none;
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
  }

  .ps-search-input:focus {
    border-color: var(--cs-purple, #3B2F8A);
    background: #fff;
  }

  /* type=search 기본 X 버튼 제거 */
  .ps-search-input::-webkit-search-cancel-button { display: none; }

  /* 제안 레이어 — 절대위치 오버레이(입력폼 아래로 겹쳐 뜨며 하단 채팅입력바와 충돌 위험) 대신
     팝업 내부 정적 흐름으로 전환해 위 min-height 예산 안에서 안전하게 표시되도록 재정의 */
  .product-search-popup :global(.cms-similar-name-layer) {
    position: static;
    top: auto;
    flex: 1;
    min-height: 0;
    margin-top: 8px;
    max-height: none;
    border: none;
    box-shadow: none;
    background: transparent;
  }

  /* 쿠폰 버튼 */
  .coupon-btn {
    color: #A0A1B0;
  }
  .coupon-btn.active {
    color: var(--cs-purple, #3B2F8A);
  }

  /* 쿠폰 팝업 — 상품검색 팝업과 동일 앵커링 패턴 */
  .coupon-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--cs-white, #fff);
    border: 1px solid var(--cs-lilac, #ECEBF4);
    border-radius: var(--radius-md, 15px);
    box-shadow: 0 -4px 20px rgba(16, 11, 50, 0.10);
    z-index: 100;
    max-height: 320px;
    overflow-y: auto;
    padding: 12px 0 4px;
  }

  .coupon-popup-title {
    font: 700 12px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0 14px 8px;
    margin: 0;
    border-bottom: 1px solid var(--cs-lilac, #ECEBF4);
  }

  .coupon-empty {
    font: 400 13px/2 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    text-align: center;
    padding: 12px 14px;
    margin: 0;
  }

  .coupon-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.12s;
    border-bottom: 1px solid rgba(16, 11, 50, 0.05);
    min-height: 44px;
  }
  .coupon-item:last-child { border-bottom: none; }
  .coupon-item:hover { background: var(--cs-lilac, #ECEBF4); }

  .coupon-item-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .coupon-discount {
    font: 700 14px/1.3 'Noto Sans KR', sans-serif;
    color: var(--cs-purple, #3B2F8A);
  }

  .coupon-code-chip {
    font: 500 11px/1 'Courier New', monospace;
    color: var(--cs-text-mid, #666666);
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: 4px;
    padding: 2px 6px;
    letter-spacing: 0.5px;
  }

  .coupon-desc {
    font: 400 12px/1.4 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .coupon-until {
    font: 400 11px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-light, #aaaaaa);
  }
</style>
