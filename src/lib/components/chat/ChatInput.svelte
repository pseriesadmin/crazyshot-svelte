<script lang="ts">
  // PRD.1.7 — ChatInput: 메시지 입력 바
  // Figma node: 2497:8789 (Message Input Main)
  // 배경: --cs-points (#C1BBEC), 높이 93px, 첨부 + 입력 + 전송
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import type { SimilarNameItem } from '$lib/types/cms-similar-name'
  import { getCategoryLabel } from '$lib/constants/cannedResponseCategories'
  import { csToast } from '$lib/utils/toast'

  // 상품검색 팝업 — 결과는 20건씩 스크롤 끝에서 추가 조회(후보 최대 500건, 서버 페이지 모드 — search-suggestions API 참고).

  interface CannedItem {
    id: string
    title: string
    content: string
    category: string | null
    shortcut: string | null
    usage_count: number
    match_keywords?: string[]
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
    display_name?: string | null
    description: string | null
    discount_type: string
    discount_value: number
    valid_until: string | null
    already_owned?: boolean
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
    /** 쿠폰 목록 조회 시 이미 보유한 쿠폰인지 판별하기 위한 대상 고객 user_id (선택 세션 기준) */
    targetUserId?: string | null
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
    targetUserId = null,
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
  // 렌더링에 쓰이지 않는 타이머 핸들 — $state로 두면 아래 @ effect가 읽고 쓰는 같은 상태가 되어 effect_update_depth_exceeded로 멈춘다
  let productSearchTimer: ReturnType<typeof setTimeout> | null = null

  // 상품검색 팝업 상태 (isAdmin=true 전용 버튼)
  let showProductSearchPopup = $state(false)
  let productSearchValue = $state('')

  // 팝업 완전 닫기 — 검색어 초기화(결과는 스크롤 추가 조회라 다음에 열면 처음부터)
  function closeProductSearchPopup(): void {
    showProductSearchPopup = false
    productSearchValue = ''
  }

  // 쿠폰 팝업 상태 (isAdmin=true 전용)
  let showCouponPopup = $state(false)
  let couponItems = $state<CouponItem[]>([])
  let couponLoading = $state(false)
  // 마지막으로 목록을 조회한 대상 고객 — 세션이 바뀌면 already_owned 판정도 다시 조회해야 함
  // ('unloaded' 센티널로 시작해 targetUserId가 null인 경우도 최초 1회는 반드시 조회하게 함)
  let couponListLoadedForUserId = $state<string | null>('unloaded')

  function openCouponPopup(): void {
    if (showCouponPopup) { showCouponPopup = false; return }
    // 상품검색 팝업은 닫기
    closeProductSearchPopup()
    showCouponPopup = true
    if (couponListLoadedForUserId !== targetUserId) {
      couponLoading = true
      const qs = targetUserId ? `?user_id=${encodeURIComponent(targetUserId)}` : ''
      fetch(`/api/cms/coupons/available${qs}`)
        .then((r) => r.ok ? r.json() : [])
        .then((data: CouponItem[]) => {
          couponItems = Array.isArray(data) ? data : []
          couponListLoadedForUserId = targetUserId
        })
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

  // 고객에게 노출되는 쿠폰명(display_name) 우선 — 없으면 할인율/금액으로 폴백
  function couponDisplayLabel(item: CouponItem): string {
    return item.display_name ?? formatCouponDiscount(item)
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
    let nextItems: CannedItem[]
    if (query === '') {
      // '/' 입력만 → 전체 목록 (사용 순)
      nextItems = cannedAll.slice(0, 8)
    } else {
      // 매칭 우선순위: ① 관리자가 등록한 전용 키워드(match_keywords) → ② 단축키(shortcut)
      // 접두 매칭 → ③ 제목(title) 부분일치. 응답 본문(content) 전체는 더 이상 매칭 대상이
      // 아니다 — 본문 속 우연한 단어 포함("반납" 등)까지 걸려 무관한 항목이 섞이던 문제 수정.
      const byKeyword = cannedAll.filter(
        (c) => (c.match_keywords ?? []).some((k) => k.toLowerCase().includes(query))
      )
      const byShortcut = cannedAll.filter(
        (c) => !byKeyword.includes(c) && c.shortcut && c.shortcut.toLowerCase().includes('/' + query)
      )
      const byTitle = cannedAll.filter(
        (c) =>
          !byKeyword.includes(c) &&
          !byShortcut.includes(c) &&
          c.title.toLowerCase().includes(query)
      )
      nextItems = [...byKeyword, ...byShortcut, ...byTitle].slice(0, 8)
    }
    // 방금 쓴 상태(dropdownItems)를 같은 effect 안에서 다시 읽지 않는다 — 읽으면 자기 자신을 의존성으로 등록해
    // 매 실행마다 스스로를 무효화(effect_update_depth_exceeded)하며 드롭다운이 멈춘다
    dropdownItems = nextItems
    showDropdown = nextItems.length > 0
    // 목록이 있으면 항상 첫 항목을 하이라이트해둔다 — 화살표 없이 바로 Enter를 눌러도
    // (아래 handleKeydown의 dropdownIdx>=0 분기가 동작해) 선택되도록 하기 위함. 이전에는
    // 항상 -1로 리셋돼, 화면에 보이는 미리보기가 아니라 입력창의 "/검색어" 원문이 그대로
    // 전송되는 결함이 있었다.
    dropdownIdx = nextItems.length > 0 ? 0 : -1
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
        // '/'·'@' 트리거 문자만 남아있던 입력을 함께 비워야 전송 버튼이 "첨부"로 되돌아온다 —
        // showDropdown만 끄면 content(예: '/반납')가 그대로 남아 canSend가 계속 참으로 고정됨.
        if (content.startsWith('/') || content.startsWith('@')) {
          content = ''
          pendingCannedId = null
        }
        showDropdown = false
        dropdownIdx = -1
        showProductDropdown = false
        productDropdownIdx = -1
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

  function selectCanned(item: CannedItem) {
    content = item.content
    showDropdown = false
    dropdownIdx = -1
    // §E SYN-8: 실제 발신 시점에 동의어 학습이 이뤄지도록 출처 ID를 pendingCannedId로 보관
    // usage_count 집계는 2026-09-28 Stephen 확정으로 "선택(미리보기) 시점"에서 "실제 전송
    // 성공 시점"으로 이동 — 여기서는 더 이상 /use PATCH를 호출하지 않는다(호출부:
    // AdminChatPanel.svelte handleSend 성공 분기).
    pendingCannedId = item.id
    // 포커스 복귀
    textareaEl?.focus()
    resizeTextarea()
  }

  /** 관리자 입력창은 Enter로 줄을 바꾸며 3행(22px × 3)까지 세로로 늘어난다(2026-10-20, Stephen 지시) */
  const ADMIN_INPUT_MAX_HEIGHT = 66

  function resizeTextarea() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    const maxH = isAdmin ? ADMIN_INPUT_MAX_HEIGHT : 44
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px'
  }

  function handleSend() {
    const text = content.trim()
    if (!text || disabled) return
    // maxlength(1000)는 네이티브 타이핑만 막을 뿐 selectCanned() 같은 JS 직접대입 경로는
    // 우회한다 — 전송 직전에도 한 번 더 검증해 서버 400을 조용히 삼키지 않고 안내한다.
    if (text.length > 1000) {
      csToast.error('메시지는 1000자를 초과할 수 없습니다.')
      return
    }
    // §E SYN-8: 실제 발신 시점에 cannedResponseId 전달 (선택 후 내용 수정 시 이미 null)
    const cannedId = pendingCannedId
    pendingCannedId = null
    onsend?.(text, cannedId ?? undefined)
    content = ''
    showDropdown = false
    if (textareaEl) textareaEl.style.height = 'auto'
  }

  function handleKeydown(e: KeyboardEvent) {
    // '/'·'@' 트리거 문자 자체를 취소하는 Escape는 드롭다운에 검색결과가 있을 때만이 아니라
    // 항상 동작해야 한다 — 예: '/asdkfj'처럼 매칭되는 빠른답변이 하나도 없으면 showDropdown이
    // 이미 false라 아래 중첩된 showDropdown 분기 안의 Escape가 실행되지 않고, 입력창에
    // "/asdkfj"가 그대로 남아 전송 버튼이 계속 "전송"에 고정된 채였다(바깥클릭 핸들러는 이미
    // 이 조건(content startsWith)만으로 판단해 정상 동작했는데 Escape만 비대칭이었음, 2026-09-28
    // 정밀 재검증으로 발견). isAdmin 전용 — 일반 사용자 채팅창('/'가 특별한 의미 없음)은 무관.
    if (isAdmin && e.key === 'Escape' && (content.startsWith('/') || content.startsWith('@'))) {
      content = ''
      pendingCannedId = null
      showDropdown = false
      dropdownIdx = -1
      showProductDropdown = false
      productDropdownIdx = -1
      return
    }
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
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // 관리자 입력창: Enter는 줄바꿈(입력창이 3행까지 늘어남), 전송은 Ctrl/⌘+Enter 또는 전송 버튼. 고객 입력창은 기존대로 Enter 전송.
      if (isAdmin) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          handleSend()
        }
        return
      }
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
            class:coupon-item--disabled={coupon.already_owned}
            type="button"
            role="option"
            aria-selected="false"
            disabled={coupon.already_owned}
            onmousedown={(e) => { e.preventDefault(); if (!coupon.already_owned) handleCouponSelect(coupon) }}
          >
            <div class="coupon-item-main">
              <span class="coupon-discount">{couponDisplayLabel(coupon)}</span>
              {#if coupon.already_owned}<span class="coupon-owned-badge">이미 발급됨</span>{/if}
              {#if coupon.code}<span class="coupon-code-chip">{coupon.code}</span>{/if}
            </div>
            {#if coupon.description}
              <span class="coupon-desc">{coupon.description}</span>
            {/if}
            {#if coupon.valid_until}
              <span class="coupon-until">~{new Date(coupon.valid_until).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 까지</span>
            {/if}
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
        paginate={true}
        pageSize={20}
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
            onkeydown={ctrl.onkeydown}
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
      accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
      style="display:none"
      onchange={handleFileChange}
    />

    <!-- pill 컨테이너 — Figma node 2497:8792 -->
    <div class="input-pill" class:input-pill--admin={isAdmin}>
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="19" viewBox="0 0 32 33" fill="none" aria-hidden="true">
              <path d="M30.5 15.7453L17.3107 28.8124C13.6937 32.3958 7.82958 32.3958 4.21268 28.8124C0.595773 25.229 0.595774 19.4192 4.21268 15.8358L16.874 3.2917C19.2853 0.902766 23.1948 0.902766 25.606 3.2917C28.0173 5.68064 28.0173 9.55387 25.606 11.9428L12.965 24.4668C11.7593 25.6612 9.80461 25.6612 8.59898 24.4668C7.39334 23.2723 7.39334 21.3357 8.59898 20.1412L20.1232 8.72379" stroke="currentColor" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 35 36" fill="none" aria-hidden="true">
                <circle cx="18.94" cy="15.92" r="12.9" stroke="currentColor" stroke-width="5.6"/>
                <path d="M9.6 25.4L2.6 32.7" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="19" height="18" viewBox="0 0 25 23" fill="none" aria-hidden="true">
                <path d="M23.5 10.5V5.5A3.5 3.5 0 0 0 20 2H5A3.5 3.5 0 0 0 1.5 5.5V15A3.5 3.5 0 0 0 5 18.5H13" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M1.5 8h22M20 13.5v8M16 17.5h8" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
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
    /* 1행일 때 67px, 줄이 늘어나면(고객 2행·관리자 3행) pill도 함께 커진다 — 하단 고정 영역이라 위쪽으로 늘어남(2026-10-20, Stephen 지시) */
    height: auto;
    min-height: 67px;
    display: flex;
    align-items: center;
    /* 67px 높이의 대형 pill이라 인풋 기본 토큰(중, 16px)보다 한 단계 큰
       카드/패널급 좌우 패딩(--spacing-5, 20px) 적용.
       상하는 22px(1행 22px + 상하 22px = 66px ≈ 최소 67px) */
    padding: 22px var(--spacing-5);
    gap: 8px;
  }

  /* 관리자(CMS) 답변 입력 — 상담 메모 입력란과 같은 면 토큰(옅은 퍼플 0.04), 입력 중(포커스)엔 흰 면 + 퍼플 아웃라인.
     고객 채팅(isAdmin=false)은 기존 --cs-surface-gray 그대로 */
  .input-pill--admin {
    background: var(--cs-white); /* 2026-10-20(Stephen 지시): 입력창은 흰색, 바깥 하단 작성 그룹이 옅은 퍼플(rgba(59,47,138,0.04)) 면을 가진다 */
    transition: background 0.15s;
  }
  .input-pill--admin:focus-within {
    background: var(--cs-white);
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
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
    /* 볼드값이 있는 폰트 토큰(--text-pc-title-16 = 700 16px) — 줄 높이만 22px로 고정(2026-10-20, Stephen 지시) */
    font: var(--text-pc-title-16);
    line-height: 22px;
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

  /* 관리자 입력창: 볼드값이 있는 폰트 토큰(--text-pc-title-16 = 700 16px) — 줄 높이만 입력창 높이(22px)에 맞춘다(2026-10-20, Stephen 지시) */
  .input-pill--admin .input-field {
    max-height: 66px; /* 3행까지 늘어난다(고객 입력창은 2행 — 기본 max-height 44px) */
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

  /* 파일 첨부 버튼 — 아이콘이 currentColor 선 아이콘이라 색을 여기서 지정 */
  .attach-btn {
    color: var(--cs-text-mid);
  }

  /* 상품검색 버튼 */
  .search-btn {
    color: var(--cs-text-mid);
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
    height: 300px;   /* 고정 세로폭 — 결과가 많아져도 팝업은 커지지 않고 목록만 스크롤 */
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
    color: var(--cs-text-mid);
  }
  .coupon-btn.active {
    color: var(--cs-purple, #3B2F8A);
  }

  /* 굵은 선이 viewBox 가장자리를 넘어가도 잘리지 않게 */
  .attach-btn svg,
  .search-btn svg,
  .coupon-btn svg {
    overflow: visible;
  }

  /* 아이콘 3종(첨부·상품검색·쿠폰) 호버/열림 — 원형 퍼플 면 + 퍼플 선으로 확실히 반응(배경·색만 변경, 아웃라인·그림자 없음) */
  .attach-btn:hover:not(:disabled),
  .search-btn:hover:not(:disabled),
  .coupon-btn:hover:not(:disabled),
  .search-btn.active,
  .coupon-btn.active {
    opacity: 1;
    color: var(--cs-purple);
    background: rgba(59, 47, 138, 0.12);
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
  .coupon-item--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .coupon-item--disabled:hover { background: transparent; }

  .coupon-owned-badge {
    font: 700 10px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-text-mid, #666666);
    background: var(--cs-surface-gray, #f6f6f6);
    border-radius: var(--radius-full, 99px);
    padding: 2px 8px;
    white-space: nowrap;
  }

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
