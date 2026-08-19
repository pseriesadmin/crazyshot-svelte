<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import RentalContractViewer from '$lib/components/cms/RentalContractViewer.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import { nextStatus, nextLabel } from '$lib/utils/rentalTransition'
  import { extractProductId, isProductMatch } from '$lib/utils/qrProductId'

  interface RentalListRow {
    reservation_id:    number
    reservation_code:  string | null
    status:            string
    rental_start:      string
    rental_end:        string
    rental_days:       number | null
    pickup_method:     string | null
    return_method:     string | null
    pickup_time:       string | null
    return_time:       string | null
    user_id:           string
    customer_name:     string
    customer_email:    string
    customer_phone:    string
    membership_grade:  string
    credit_score:      number
    product_id:        string
    product_name:      string
    product_code:      string | null
    product_category:  string
    product_image_url: string | null
    order_id:          number | null
    order_key:         string | null
    order_amount:      number | null
    discount_amount:   number | null
    tax_amount:        number | null
    payment_status:    string | null
    contract_id:       string | null
    contract_status:   string | null
    contract_pdf_url:  string | null
    auto_signed_at:    string | null
    customer_signed_at: string | null
    signing_sent_at:   string | null
    signing_token:     string | null
    created_at:        string
    payment_confirmed_at?: string | null
    total_count:       number
  }

  interface PaymentDetail {
    toss_order_id:   string | null
    payment_key:     string | null
    payment_method:  string | null
    total_amount:    number | null
    paid_amount:     number | null
    point_amount:    number | null
    coupon_discount: number | null
    confirmed_at:    string | null
    toss_response:   Record<string, unknown> | null
  }

  interface Props {
    row:          RentalListRow
    onclose:      () => void
    onrefresh:    () => void
    stepFilter?:  string[]
    isRentalView?: boolean   // true = /cms/rentals 컨텍스트 (예약 단계 UI 숨김)
    enableQrVerify?: boolean // true일 때만 "상품 정보"에 QR 확인 아이콘 노출 (모바일 대여목록 전용)
  }
  let { row, onclose, onrefresh, stepFilter, isRentalView = false, enableQrVerify = false }: Props = $props()

  let qrOverlayOpen = $state(false)

  // QR 일치 시: '승인완료'는 반출로, '반납중'은 반납으로 확인 탭 없이 즉시 자동 기록.
  // 그 외 상태는 기존처럼 /cms/mobile/qr/[id] 수동 처리 화면으로 이동 —
  // 이 패널의 상태전이 버튼(대여 탭 하단)은 그대로 유지되는 하이브리드 관리.
  const QR_AUTO_STATUSES = new Set(['confirmed', 'return_requested'])

  function handleProductQrDetected(raw: string): boolean {
    const scannedId = extractProductId(raw)
    if (!scannedId) return false
    processProductQrMatch(scannedId)
    return true
  }

  async function processProductQrMatch(scannedId: string): Promise<void> {
    if (!isProductMatch(scannedId, row)) {
      csToast.error('스캔한 상품이 예약 상품과 일치하지 않습니다')
      return
    }

    const target = nextStatus(row.status, row.pickup_method, row.return_method)
    if (!QR_AUTO_STATUSES.has(row.status) || !target) {
      goto(`/cms/mobile/qr/${encodeURIComponent(scannedId)}`)
      return
    }

    try {
      const res = await fetch('/api/cms/rental-qr-transition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: row.reservation_id, newStatus: target, productId: scannedId }),
      })
      const body = await res.json()
      if (body.ok) {
        csToast.success(row.status === 'confirmed' ? '반출로 자동 기록되었습니다' : '반납으로 자동 기록되었습니다')
        onrefresh()
      } else {
        csToast.error(body.message ?? '처리에 실패했습니다')
      }
    } catch {
      csToast.error('처리 중 오류가 발생했습니다')
    }
  }

  let activeTab   = $state<'rental' | 'customer' | 'payment' | 'contract'>('rental')
  let isSubmitting = $state(false)

  let fetchedForId    = $state<number | null>(null)
  let paymentDetail   = $state<PaymentDetail | null>(null)
  let paymentLoading  = $state(false)
  let paymentError    = $state<string | null>(null)

  $effect(() => {
    if (activeTab !== 'payment') return
    if (paymentLoading) return
    if (fetchedForId === row.reservation_id) return

    const id = row.reservation_id
    fetchedForId   = id
    paymentDetail  = null
    paymentError   = null
    paymentLoading = true

    fetch(`/api/cms/reservations/${id}/payment`)
      .then(r => r.json())
      .then(d => {
        if (fetchedForId === id) {
          if (d.payment) {
            paymentDetail = { ...d.payment, toss_order_id: d.payment.order_id ?? null }
          } else {
            paymentDetail = null
          }
          paymentLoading = false
        }
      })
      .catch(() => {
        if (fetchedForId === id) { paymentError = '결제 정보를 불러오지 못했습니다.'; paymentLoading = false }
      })
  })

  interface ReservationOption {
    id:           number
    option_name:  string
    qty:          number
    unit_price:   number
    product_code: string | null
  }

  interface OrderSibling {
    reservationId:   number
    reservationCode: string | null
    status:          string
    productName:     string
  }

  let orderSiblingsFetchedForId = $state<number | null>(null)
  let orderSiblings              = $state<OrderSibling[]>([])
  let orderSiblingsLoading       = $state(false)
  let orderSiblingsError         = $state<string | null>(null)

  // 같은 주문(orders/order_items, Migration 251)에 묶인 다른 상품 — 결제정보 탭 "주문 정보"
  // 섹션 하단에 노출(결제정보/옵션상품과 동일한 lazy-fetch 패턴). 단일 상품 예약이면 빈 배열.
  // rental 탭에서도 함께 조회 — "승인하기" 버튼이 rental 탭에 있어, 다중상품 주문 배치알림
  // 정책(service-operations.md §4)을 관리자가 미리 인지할 수 있도록 안내 문구에 사용.
  $effect(() => {
    if (activeTab !== 'payment' && activeTab !== 'rental') return
    if (orderSiblingsLoading) return
    if (orderSiblingsFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    orderSiblingsFetchedForId = id
    orderSiblings        = []
    orderSiblingsError    = null
    orderSiblingsLoading  = true

    fetch(`/api/cms/reservations/${id}/order-siblings`)
      .then(r => r.json())
      .then(d => {
        if (orderSiblingsFetchedForId === id) {
          orderSiblings = Array.isArray(d.siblings) ? d.siblings : []
          orderSiblingsLoading = false
        }
      })
      .catch(() => {
        if (orderSiblingsFetchedForId === id) { orderSiblingsError = '주문 상품 정보를 불러오지 못했습니다.'; orderSiblingsLoading = false }
      })
  })

  let optionsFetchedForId = $state<number | null>(null)
  let options              = $state<ReservationOption[]>([])
  let optionsLoading       = $state(false)
  let optionsError         = $state<string | null>(null)

  // 대여정보 탭의 "상품 정보"에 옵션상품(reservation_options)을 함께 노출 — 대여는 예약 정보를
  // 그대로 가져와 진행을 관리하는 영역이라(예약상품 정보 = 대여상품 정보), 메인상품 1건뿐 아니라
  // 예약 시 함께 담긴 옵션상품도 여기서 같이 보여야 함. 결제정보 탭과 동일한 lazy-fetch 패턴.
  $effect(() => {
    if (activeTab !== 'rental') return
    if (optionsLoading) return
    if (optionsFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    optionsFetchedForId = id
    options        = []
    optionsError    = null
    optionsLoading  = true

    fetch(`/api/cms/reservations/${id}/options`)
      .then(r => r.json())
      .then(d => {
        if (optionsFetchedForId === id) {
          options = Array.isArray(d.options) ? d.options : []
          optionsLoading = false
        }
      })
      .catch(() => {
        if (optionsFetchedForId === id) { optionsError = '옵션상품 정보를 불러오지 못했습니다.'; optionsLoading = false }
      })
  })

  interface RentalSibling {
    reservationId:   number
    reservationCode: string | null
    status:          string
    rentalStart:     string | null
    rentalEnd:       string | null
    pickupMethod:    string | null
    returnMethod:    string | null
    productName:     string
    productCode:     string | null
    productCategory: string | null
    productImageUrl: string | null
  }

  let rentalSiblingsFetchedForId = $state<number | null>(null)
  let rentalSiblings              = $state<RentalSibling[]>([])
  let rentalSiblingsLoading       = $state(false)
  let rentalSiblingsError         = $state<string | null>(null)

  // 같은 주문(orders/order_items, Migration 280)에 묶인 다른 상품 — 대여정보 탭 "상품 정보"
  // 섹션에 장바구니에 함께 담긴 상품 전부를 반복 표시하기 위함(옵션상품/결제정보 탭과 동일한
  // lazy-fetch 패턴). 단일 상품 예약이면 빈 배열.
  $effect(() => {
    if (activeTab !== 'rental') return
    if (rentalSiblingsLoading) return
    if (rentalSiblingsFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    rentalSiblingsFetchedForId = id
    rentalSiblings        = []
    rentalSiblingsError    = null
    rentalSiblingsLoading  = true

    fetch(`/api/cms/reservations/${id}/rental-siblings`)
      .then(r => r.json())
      .then(d => {
        if (rentalSiblingsFetchedForId === id) {
          rentalSiblings = Array.isArray(d.siblings) ? d.siblings : []
          rentalSiblingsLoading = false
        }
      })
      .catch(() => {
        if (rentalSiblingsFetchedForId === id) { rentalSiblingsError = '함께 담긴 상품 정보를 불러오지 못했습니다.'; rentalSiblingsLoading = false }
      })
  })

  interface ProductInfoItem {
    key:      string
    isSibling: boolean
    imageUrl: string | null
    name:     string
    code:     string | null
    category: string | null
    status?:  string
  }

  // "상품 정보" 섹션 반복 렌더링용 — 현재 선택된 상품(row) + 같은 주문의 형제 상품(rentalSiblings)을
  // 하나의 배열로 정규화. 1개든 N개든 동일한 info-row 마크업을 그대로 재사용해 반복 표시한다.
  let productInfoItems = $derived<ProductInfoItem[]>([
    {
      key: `main-${row.reservation_id}`, isSibling: false,
      imageUrl: row.product_image_url, name: row.product_name,
      code: row.product_code, category: row.product_category,
    },
    ...rentalSiblings.map(s => ({
      key: `sib-${s.reservationId}`, isSibling: true,
      imageUrl: s.productImageUrl, name: s.productName,
      code: s.productCode, category: s.productCategory, status: s.status,
    })),
  ])

  const STATUS_LABEL: Record<string, string> = {
    pending: '접수', hold: '신청대기', confirmed: '승인완료',
    shipped: '배송중', in_use: '대여중', return_requested: '반납요청',
    returned: '반납완료', completed: '완료', cancelled: '취소', damage_claimed: '파손신고',
  }

  const PICKUP_LABELS: Record<string, string> = {
    crazydelivery: '크레이지샷 배송',
    quick:         '당일퀵 배송',
    locker:        '무인 보관함',
    visit:         '본점 방문수령',
    epost:         '택배',
    airport:       '공항 수령',
  }

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    card:              '신용카드',
    virtualAccount:    '가상계좌',
    transfer:          '계좌이체',
    mobilePhone:       '휴대폰 결제',
    giftCertificate:   '상품권',
    easyPay:           '간편결제',
  }

  const TERMINAL = new Set(['completed', 'cancelled', 'damage_claimed'])

  function isTerminal(s: string): boolean { return TERMINAL.has(s) }

  function formatDate(dt: string | null): string {
    if (!dt) return '-'
    return dt.slice(0, 10)
  }

  function formatDateTime(dt: string | null): string {
    if (!dt) return '-'
    return new Date(dt).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  function formatAmount(n: number | null): string {
    if (n == null) return '-'
    return n.toLocaleString('ko-KR') + '원'
  }

  function gradeLabel(g: string): string { return g?.toUpperCase() ?? '-' }

  // 카드 승인번호 — Toss 응답의 card.approveNo (카드 결제가 아니면 없음)
  function cardApprovalNumber(detail: PaymentDetail | null): string {
    const card = detail?.toss_response?.card as Record<string, unknown> | undefined
    const approveNo = card?.approveNo
    return typeof approveNo === 'string' && approveNo ? approveNo : '-'
  }

  function reservationCode(): string {
    return row.reservation_code ?? `CZ-${String(row.reservation_id).padStart(5, '0')}`
  }

  const NOTIFY_TYPE_MAP: Record<string, string> = {
    confirmed:        'shipment_notify',
    in_use:           'return_remind',
    return_requested: 'return_registration',
    returned:         'rental_complete',
  }

  let notifyType = $derived(NOTIFY_TYPE_MAP[row.status] ?? null)

  function chatNotifyLabel(type: string): string {
    const map: Record<string, string> = {
      shipment_notify:     '반출 알림 발송 💬',
      return_remind:       '반납 예정 알림 💬',
      return_registration: '반납 정보 요청 💬',
      rental_complete:     '대여 종료 알림 💬',
    }
    return map[type] ?? '알림 발송 💬'
  }

  // ── 운송장 정보 (lazy-fetch, rental 탭 오픈 시 조회) ──────────────────────
  let trackingFetchedForId = $state<number | null>(null)
  let trackingNumber       = $state('')
  let trackingCourierCode  = $state('')
  let trackingLoading      = $state(false)
  let trackingSaving       = $state(false)
  let trackingError        = $state<string | null>(null)

  $effect(() => {
    if (activeTab !== 'rental') return
    if (trackingLoading) return
    if (trackingFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    trackingFetchedForId = id
    trackingNumber       = ''
    trackingCourierCode  = ''
    trackingError        = null
    trackingLoading      = true

    fetch(`/api/cms/reservations/${id}/tracking`)
      .then(r => r.json())
      .then((d: { tracking_number: string | null; courier_code: string | null }) => {
        if (trackingFetchedForId === id) {
          trackingNumber      = d.tracking_number ?? ''
          trackingCourierCode = d.courier_code    ?? ''
          trackingLoading     = false
        }
      })
      .catch(() => {
        if (trackingFetchedForId === id) {
          trackingError   = '운송장 정보를 불러오지 못했습니다.'
          trackingLoading = false
        }
      })
  })

  async function saveTracking(): Promise<void> {
    trackingSaving = true
    trackingError  = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/tracking`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tracking_number: trackingNumber  || null,
          courier_code:    trackingCourierCode || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        trackingError = d.error ?? '저장에 실패했습니다.'
      } else {
        csToast.success('운송장 정보가 저장되었습니다.')
      }
    } catch {
      trackingError = '저장 중 오류가 발생했습니다.'
    } finally {
      trackingSaving = false
    }
  }

  // 중복 발송 가드 — 5분 내 동일 알림 발송 이력 추적 (세션 내 휘발, 새로고침 시 초기화)
  const RECENT_NOTIFY_TTL_MS = 5 * 60 * 1000
  let lastSentMap = $state<Map<string, number>>(new Map())

  function notifySentKey(rid: number, type: string): string {
    return `${rid}:${type}`
  }

  function markNotifySent(rid: number, type: string): void {
    const key = notifySentKey(rid, type)
    lastSentMap = new Map(lastSentMap).set(key, Date.now())
  }

  function wasRecentlySent(rid: number, type: string): boolean {
    const ts = lastSentMap.get(notifySentKey(rid, type))
    return ts != null && Date.now() - ts < RECENT_NOTIFY_TTL_MS
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-title-wrap">
      <span class="panel-label">대여</span>
      <span class="panel-id">{reservationCode()}</span>
      <span class="panel-status">{STATUS_LABEL[row.status] ?? row.status}</span>
      {#if row.status === 'hold' && row.payment_confirmed_at}
        <span class="payment-contract-badge">결제완료 · 계약대기</span>
      {/if}
    </div>
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  <!-- 탭 -->
  <div class="panel-tabs" role="tablist">
    {#each [
      { id: 'rental',   label: '대여정보' },
      { id: 'customer', label: '고객정보' },
      { id: 'payment',  label: '결제정보' },
      { id: 'contract', label: '계약서'   },
    ] as tab}
      <button
        class="tab"
        class:tab-active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => activeTab = tab.id as typeof activeTab}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- 탭 바디 -->
  <div class="panel-body">

    <!-- ─── Tab 1: 예약정보 ─── -->
    {#if activeTab === 'rental'}

      <!-- 대여 여정 스텝퍼 -->
      <RentalJourneyStepper status={row.status} steps={stepFilter} />

      <!-- 예약 정보 -->
      <div class="section-title">대여 정보</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">예약코드</span>
          <span class="info-value mono">{reservationCode()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">현재 상태</span>
          <span class="info-value">{STATUS_LABEL[row.status] ?? row.status}</span>
        </div>
        <div class="info-row">
          <span class="info-label">신청일시</span>
          <span class="info-value">{formatDateTime(row.created_at)}</span>
        </div>
      </div>

      <!-- 상품 정보 -->
      <div class="section-title-row">
        <span class="section-title">상품 정보{#if productInfoItems.length > 1} ({productInfoItems.length}개){/if}</span>
        {#if enableQrVerify}
          <button
            type="button"
            class="qr-verify-icon-btn"
            onclick={() => (qrOverlayOpen = true)}
            aria-label="상품 QR 확인"
            title="상품 QR 확인"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M10.3882 10.4939C10.3694 10.5503 10.35 10.6473 10.35 10.8L10.35 11.7092L13.05 11.7C13.6387 11.7 14.2455 11.8478 14.6988 12.3009C15.1521 12.754 15.3 13.3607 15.3 13.9492V14.4C15.3 14.8971 14.8971 15.3 14.4 15.3C13.9029 15.3 13.5 14.8971 13.5 14.4V13.9492C13.5 13.7968 13.4806 13.7 13.4619 13.6438C13.4447 13.5924 13.4291 13.5767 13.4263 13.574C13.4236 13.5713 13.4077 13.5554 13.3561 13.5382C13.2997 13.5194 13.2027 13.5 13.05 13.5L10.35 13.5092V14.4092C10.35 14.9062 9.94706 15.3092 9.45 15.3092C8.95294 15.3092 8.55 14.9062 8.55 14.4092L8.55001 10.8C8.55001 10.2113 8.6978 9.60452 9.15088 9.15124C9.60403 8.6979 10.2107 8.55 10.7992 8.55H10.8038H13.0546C13.5516 8.55253 13.9525 8.95752 13.95 9.45457C13.9475 9.95162 13.5425 10.3525 13.0454 10.35L10.7972 10.35C10.6459 10.3502 10.5498 10.3695 10.4938 10.3881C10.4424 10.4053 10.4268 10.4209 10.424 10.4237C10.4213 10.4264 10.4054 10.4423 10.3882 10.4939Z" fill="currentColor"/>
              <path d="M1.8 2.25C1.8 2.00147 2.00147 1.8 2.25 1.8H4.5C4.74853 1.8 4.95 2.00147 4.95 2.25V4.5C4.95 4.74853 4.74853 4.95 4.5 4.95H2.25C2.00147 4.95 1.8 4.74853 1.8 4.5V2.25Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 0H4.5C5.74264 0 6.75 1.00736 6.75 2.25V4.5C6.75 5.74264 5.74264 6.75 4.5 6.75H2.25C1.00736 6.75 0 5.74264 0 4.5V2.25C0 1.00736 1.00736 0 2.25 0ZM2.25 1.8C2.00147 1.8 1.8 2.00147 1.8 2.25V4.5C1.8 4.74853 2.00147 4.95 2.25 4.95H4.5C4.74853 4.95 4.95 4.74853 4.95 4.5V2.25C4.95 2.00147 4.74853 1.8 4.5 1.8H2.25Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M10.8 0H13.05C14.2926 0 15.3 1.00736 15.3 2.25V4.5C15.3 5.74264 14.2926 6.75 13.05 6.75H10.8C9.55736 6.75 8.55 5.74264 8.55 4.5V2.25C8.55 1.00736 9.55736 0 10.8 0ZM10.8 1.8C10.5515 1.8 10.35 2.00147 10.35 2.25V4.5C10.35 4.74853 10.5515 4.95 10.8 4.95H13.05C13.2985 4.95 13.5 4.74853 13.5 4.5V2.25C13.5 2.00147 13.2985 1.8 13.05 1.8H10.8Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 8.55H4.5C5.74264 8.55 6.75 9.55736 6.75 10.8V13.05C6.75 14.2926 5.74264 15.3 4.5 15.3H2.25C1.00736 15.3 0 14.2926 0 13.05V10.8C0 9.55736 1.00736 8.55 2.25 8.55ZM2.25 10.35C2.00147 10.35 1.8 10.5515 1.8 10.8V13.05C1.8 13.2985 2.00147 13.5 2.25 13.5H4.5C4.74853 13.5 4.95 13.2985 4.95 13.05V10.8C4.95 10.5515 4.74853 10.35 4.5 10.35H2.25Z" fill="currentColor"/>
            </svg>
          </button>
        {/if}
      </div>
      {#each productInfoItems as item (item.key)}
        <div class="info-section">
          {#if item.imageUrl}
            <div class="info-row">
              <span class="info-label">상품 이미지</span>
              <div class="info-value">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  class="product-thumb"
                  width="60"
                  height="60"
                />
              </div>
            </div>
          {/if}
          <div class="info-row">
            <span class="info-label">상품명</span>
            <span class="info-value fw-bold">
              {item.name}
              {#if item.isSibling}
                <span class="sibling-status-badge">{STATUS_LABEL[item.status ?? ''] ?? item.status}</span>
              {/if}
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">상품 코드</span>
            <span class="info-value mono">{item.code ?? '-'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">카테고리</span>
            <span class="info-value">{item.category ?? '-'}</span>
          </div>
        </div>
      {/each}
      {#if rentalSiblingsLoading}
        <div class="loading-box">함께 담긴 상품 조회 중...</div>
      {:else if rentalSiblingsError}
        <div class="error-box">{rentalSiblingsError}</div>
      {/if}

      <!-- 옵션상품 — 메인상품 외 예약에 함께 담긴 상품(reservation_options). 없으면 섹션 자체 미표시 -->
      {#if optionsLoading}
        <div class="section-title">옵션상품</div>
        <div class="loading-box">옵션상품 조회 중...</div>
      {:else if optionsError}
        <div class="section-title">옵션상품</div>
        <div class="error-box">{optionsError}</div>
      {:else if options.length > 0}
        <div class="section-title">옵션상품 ({options.length}개)</div>
        <div class="info-section">
          {#each options as opt (opt.id)}
            <div class="info-row">
              <span class="info-label">{opt.option_name}</span>
              <span class="info-value">
                {opt.qty}개
                {#if opt.product_code}
                  <code class="mono option-code">{opt.product_code}</code>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- 대여 일정 -->
      <div class="section-title">대여 일정</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">대여기간</span>
          <span class="info-value">{formatDate(row.rental_start)} ~ {formatDate(row.rental_end)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">대여일수</span>
          <span class="info-value">{row.rental_days != null ? `${row.rental_days}일` : '-'}</span>
        </div>
      </div>

      <!-- 대여 방법 -->
      <div class="section-title">대여 방법</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">수령방식</span>
          <span class="info-value">{row.pickup_method ? (PICKUP_LABELS[row.pickup_method] ?? row.pickup_method) : '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">수령 일시</span>
          <span class="info-value">{formatDate(row.rental_start)}{row.pickup_time ? ' ' + row.pickup_time : ''}</span>
        </div>
        <div class="info-row">
          <span class="info-label">반납방식</span>
          <span class="info-value">{row.return_method ? (PICKUP_LABELS[row.return_method] ?? row.return_method) : '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">반납 일시</span>
          <span class="info-value">{formatDate(row.rental_end)}{row.return_time ? ' ' + row.return_time : ''}</span>
        </div>
      </div>

      <!-- 운송장 정보 — 관리자가 택배사·운송장 번호를 등록하면 배송추적 카드에 반영됨 -->
      <div class="section-title">운송장 정보</div>
      {#if trackingLoading}
        <div class="loading-box">운송장 정보 조회 중...</div>
      {:else}
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">택배사</span>
            <input
              class="tracking-input"
              type="text"
              placeholder="예: CJ대한통운, 한진택배"
              bind:value={trackingCourierCode}
            />
          </div>
          <div class="info-row">
            <span class="info-label">운송장 번호</span>
            <input
              class="tracking-input"
              type="text"
              placeholder="운송장 번호 입력"
              bind:value={trackingNumber}
            />
          </div>
        </div>
        <div class="tracking-action-row">
          <button
            class="btn-tracking-save"
            onclick={saveTracking}
            disabled={trackingSaving}
          >
            {trackingSaving ? '저장 중...' : '운송장 저장'}
          </button>
          {#if trackingError}
            <span class="tracking-error-msg">{trackingError}</span>
          {/if}
        </div>
      {/if}

      <!-- 상태 액션 버튼 -->
      <div class="action-section">
        <!-- 예약 단계: 승인하기 / 거부 — reservation 뷰 전용 -->
        {#if row.status === 'hold' && !isRentalView}
          {#if orderSiblings.length > 0}
            <p class="order-batch-note">
              이 예약은 같은 주문의 다른 상품 {orderSiblings.length}건과 함께 진행 중입니다.
              모든 상품이 승인 완료되면 알림이 한 번에 발송됩니다.
            </p>
          {/if}
          <form
            method="POST"
            action="/cms/reservation?/approveReservation"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 승인되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <button type="submit" class="btn-primary" disabled={isSubmitting}>승인하기</button>
          </form>
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 거부되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value="cancelled" />
            <button type="submit" class="btn-danger-sm" disabled={isSubmitting}>거부</button>
          </form>

        <!-- 대여 라이프사이클: 출고 처리 → 수령 확인 → 반납 접수/처리 → 완료 처리 -->
        {:else if nextStatus(row.status, row.pickup_method, row.return_method)}
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('상태가 변경되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value={nextStatus(row.status, row.pickup_method, row.return_method)} />
            <button type="submit" class="btn-action" disabled={isSubmitting}>
              {nextLabel(row.status, row.pickup_method, row.return_method)}
            </button>
          </form>
        {/if}

        <!-- 예약 취소 — reservation 뷰 전용 (대여 현황에서는 별도 처리 플로우) -->
        {#if !isTerminal(row.status) && row.status !== 'hold' && !isRentalView}
          <form
            method="POST"
            action="/cms/reservation?/updateStatus"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') { csToast.success('예약이 취소되었습니다.'); onrefresh() }
                else csToast.error('처리 중 오류가 발생했습니다.')
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="status" value="cancelled" />
            <button type="submit" class="btn-cancel" disabled={isSubmitting}>예약 취소</button>
          </form>
        {/if}
      </div>

      <!-- 채팅 알림 발송 -->
      {#if notifyType && row.status !== 'cancelled' && row.status !== 'damage_claimed'}
        <div class="notify-section">
          <form
            method="POST"
            action="/cms/rentals?/sendChatNotify"
            use:enhance={() => {
              isSubmitting = true
              return async ({ result, update }) => {
                isSubmitting = false
                if (result.type === 'success') {
                  csToast.success('채팅 알림을 발송했습니다.')
                  if (notifyType) markNotifySent(row.reservation_id, notifyType)
                } else {
                  csToast.error('알림 발송에 실패했습니다.')
                }
                await update()
              }
            }}
          >
            <input type="hidden" name="reservation_id" value={row.reservation_id} />
            <input type="hidden" name="notify_type" value={notifyType} />
            <button
              type="submit"
              class="btn-notify"
              disabled={isSubmitting}
              onclick={(e) => {
                if (notifyType && wasRecentlySent(row.reservation_id, notifyType)) {
                  if (!window.confirm('이미 최근에 발송된 알림입니다. 다시 보내시겠습니까?')) {
                    e.preventDefault()
                  }
                }
              }}
            >
              {chatNotifyLabel(notifyType)}
            </button>
          </form>
        </div>
      {/if}
    {/if}

    <!-- ─── Tab 2: 고객정보 ─── -->
    {#if activeTab === 'customer'}
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">고객명</span>
          <span class="info-value fw-bold">{row.customer_name ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">{row.customer_email ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">전화번호</span>
          <span class="info-value">{row.customer_phone ?? '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">멤버십 등급</span>
          <span class="info-value grade-badge grade-{row.membership_grade}">
            {gradeLabel(row.membership_grade)}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">크레이지스코어</span>
          <div class="score-wrap">
            <span class="score-num">{row.credit_score}점</span>
            <div class="score-bar-track">
              <div class="score-bar-fill" style="width:{row.credit_score}%"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="action-section">
        <a
          href="/cms/customers?selected={row.user_id}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-action"
        >고객 상세 보기 ↗</a>
      </div>
    {/if}

    <!-- ─── Tab 3: 결제정보 ─── -->
    {#if activeTab === 'payment'}
      <!-- 주문 정보 (상시 표시) -->
      <div class="section-title">주문 정보</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">주문번호</span>
          <span class="info-value mono">
            {paymentDetail?.toss_order_id ?? (paymentLoading ? '조회 중…' : (row.order_key ?? '-'))}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">기본 이용요금</span>
          <span class="info-value fw-bold">{formatAmount(row.order_amount)}</span>
        </div>
        {#if row.discount_amount != null && row.discount_amount > 0}
          <div class="info-row">
            <span class="info-label">주문 할인</span>
            <span class="info-value amount-discount">-{formatAmount(row.discount_amount)}</span>
          </div>
        {/if}
        <div class="info-row">
          <span class="info-label">결제 상태</span>
          <span class="info-value">{row.payment_status ?? '-'}</span>
        </div>
      </div>

      <!-- 같은 주문의 다른 상품 — 한 번에 결제된 여러 예약이 있을 때만 노출 -->
      {#if orderSiblingsLoading}
        <div class="section-title">같은 주문의 다른 상품</div>
        <div class="loading-box">주문 상품 조회 중...</div>
      {:else if orderSiblingsError}
        <div class="section-title">같은 주문의 다른 상품</div>
        <div class="error-box">{orderSiblingsError}</div>
      {:else if orderSiblings.length > 0}
        <div class="section-title">같은 주문의 다른 상품 ({orderSiblings.length}개)</div>
        <div class="info-section">
          {#each orderSiblings as sib (sib.reservationId)}
            <div class="info-row">
              <span class="info-label">{sib.reservationCode ?? `CZ-${String(sib.reservationId).padStart(5, '0')}`}</span>
              <span class="info-value">{sib.productName} · {STATUS_LABEL[sib.status] ?? sib.status}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- PG 결제 정보 (lazy-fetch) -->
      <div class="section-title">PG 결제 정보</div>
      {#if paymentLoading}
        <div class="loading-box">결제 정보 조회 중...</div>
      {:else if paymentError}
        <div class="error-box">{paymentError}</div>
      {:else if !paymentDetail}
        <div class="empty-box">결제 정보가 없습니다. (결제 전 예약)</div>
      {:else}
        <div class="info-section">
          {#if paymentDetail.coupon_discount != null && paymentDetail.coupon_discount > 0}
            <div class="info-row">
              <span class="info-label">쿠폰 할인</span>
              <span class="info-value amount-discount">-{formatAmount(paymentDetail.coupon_discount)}</span>
            </div>
          {/if}
          {#if paymentDetail.point_amount != null && paymentDetail.point_amount > 0}
            <div class="info-row">
              <span class="info-label">포인트 적용</span>
              <span class="info-value amount-discount">-{formatAmount(paymentDetail.point_amount)}</span>
            </div>
          {/if}
          {#if paymentDetail.paid_amount != null}
            <div class="info-row">
              <span class="info-label">부가세 (10%)</span>
              <span class="info-value">
                {formatAmount(Math.floor(paymentDetail.paid_amount / 11))}
                <span class="info-note">포함</span>
              </span>
            </div>
          {/if}
          <div class="info-row highlight-row">
            <span class="info-label">최종 결제금액</span>
            <span class="info-value fw-bold">{formatAmount(paymentDetail.paid_amount)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">결제수단</span>
            <span class="info-value">
              {paymentDetail.payment_method
                ? (PAYMENT_METHOD_LABELS[paymentDetail.payment_method] ?? paymentDetail.payment_method)
                : '-'}
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Toss 승인코드</span>
            <span class="info-value mono small">{paymentDetail.payment_key ?? '-'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">카드 승인번호</span>
            <span class="info-value mono small">{cardApprovalNumber(paymentDetail)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">결제 승인시간</span>
            <span class="info-value">{formatDateTime(paymentDetail.confirmed_at)}</span>
          </div>
        </div>
      {/if}

      <div class="action-section">
        <button class="btn-action" disabled title="결제 연동 완료 후 활성화 예정">환불 처리</button>
      </div>
    {/if}

    <!-- ─── Tab 4: 계약서 ─── -->
    {#if activeTab === 'contract'}
      <RentalContractViewer
        contractId={row.contract_id}
        contractPdfUrl={row.contract_pdf_url}
        autoSignedAt={row.auto_signed_at}
        customerSignedAt={row.customer_signed_at}
        signingToken={row.signing_token}
        signingsentAt={row.signing_sent_at}
        reservationId={row.reservation_id}
        productName={row.product_name}
        productCode={row.product_code}
        productCategory={row.product_category}
        rentalStart={row.rental_start}
        rentalEnd={row.rental_end}
        orderAmount={row.order_amount}
        pickupMethod={row.pickup_method}
        pickupTime={row.pickup_time}
        returnMethod={row.return_method}
        returnTime={row.return_time}
        {isRentalView}
        onrefresh={onrefresh}
      />
    {/if}

  </div>
</div>

{#if enableQrVerify}
  <QrScannerOverlay
    bind:open={qrOverlayOpen}
    onDetected={handleProductQrDetected}
    onClose={() => (qrOverlayOpen = false)}
  />
{/if}

<style>
  .panel {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* 패널 헤더 */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .panel-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .panel-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .panel-id {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    font-family: monospace;
  }
  .panel-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
  }
  .payment-contract-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: rgba(245,158,11,0.12);
    color: var(--cs-warning);
  }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: none;
    cursor: pointer;
    font-size: 14px; color: var(--cs-text-mid);
    border-radius: 6px;
    transition: background 0.12s;
  }
  .close-btn:hover { background: var(--cs-surface-gray); }

  /* 탭 */
  .panel-tabs {
    display: flex;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    padding: 10px 8px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font: var(--text-pc-script-12);
    font-weight: 400;
    color: var(--cs-text-mid);
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
  }
  .tab:hover   { color: var(--cs-purple); }
  .tab-active  { color: var(--cs-purple); border-bottom-color: var(--cs-purple); font-weight: 700; }

  /* 패널 바디 */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px 20px;
    display: block;
  }
  .panel-body > * + * {
    margin-top: 10px;
  }

  /* 섹션 타이틀 */
  .section-title {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    padding: 4px 0 2px;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-title-row .section-title { padding: 4px 0 2px; }

  .qr-verify-icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-purple);
    cursor: pointer;
  }

  /* 정보 섹션 */
  .info-section {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    overflow: hidden;
  }
  .info-row {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--cs-lilac);
    gap: 12px;
  }
  .info-row:last-child { border-bottom: none; }
  .highlight-row { background: rgba(59,47,138,0.04); }

  .info-label {
    flex: 0 0 96px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 700;
  }
  .info-value {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .info-note {
    font-size: 11px;
    color: var(--cs-text-light);
    margin-left: 4px;
  }
  .fw-bold { font-weight: 700; }
  .mono    { font-family: monospace; }
  .small   { font-size: 11px; word-break: break-all; }
  .amount-discount { color: var(--cs-error, #ef4444); }
  .option-code {
    display: inline-block;
    margin-left: 8px;
    font-size: 11px;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text-mid);
  }
  .sibling-status-badge {
    display: inline-block;
    margin-left: 8px;
    font-size: 11px;
    font-weight: 400;
    background: var(--cs-surface-gray);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--cs-text-mid);
  }

  /* 상품 썸네일 */
  .product-thumb {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    display: block;
  }

  /* 로딩/에러/빈 상자 */
  .loading-box, .error-box, .empty-box {
    padding: 20px 16px;
    text-align: center;
    font: var(--text-pc-script-12);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
  }
  .loading-box { color: var(--cs-text-mid); }
  .error-box   { color: var(--cs-error, #ef4444); background: rgba(239,68,68,0.04); }
  .empty-box   { color: var(--cs-text-light); }

  /* 등급 배지 */
  .grade-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }
  .grade-admin { background: var(--cs-lilac);        color: var(--cs-purple-dark); }

  /* 스코어 */
  .score-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }
  .score-num { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .score-bar-track {
    flex: 1;
    height: 6px;
    background: var(--cs-lilac);
    border-radius: 3px;
    overflow: hidden;
  }
  .score-bar-fill {
    height: 100%;
    background: var(--cs-purple);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  /* 액션 섹션 */
  .action-section {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .order-batch-note {
    flex-basis: 100%;
    margin: 0 0 4px;
    padding: 8px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    line-height: 1.5;
  }

  /* 버튼 */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 20px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-action {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    text-decoration: none;
  }
  .btn-action:hover    { background: var(--cs-purple-hover); }
  .btn-action:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-danger-sm {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-error);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .btn-danger-sm:hover    { opacity: 0.85; }
  .btn-danger-sm:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-cancel {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: #FFCFCF;
    color: var(--cs-error);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .btn-cancel:hover    { opacity: 0.85; }
  .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 운송장 정보 섹션 */
  .tracking-input {
    flex: 1;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    background: var(--cs-white);
    outline: none;
    transition: border-color 0.12s;
  }
  .tracking-input:focus {
    border-color: var(--cs-purple);
  }
  .tracking-input::placeholder {
    color: var(--cs-text-light);
  }
  .tracking-action-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
  .btn-tracking-save {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: var(--cs-surface-gray);
    color: var(--cs-purple);
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-tracking-save:hover    { background: rgba(59,47,138,0.08); }
  .btn-tracking-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .tracking-error-msg {
    font: var(--text-pc-script-12);
    color: var(--cs-error, #ef4444);
  }

  /* 채팅 알림 섹션 */
  .notify-section {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed var(--cs-lilac);
  }
  .btn-notify {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 16px;
    background: transparent;
    color: var(--cs-purple);
    border: 1px solid var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-notify:hover    { background: rgba(59,47,138,0.08); }
  .btn-notify:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
