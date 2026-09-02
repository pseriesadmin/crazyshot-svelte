<script lang="ts">
  import { enhance } from '$app/forms'
  import { goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import RentalContractViewer from '$lib/components/cms/RentalContractViewer.svelte'
  import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
  import QrScannerOverlay from '$lib/components/common/QrScannerOverlay.svelte'
  import { nextStatus, nextLabel } from '$lib/utils/rentalTransition'
  import { extractProductId, isProductMatch } from '$lib/utils/qrProductId'
  import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
  import { isLockerHour } from '$lib/utils/lockerTimeRange'
  import { DHERO_STATUS_LABEL } from '$lib/utils/dheroLabels'
  import ReservationProductFinderModal from '$lib/components/cms/ReservationProductFinderModal.svelte'
  import type { FinderSelectedProduct } from '$lib/components/cms/ReservationProductFinderModal.svelte'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'

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
    // Migration 344: 두발히어로 배송 상태 (nullable)
    dhero_status?:         string | null
    dhero_status_code?:    number | null
    dhero_return_book_id?: string | null
    dhero_synced_at?:      string | null
    tracking_number?:      string | null
  }

  interface PaymentDetail {
    toss_order_id:          string | null
    payment_key:            string | null
    payment_method:         string | null
    total_amount:           number | null
    paid_amount:            number | null
    point_amount:           number | null
    coupon_discount:        number | null
    confirmed_at:           string | null
    toss_response:          Record<string, unknown> | null
    status:                 string | null   // 'done' | 'cancelled' | null
    refund_failed_at:       string | null   // RSV-B-C1: Toss취소 성공 후 RPC 실패 시 기록
    refund_failure_reason:  string | null
  }

  interface Props {
    row:          RentalListRow
    onclose:      () => void
    onrefresh:    () => void
    stepFilter?:  string[]
    isRentalView?: boolean   // true = /cms/rentals 컨텍스트 (예약 단계 UI 숨김)
    enableQrVerify?: boolean // true일 때만 "상품 정보"에 QR 확인 아이콘 노출 (모바일 대여목록 전용)
    cmsRole?:     string | null // 무인보관함 비밀번호 입력 UI manager 이상 게이팅용(2026-08-20)
    /** 최초 마운트 시 활성화할 탭 — 미지정 시 기존과 동일하게 'rental'(대여정보).
        컴포넌트가 마운트된 이후 row가 갱신(onrefresh)돼도 재적용되지 않음(마운트 시 1회만) —
        관리자가 이미 다른 탭으로 전환한 상태를 되돌리지 않기 위함 */
    initialTab?:  'rental' | 'customer' | 'payment' | 'contract'
    /** 예약 단계 상태 변경(승인·거부·취소) 완료 시 호출 — /cms/reservation에서 closePanel에 연결.
        /cms/rentals에서는 미사용(isRentalView=true일 때 undefined가 기본값). */
    onstatuschange?: () => void
  }
  let { row, onclose, onrefresh, stepFilter, isRentalView = false, enableQrVerify = false, cmsRole = null, initialTab, onstatuschange }: Props = $props()

  // RSV-B-B3: 이 derived는 "환불 처리" + "보관함 비밀번호" 두 기능 모두의 권한 게이트이므로
  // canManagePaymentAndLocker 대신 실제 역할을 반영한 이름으로 변경.
  let canManagePaymentAndLocker = $derived(hasSettingsAccess(cmsRole ?? ''))

  // Stage 4 확장 기능 권한 게이트:
  // canEditProducts — hold 상태이고 결제 미완료(payment_confirmed_at IS NULL)인 경우만 상품 추가/삭제 허용
  let canEditProducts = $derived(
    !isRentalView && row.status === 'hold' && !row.payment_confirmed_at
  )
  // canReassignProductCode — hold 또는 계약완료(confirmed) + 운송장 미등록 상태일 때 상품코드 재배정 허용
  let canReassignProductCode = $derived(
    !isRentalView &&
    (row.status === 'hold' ||
      (row.status === 'confirmed' && !row.tracking_number))
  )
  let showLockerPasswordField = $derived(
    canManagePaymentAndLocker &&
    ((row.pickup_method === 'visit' && isLockerHour(row.pickup_time)) ||
     (row.return_method === 'visit' && isLockerHour(row.return_time)))
  )

  let qrOverlayOpen = $state(false)

  // Stage 4 — 상품 편집 상태 (canEditProducts / canReassignProductCode)
  let deletePendingKeys     = $state<Set<string>>(new Set())  // 2-step delete: 1차 클릭 후 키 보존
  let modifiedKeys          = $state<Set<string>>(new Set())  // 클라이언트 "수정" 배지 (현재 사용 예약)
  let showFinderModal       = $state(false)
  let finderModalPurpose    = $state<'product' | 'option'>('product')
  let reassignTargetId      = $state<number | null>(null)     // 재배정 중인 예약 ID
  let availableUnits        = $state<{ id: string; product_code: string | null }[]>([])
  let availableUnitsLoading = $state(false)
  let availableUnitsError   = $state<string | null>(null)
  let availableUnitsFetchedForId = $state<number | null>(null)
  let reassigning           = $state(false)
  let addingProduct         = $state(false)
  let addingOption          = $state(false)
  let deletingKey           = $state<string | null>(null)
  // deleteTimers는 비반응형 Map — $state로 감싸면 Set 변이가 반응성 오류를 유발
  const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // QR 일치 시: '계약완료'는 반출로, '반납중'은 반납으로 확인 탭 없이 즉시 자동 기록.
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

  let activeTab   = $state<'rental' | 'customer' | 'payment' | 'contract'>(initialTab ?? 'rental')
  let isSubmitting = $state(false)

  // 환불 처리 상태 (결제정보 탭 PUT /api/cms/reservations/[id]/payment)
  let isRefunding = $state(false)
  let refundError = $state<string | null>(null)

  async function handleRefund(): Promise<void> {
    // RSV-B-B1: 환불 확인 다이얼로그에 실결제 금액 포함 — 관리자가 어떤 금액을 환불하는지 명확히 인지하도록.
    const amountStr = paymentDetail?.paid_amount != null
      ? `환불 금액: ${paymentDetail.paid_amount.toLocaleString('ko-KR')}원\n`
      : ''
    // 환불 사유 입력 (prompt — 새 모달 컴포넌트 신설 없이 가장 가벼운 CMS 인라인 패턴)
    const reason = window.prompt('환불 사유를 입력해 주세요.\n(비워 두면 "관리자 환불"로 기록됩니다.)', '')
    if (reason === null) return   // 취소 버튼: 환불 중단
    const cancelReason = reason.trim() || '관리자 환불'
    if (!window.confirm(`전액 환불하시겠습니까?\n${amountStr}사유: ${cancelReason}\n\n이 작업은 취소할 수 없습니다.`)) return
    isRefunding = true
    refundError = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/payment`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cancelReason }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; cancelledIds?: number[] }
      if (!res.ok || !data.ok) {
        refundError = data.error ?? '환불 처리에 실패했습니다.'
      } else {
        csToast.success('환불이 완료되었습니다.')
        // RSV-B-B2: 결제 정보 캐시 무효화 — 다음 결제정보 탭 진입 시 새 데이터 로드
        fetchedForId = null
        paymentDetail = null
        onrefresh()
      }
    } catch {
      refundError = '네트워크 오류가 발생했습니다. 다시 시도해 주세요.'
    } finally {
      isRefunding = false
    }
  }

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
    paymentConfirmedAt: string | null  // 2026-09-03: 유닛별 편집가능 판정용
    trackingNumber:     string | null  // 2026-09-03: 유닛별 재배정가능 판정용
    productName:     string
    productCode:     string | null
    productCategory: string | null
    productImageUrl: string | null
    parentProductId: string | null  // Stage 4: 상품 그룹화 UI용
  }

  let rentalSiblingsFetchedForId = $state<number | null>(null)
  let rentalSiblings              = $state<RentalSibling[]>([])
  let rentalSiblingsLoading       = $state(false)
  let rentalSiblingsError         = $state<string | null>(null)
  let mainParentProductId         = $state<string | null>(null)  // Stage 4: 메인 예약 상품 그룹 ID

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
    mainParentProductId   = null
    rentalSiblingsError    = null
    rentalSiblingsLoading  = true

    fetch(`/api/cms/reservations/${id}/rental-siblings`)
      .then(r => r.json())
      .then(d => {
        if (rentalSiblingsFetchedForId === id) {
          rentalSiblings = Array.isArray(d.siblings) ? d.siblings : []
          mainParentProductId = (d.mainParentProductId as string | null | undefined) ?? null
          rentalSiblingsLoading = false
        }
      })
      .catch(() => {
        if (rentalSiblingsFetchedForId === id) { rentalSiblingsError = '함께 담긴 상품 정보를 불러오지 못했습니다.'; rentalSiblingsLoading = false }
      })
  })

  interface ProductInfoItem {
    key:             string
    isSibling:       boolean
    imageUrl:        string | null
    name:            string
    code:            string | null
    category:        string | null
    status?:         string
    reservationId:   number          // Stage 4: 삭제/재배정 API 호출용
    parentProductId: string | null   // Stage 4: 동일 그룹 여부 판단용
    paymentConfirmedAt: string | null  // 2026-09-03: 유닛별 편집가능 판정용
    trackingNumber:     string | null  // 2026-09-03: 유닛별 재배정가능 판정용
  }

  // "상품 정보" 섹션 반복 렌더링용 — 현재 선택된 상품(row) + 같은 주문의 형제 상품(rentalSiblings)을
  // 하나의 배열로 정규화. 1개든 N개든 동일한 info-row 마크업을 그대로 재사용해 반복 표시한다.
  let productInfoItems = $derived<ProductInfoItem[]>([
    {
      key: `main-${row.reservation_id}`, isSibling: false,
      imageUrl: row.product_image_url, name: row.product_name,
      code: row.product_code, category: row.product_category,
      reservationId: row.reservation_id,
      parentProductId: mainParentProductId,
      paymentConfirmedAt: row.payment_confirmed_at ?? null,
      trackingNumber: row.tracking_number ?? null,
    },
    ...rentalSiblings.map(s => ({
      key: `sib-${s.reservationId}`, isSibling: true,
      imageUrl: s.productImageUrl, name: s.productName,
      code: s.productCode, category: s.productCategory, status: s.status,
      reservationId: s.reservationId,
      parentProductId: s.parentProductId,
      paymentConfirmedAt: s.paymentConfirmedAt,
      trackingNumber: s.trackingNumber,
    })),
  ])

  // 2026-09-03 버그 수정: 형제 유닛이 앵커(row)와 무관하게 개별적으로 이미 결제확인됐거나
  // 만료·취소 등으로 상태가 벗어나 있을 수 있어, canEditProducts/canReassignProductCode
  // (앵커 기준)만으로 버튼을 노출하면 "눌러야만 서버가 거부하는" 눈속임 버튼이 된다.
  // 유닛 자신의 상태까지 함께 확인해 애초에 성공 못 할 버튼은 렌더링하지 않는다.
  function canEditUnit(unit: ProductInfoItem): boolean {
    if (!canEditProducts) return false
    if (!unit.isSibling) return true  // 메인 유닛은 canEditProducts에 이미 자신의 상태가 반영됨
    return unit.status === 'hold' && !unit.paymentConfirmedAt
  }
  function canReassignUnit(unit: ProductInfoItem): boolean {
    if (!canReassignProductCode) return false
    if (!unit.isSibling) return true
    return unit.status === 'hold' || (unit.status === 'confirmed' && !unit.trackingNumber)
  }

  interface ProductGroupView {
    key:            string             // parentProductId, 없으면 `single-${item.key}` 폴백
    representative: ProductInfoItem    // 상품명·이미지·카테고리 표시용(그룹당 1회만 표시)
    units:          ProductInfoItem[]  // 실물 유닛(=상품 코드 행) 목록 — 이게 "수량"
  }

  // Stage 4(UX 재수정, 2026-09-03): 동일 부모상품(parentProductId) 기준으로 그룹당 카드 1장만
  // 렌더링 — 이전 버전은 "수량 스텝퍼"만 첫 유닛에 붙이고 나머지 유닛은 여전히 각자 별도
  // info-section 카드로 중복 렌더링해, 수량을 늘릴 때마다 똑같이 생긴 카드가 반복 노출되고
  // 그 새 카드에는 수량 조작 UI 자체가 없는 UX 불일치가 있었음(Stephen 스크린샷으로 발견).
  // 이제 그룹 하나 = 카드 하나, 상품명/이미지/카테고리는 대표 유닛 기준 1회만, "상품 코드"
  // 행만 유닛 수만큼 반복 — "수량"이 곧 그 카드 안의 상품코드 행 개수로 시각적으로 일치한다.
  // parentProductId가 없는 항목(레거시/미확인 데이터)은 각자 단독 그룹으로 폴백(그룹화 안 됨).
  let productGroups = $derived.by(() => {
    const order: string[] = []
    const map = new Map<string, ProductGroupView>()
    for (const item of productInfoItems) {
      const key = item.parentProductId ?? `single-${item.key}`
      let g = map.get(key)
      if (!g) {
        g = { key, representative: item, units: [] }
        map.set(key, g)
        order.push(key)
      }
      g.units.push(item)
    }
    return order.map((k) => map.get(k)!)
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Stage 4: 상품 편집 핸들러 (canEditProducts / canReassignProductCode)
  // ─────────────────────────────────────────────────────────────────────────────

  function openProductFinder(): void {
    finderModalPurpose = 'product'
    showFinderModal = true
  }

  function openOptionFinder(): void {
    finderModalPurpose = 'option'
    showFinderModal = true
  }

  async function handleFinderSelect(product: FinderSelectedProduct): Promise<void> {
    showFinderModal = false
    if (finderModalPurpose === 'option') {
      const existing = options.find(o => o.option_name === product.name)
      if (existing) {
        await handleOptionQtyChange(existing.id, existing.qty + 1)
      } else {
        await handleAddOption(product)
      }
    } else {
      await handleAddProduct(product)
    }
  }

  async function handleAddProduct(product: FinderSelectedProduct): Promise<void> {
    addingProduct = true
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.id }),
      })
      const d = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '상품 추가에 실패했습니다.')
      } else {
        csToast.success(`${product.name}이(가) 추가됐습니다.`)
        modifiedKeys = new Set([...modifiedKeys, `prod-${product.id}`])
        rentalSiblingsFetchedForId = null  // 형제 목록 강제 재조회
        onrefresh()
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      addingProduct = false
    }
  }

  // 그룹(부모상품 기준)에 재고 유닛 1개 추가 — 상품찾기 모달 재오픈 없이 즉시 상품코드 행 하나를
  // 더 추가한다("수량 증가" = 이 그룹 카드에 상품 코드 행이 하나 더 생기는 것으로 표현).
  function handleGroupQtyIncrease(item: ProductInfoItem): void {
    if (!item.parentProductId) return
    void handleAddProduct({
      id: item.parentProductId,
      name: item.name,
      product_code: null,
      image_url: null,
      price_24h: null,
    })
  }
  // "수량 감소"는 더 이상 그룹 단위 스텝퍼로 존재하지 않는다 — 각 "상품 코드" 행 자체에 붙는
  // 삭제(휴지통) 버튼이 정확히 그 유닛(=그 행)을 대상으로 handleDeleteProduct를 호출한다
  // (아래 템플릿 참고, 어느 유닛을 지울지 관리자가 직접 행 단위로 선택 — 자동으로 "마지막
  // 유닛" 등을 임의로 고르지 않음).

  async function handleAddOption(product: FinderSelectedProduct): Promise<void> {
    addingOption = true
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option_product_id: product.id,
          option_name: product.name,
          qty: 1,
          unit_price: product.price_24h ?? 0,
        }),
      })
      const d = await res.json() as { success?: boolean; option_id?: number; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '옵션 추가에 실패했습니다.')
      } else {
        csToast.success(`옵션 ${product.name}이(가) 추가됐습니다.`)
        if (d.option_id != null) modifiedKeys = new Set([...modifiedKeys, `opt-${d.option_id}`])
        optionsFetchedForId = null  // 옵션 목록 강제 재조회
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      addingOption = false
    }
  }

  function handleDeleteProduct(item: ProductInfoItem): void {
    const key = `prod-${item.reservationId}`
    if (deletePendingKeys.has(key)) {
      // 2차 클릭 — 실제 삭제 실행
      clearTimeout(deleteTimers.get(key))
      deleteTimers.delete(key)
      deletePendingKeys = new Set([...deletePendingKeys].filter(k => k !== key))
      doDeleteProduct(item)
    } else {
      // 1차 클릭 — 대기 상태 진입 (4초 후 자동 해제)
      csToast.warning('한 번 더 클릭하면 삭제됩니다.')
      deletePendingKeys = new Set([...deletePendingKeys, key])
      const timer = setTimeout(() => {
        deletePendingKeys = new Set([...deletePendingKeys].filter(k => k !== key))
        deleteTimers.delete(key)
      }, 4000)
      deleteTimers.set(key, timer)
    }
  }

  async function doDeleteProduct(item: ProductInfoItem): Promise<void> {
    const key = `prod-${item.reservationId}`
    deletingKey = key
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/products`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_reservation_id: item.reservationId }),
      })
      const d = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '상품 삭제에 실패했습니다.')
      } else {
        csToast.success(`${item.name}이(가) 삭제됐습니다.`)
        rentalSiblingsFetchedForId = null
        onrefresh()
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      deletingKey = null
    }
  }

  function handleDeleteOption(opt: ReservationOption): void {
    const key = `opt-${opt.id}`
    if (deletePendingKeys.has(key)) {
      clearTimeout(deleteTimers.get(key))
      deleteTimers.delete(key)
      deletePendingKeys = new Set([...deletePendingKeys].filter(k => k !== key))
      doDeleteOption(opt)
    } else {
      csToast.warning('한 번 더 클릭하면 삭제됩니다.')
      deletePendingKeys = new Set([...deletePendingKeys, key])
      const timer = setTimeout(() => {
        deletePendingKeys = new Set([...deletePendingKeys].filter(k => k !== key))
        deleteTimers.delete(key)
      }, 4000)
      deleteTimers.set(key, timer)
    }
  }

  async function doDeleteOption(opt: ReservationOption): Promise<void> {
    const key = `opt-${opt.id}`
    deletingKey = key
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/options`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: opt.id }),
      })
      const d = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '옵션 삭제에 실패했습니다.')
      } else {
        csToast.success(`옵션 ${opt.option_name}이(가) 삭제됐습니다.`)
        optionsFetchedForId = null
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      deletingKey = null
    }
  }

  async function handleOptionQtyChange(optId: number, newQty: number): Promise<void> {
    if (newQty < 1) return
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: optId, qty: newQty }),
      })
      const d = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '수량 변경에 실패했습니다.')
      } else {
        modifiedKeys = new Set([...modifiedKeys, `opt-${optId}`])
        optionsFetchedForId = null  // 서버 반영 값으로 재조회
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    }
  }

  async function openReassign(targetReservationId: number): Promise<void> {
    if (reassignTargetId === targetReservationId) {
      // 이미 열린 경우 토글 닫기
      reassignTargetId = null
      return
    }
    reassignTargetId = targetReservationId
    if (availableUnitsFetchedForId === targetReservationId) return  // 이미 로드된 경우 재사용
    availableUnits = []
    availableUnitsError = null
    availableUnitsLoading = true
    availableUnitsFetchedForId = targetReservationId
    try {
      const res = await fetch(`/api/cms/reservations/${targetReservationId}/available-units`)
      const d = await res.json() as { units?: { id: string; product_code: string | null }[]; error?: string }
      if (availableUnitsFetchedForId === targetReservationId) {
        if (!res.ok) {
          availableUnitsError = d.error ?? '가용 재고를 불러오지 못했습니다.'
        } else {
          availableUnits = d.units ?? []
        }
      }
    } catch {
      if (availableUnitsFetchedForId === targetReservationId) {
        availableUnitsError = '네트워크 오류가 발생했습니다.'
      }
    } finally {
      if (availableUnitsFetchedForId === targetReservationId) availableUnitsLoading = false
    }
  }

  async function handleReassign(targetReservationId: number, newUnitId: string): Promise<void> {
    reassigning = true
    try {
      const res = await fetch(`/api/cms/reservations/${targetReservationId}/products`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_unit_id: newUnitId }),
      })
      const d = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !d.success) {
        csToast.error(d.error ?? '상품코드 재배정에 실패했습니다.')
      } else {
        csToast.success('상품코드가 재배정됐습니다.')
        reassignTargetId = null
        availableUnitsFetchedForId = null
        rentalSiblingsFetchedForId = null
        onrefresh()
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      reassigning = false
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    pending: '접수', hold: '신청대기', confirmed: '계약완료',
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

  // 2026-08-31: row.payment_status(Migration 387부터 payment_transactions.status 그대로
  // 노출)를 영문 원문 대신 한글로 표시 — 다른 라벨맵과 동일 원칙.
  const PAYMENT_STATUS_LABELS: Record<string, string> = {
    pending:           '결제 대기',
    done:              '결제완료',
    cancelled:         '환불완료',
    partial_cancelled: '부분환불',
    failed:            '결제실패',
  }

  const TERMINAL = new Set(['completed', 'cancelled', 'damage_claimed'])

  // §9 게이팅 완료 후 승인이력 표시 대상 상태 (rental-lifecycle.md 전체 상태 머신 기준)
  const APPROVAL_HISTORY_STATUSES = new Set([
    'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed',
  ])

  // 승인 이력 3단계 파생값 (Q3 확정 — "전자계약 서명 완료 → 결제 확인 → 승인확정" 고정 순서)
  // 각 단계는 완료 시각이 있을 때만 표시 — 서명/결제 완료 순서와 무관하게 화면 표시 순서는 고정
  let approvalSignedAt   = $derived(row.customer_signed_at ?? row.auto_signed_at ?? null)
  let approvalPaymentAt  = $derived(row.payment_confirmed_at ?? null)
  let approvalConfirmedAt = $derived.by((): string | null => {
    if (!APPROVAL_HISTORY_STATUSES.has(row.status)) return null
    // try_confirm_reservation이 BOTH 서명+결제를 만족했을 때만 실행됨 — 두 값 중 더 늦은 시각
    const candidates = ([approvalSignedAt, approvalPaymentAt] as (string | null)[])
      .filter((v): v is string => v != null)
    // RSV-C-C1: 서명·결제 둘 다 완료(candidates.length === 2)일 때만 승인확정 시각 표시.
    // 하나만 있을 때는 아직 승인 완료 조건 미충족 — null 반환으로 "승인확정" 행 미노출.
    if (candidates.length !== 2) return null
    return [...candidates].sort().at(-1) ?? null
  })
  let hasApprovalHistory = $derived(
    approvalSignedAt !== null || approvalPaymentAt !== null || approvalConfirmedAt !== null,
  )

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

  // 예약 QR — ProductDetailPanel.svelte renderQR/downloadQR과 동일 패턴(qrcode 패키지,
  // 콘텐츠는 예약코드 원문 텍스트 그대로 — products.md §2-4와 동일 철학, 링크 아님)
  let reservationQrCanvasEl = $state<HTMLCanvasElement | null>(null)

  $effect(() => {
    const canvas = reservationQrCanvasEl
    const code = reservationCode()
    if (!canvas || !code) return
    renderReservationQR(canvas, code)
  })

  async function renderReservationQR(canvas: HTMLCanvasElement, payload: string) {
    try {
      const QRCode = (await import('qrcode')).default
      await QRCode.toCanvas(canvas, payload, {
        width: 44,
        margin: 1,
        color: { dark: '#100B32', light: '#FFFFFF' },
      })
    } catch { /* 미설치 시 무시 */ }
  }

  function downloadReservationQR() {
    if (!reservationQrCanvasEl) return
    const code = reservationCode()
    const qrSize = reservationQrCanvasEl.width
    const fontSize = 11
    const padding = 6
    const textH = fontSize + padding * 2
    const out = document.createElement('canvas')
    out.width = qrSize
    out.height = qrSize + textH
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(reservationQrCanvasEl, 0, 0)
    ctx.fillStyle = '#100B32'
    ctx.font = `700 ${fontSize}px "Noto Sans KR", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(code, qrSize / 2, qrSize + textH / 2)
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `qr-${code}.png`
    a.click()
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
        // Stage 4 QA 수정: onrefresh() 없으면 row.tracking_number가 stale해
        // canReassignProductCode(재배정 버튼 노출 게이트)가 저장 직후에도 그대로 true로 남아있음.
        onrefresh()
      }
    } catch {
      trackingError = '저장 중 오류가 발생했습니다.'
    } finally {
      trackingSaving = false
    }
  }

  // ── 두발히어로 배송 자동화 상태 (rental 탭 오픈 시 lazy-fetch) ──────────────────
  // DHERO_STATUS_LABEL은 $lib/utils/dheroLabels에서 import (단일 정의 — MEDIUM-2 수정 2026-08-25)
  // 클라이언트 측 중복 정의(PDF 스펙과 다른 잘못된 매핑값 포함)는 제거됨.

  interface DheroInfo {
    bookId:                  string
    status:                  number
    statusText?:             string | null
    deliveryRiderName?:      string | null
    deliveryRiderMobile?:    string | null
    placePageUrl?:           string | null
    sentBackReason?:         string | null
    lostReason?:             string | null
    delayedDeliveries?:      Array<{ reason: string; delayedDate?: string; [key: string]: unknown }> | null
    pickupScheduledAt?:      string | null
    deliveryCompletedAt?:    string | null
    [key: string]: unknown
  }

  let dheroFetchedForId  = $state<number | null>(null)
  let dheroLoading       = $state(false)
  let isBulkMethod       = $state(false)
  let dheroData          = $state<DheroInfo | null>(null)
  let dheroError         = $state<string | null>(null)
  let dheroBookLoading   = $state(false)  // 배송접수 POST 진행 중
  let dheroBookError     = $state<string | null>(null)
  let dheroCancelLoading = $state(false)
  let dheroCancelError   = $state<string | null>(null)
  let dheroReturnLoading = $state(false)
  let dheroReturnError   = $state<string | null>(null)

  $effect(() => {
    if (activeTab !== 'rental') return
    if (dheroLoading) return
    if (dheroFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    dheroFetchedForId = id
    dheroData         = null
    dheroError        = null
    isBulkMethod      = false
    dheroLoading      = true

    fetch(`/api/cms/reservations/${id}/dhero`)
      .then(r => r.json())
      .then((d: { dhero: DheroInfo | null; is_bulk_delivery?: boolean; dhero_error?: { message: string } }) => {
        if (dheroFetchedForId === id) {
          isBulkMethod  = d.is_bulk_delivery ?? false
          dheroData     = d.dhero ?? null
          dheroError    = d.dhero_error?.message ?? null
          dheroLoading  = false
        }
      })
      .catch(() => {
        if (dheroFetchedForId === id) {
          dheroLoading = false
        }
      })
  })

  async function refreshDheroStatus(): Promise<void> {
    dheroFetchedForId = null  // 재-fetch 강제
    // 다음 $effect 실행을 위해 상태 초기화
    dheroData  = null
    dheroError = null
  }

  async function registerDheroDelivery(): Promise<void> {
    dheroBookLoading = true
    dheroBookError   = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/dhero`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
      })
      const d = await res.json() as { ok?: boolean; bookId?: string; dhero_error?: { message: string }; error?: string }
      if (res.ok && d.ok) {
        csToast.success('두발히어로 배송이 접수되었습니다.')
        dheroFetchedForId = null  // 재-fetch 강제
        onrefresh()
      } else {
        dheroBookError = d.dhero_error?.message ?? d.error ?? '배송접수에 실패했습니다.'
      }
    } catch {
      dheroBookError = '배송접수 중 오류가 발생했습니다.'
    } finally {
      dheroBookLoading = false
    }
  }

  async function cancelDheroDelivery(): Promise<void> {
    if (!confirm('두발히어로 배송을 취소하시겠습니까?')) return
    dheroCancelLoading = true
    dheroCancelError   = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/dhero/cancel`, {
        method: 'PUT',
      })
      const d = await res.json() as { ok?: boolean; dhero_cancel_failed?: boolean; error?: string; dhero_error?: { message: string } }
      if (d.dhero_cancel_failed) {
        dheroCancelError = '두발히어로에서 이미 배차된 건은 취소할 수 없습니다.'
      } else if (!res.ok) {
        dheroCancelError = d.error ?? d.dhero_error?.message ?? '취소에 실패했습니다.'
      } else {
        csToast.success('배송이 취소되었습니다.')
        dheroFetchedForId = null
        onrefresh()
      }
    } catch {
      dheroCancelError = '취소 중 오류가 발생했습니다.'
    } finally {
      dheroCancelLoading = false
    }
  }

  async function registerDheroReturn(): Promise<void> {
    const bookId = row.tracking_number
    if (!bookId) {
      csToast.error('접수된 배송이 없어 반송 등록을 할 수 없습니다.')
      return
    }
    dheroReturnLoading = true
    dheroReturnError   = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/dhero/return`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
      })
      const d = await res.json() as { ok?: boolean; returnBookId?: string; error?: string; dhero_error?: { message: string } }
      if (res.ok && d.ok) {
        csToast.success('반송 등록이 완료되었습니다.')
        dheroFetchedForId = null
        onrefresh()
      } else {
        dheroReturnError = d.error ?? d.dhero_error?.message ?? '반송 등록에 실패했습니다.'
      }
    } catch {
      dheroReturnError = '반송 등록 중 오류가 발생했습니다.'
    } finally {
      dheroReturnLoading = false
    }
  }

  // ── 무인보관함 비밀번호 (lazy-fetch, rental 탭 오픈 시 조회, manager 이상만) ──────────
  let lockerPwFetchedForId = $state<number | null>(null)
  let lockerPassword       = $state('')
  let lockerPwLoading      = $state(false)
  let lockerPwSaving       = $state(false)
  let lockerPwError        = $state<string | null>(null)

  $effect(() => {
    if (activeTab !== 'rental') return
    if (!showLockerPasswordField) return
    if (lockerPwLoading) return
    if (lockerPwFetchedForId === row.reservation_id) return

    const id = row.reservation_id
    lockerPwFetchedForId = id
    lockerPassword       = ''
    lockerPwError        = null
    lockerPwLoading      = true

    fetch(`/api/cms/reservations/${id}/locker-password`)
      .then(r => r.json())
      .then((d: { locker_password: string | null }) => {
        if (lockerPwFetchedForId === id) {
          lockerPassword  = d.locker_password ?? ''
          lockerPwLoading = false
        }
      })
      .catch(() => {
        if (lockerPwFetchedForId === id) {
          lockerPwError   = '비밀번호 정보를 불러오지 못했습니다.'
          lockerPwLoading = false
        }
      })
  })

  async function saveLockerPassword(): Promise<void> {
    lockerPwSaving = true
    lockerPwError  = null
    try {
      const res = await fetch(`/api/cms/reservations/${row.reservation_id}/locker-password`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locker_password: lockerPassword || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        lockerPwError = d.error ?? '저장에 실패했습니다.'
      } else {
        csToast.success('무인보관함 비밀번호가 저장되었습니다.')
      }
    } catch {
      lockerPwError = '저장 중 오류가 발생했습니다.'
    } finally {
      lockerPwSaving = false
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
 <div class="panel-content">
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
    <div class="reservation-qr-wrap reservation-qr-wrap--header">
      <canvas bind:this={reservationQrCanvasEl} width="44" height="44" aria-label="예약 QR 코드"></canvas>
      <button class="qr-dl-btn" onclick={downloadReservationQR} title="QR PNG 다운로드" type="button">↓ QR 저장</button>
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

      <!-- 승인 이력 — §9 게이팅 완료(confirmed 전환) 3단계 타임라인
           (Q3 확정: "전자계약 서명 완료 → 결제 확인 → 승인확정" 고정 순서, 2026-08-31)
           각 단계는 완료 시각이 있을 때만 표시 — service-operations.md §9 -->
      {#if hasApprovalHistory}
        <div class="section-title">승인 이력</div>
        <div class="info-section approval-history-section">
          {#if approvalSignedAt !== null}
            <div class="info-row approval-history-row">
              <span class="info-label approval-step-label">
                <span class="approval-step-dot approval-step-dot--done"></span>
                전자계약 서명 완료
              </span>
              <span class="info-value">{formatDateTime(approvalSignedAt)}</span>
            </div>
          {/if}
          {#if approvalPaymentAt !== null}
            <div class="info-row approval-history-row">
              <span class="info-label approval-step-label">
                <span class="approval-step-dot approval-step-dot--done"></span>
                결제 확인
              </span>
              <span class="info-value">{formatDateTime(approvalPaymentAt)}</span>
            </div>
          {/if}
          {#if approvalConfirmedAt !== null}
            <div class="info-row approval-history-row">
              <span class="info-label approval-step-label">
                <span class="approval-step-dot approval-step-dot--confirmed"></span>
                승인확정
              </span>
              <span class="info-value fw-bold">{formatDateTime(approvalConfirmedAt)}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 상품 정보 -->
      <div class="section-title-row">
        <span class="section-title">상품 정보{#if productInfoItems.length > 1} ({productInfoItems.length}개){/if}</span>
        <div class="section-title-btns">
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
          {#if canEditProducts}
            <button
              type="button"
              class="btn-add-small"
              onclick={openProductFinder}
              disabled={addingProduct}
              aria-label="상품 추가"
            >+ 추가</button>
          {/if}
        </div>
      </div>
      {#each productGroups as group (group.key)}
        <div class="info-section">
          {#if group.representative.imageUrl}
            <div class="info-row">
              <span class="info-label">상품 이미지</span>
              <div class="info-value">
                <img
                  src={group.representative.imageUrl}
                  alt={group.representative.name}
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
              {group.representative.name}
              {#if group.units.length > 1}
                <span class="qty-count-badge">수량 {group.units.length}</span>
              {/if}
              {#if group.representative.parentProductId && modifiedKeys.has(`prod-${group.representative.parentProductId}`)}
                <span class="badge-modified">수정</span>
              {/if}
            </span>
          </div>
          <!-- 상품 코드 — 유닛(=실물 재고) 하나당 한 행. "수량"은 이 행의 개수로 시각적으로
               일치한다(+/- 스텝퍼 대신 행 자체를 추가·삭제하는 방식 — 2026-09-03 UX 재수정). -->
          {#each group.units as unit, i (unit.key)}
            <div class="info-row">
              <span class="info-label">상품 코드{#if group.units.length > 1} #{i + 1}{/if}</span>
              <span class="info-value mono">
                {unit.code ?? '-'}
                {#if unit.isSibling}
                  <span class="sibling-status-badge">{STATUS_LABEL[unit.status ?? ''] ?? unit.status}</span>
                {/if}
              </span>
              {#if canReassignUnit(unit)}
                <button
                  type="button"
                  class="btn-reassign-small"
                  onclick={() => openReassign(unit.reservationId)}
                  aria-label="상품코드 재배정"
                >{reassignTargetId === unit.reservationId ? '닫기' : '재배정'}</button>
              {/if}
              {#if canEditUnit(unit)}
                {@const delKey = `prod-${unit.reservationId}`}
                <button
                  type="button"
                  class="btn-delete-icon"
                  class:btn-delete-icon--pending={deletePendingKeys.has(delKey)}
                  onclick={() => handleDeleteProduct(unit)}
                  disabled={deletingKey === delKey}
                  aria-label="재고 삭제"
                  title={deletePendingKeys.has(delKey) ? '한 번 더 클릭하면 삭제됩니다' : '재고 삭제'}
                >✕</button>
              {/if}
            </div>
            {#if canReassignUnit(unit) && reassignTargetId === unit.reservationId}
              <div class="reassign-row">
                {#if availableUnitsLoading}
                  <span class="reassign-loading">가용 재고 조회 중...</span>
                {:else if availableUnitsError}
                  <span class="reassign-error">{availableUnitsError}</span>
                {:else if availableUnits.length === 0}
                  <span class="reassign-empty">이 날짜에 교체 가능한 재고가 없습니다.</span>
                {:else}
                  <div class="reassign-picker-wrap">
                    <SuggestPicker
                      noFilter={true}
                      options={availableUnits.map(u => ({
                        id: u.id,
                        label: u.product_code ?? '(코드 없음)',
                      }))}
                      onselect={(opt) => {
                        if (opt) handleReassign(unit.reservationId, opt.id)
                      }}
                    >
                      {#snippet field(ctrl)}
                        <input
                          id={ctrl.id}
                          name={ctrl.name}
                          class="reassign-input"
                          placeholder="재고 선택..."
                          value={ctrl.value}
                          oninput={ctrl.oninput}
                          onkeydown={ctrl.onkeydown}
                          onfocus={ctrl.onfocus}
                          onblur={ctrl.onblur}
                          aria-autocomplete={ctrl.ariaAutocomplete}
                          aria-expanded={ctrl.ariaExpanded}
                          aria-controls={ctrl.ariaControls}
                          disabled={reassigning}
                        />
                      {/snippet}
                    </SuggestPicker>
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
          {#if canEditProducts && group.representative.parentProductId}
            <div class="info-row">
              <button
                type="button"
                class="btn-add-unit-small"
                onclick={() => handleGroupQtyIncrease(group.representative)}
                disabled={addingProduct}
              >+ 재고 추가</button>
            </div>
          {/if}
          <div class="info-row">
            <span class="info-label">카테고리</span>
            <span class="info-value">{group.representative.category ?? '-'}</span>
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
      {:else if options.length > 0 || canEditProducts}
        <div class="section-title-row">
          <span class="section-title">옵션상품{#if options.length > 0} ({options.length}개){/if}</span>
          {#if canEditProducts}
            <button
              type="button"
              class="btn-add-small"
              onclick={openOptionFinder}
              disabled={addingOption}
              aria-label="옵션상품 추가"
            >+ 추가</button>
          {/if}
        </div>
        {#if options.length > 0}
          <!-- 옵션상품 카드 — 메인상품 "상품 정보" 카드(그룹당 1장, 상품명/상품코드/수량 행
               구조)와 동일한 레이아웃·수량 UI로 통일(2026-09-03, Stephen 지시). reservation_options
               는 유닛별 실물 재고 행이 아니라 "1행 + qty 정수 필드" 구조라(rental-lifecycle.md
               "옵션상품" — 시리얼 단위 추적 안 함, 의도된 설계) 메인상품처럼 "행 자체를 추가/삭제"
               할 수는 없다 — 대신 수량 행의 "+"는 메인상품과 동일한 .btn-add-unit-small 버튼을
               그대로 재사용(qty+1 PATCH), "-"는 그 행 옆 소형 버튼으로 유지(qty-1 PATCH,
               1 미만 차단). 옵션 자체 삭제(전체 제거)는 상품명 행의 ✕ 아이콘이 담당. -->
          {#each options as opt (opt.id)}
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">옵션명</span>
                <span class="info-value fw-bold">
                  {opt.option_name}
                  {#if modifiedKeys.has(`opt-${opt.id}`)}
                    <span class="badge-modified">수정</span>
                  {/if}
                </span>
                {#if canEditProducts}
                  {@const delKey = `opt-${opt.id}`}
                  <button
                    type="button"
                    class="btn-delete-icon"
                    class:btn-delete-icon--pending={deletePendingKeys.has(delKey)}
                    onclick={() => handleDeleteOption(opt)}
                    disabled={deletingKey === delKey}
                    aria-label="옵션 삭제"
                    title={deletePendingKeys.has(delKey) ? '한 번 더 클릭하면 삭제됩니다' : '옵션 삭제'}
                  >✕</button>
                {/if}
              </div>
              {#if opt.product_code}
                <div class="info-row">
                  <span class="info-label">상품 코드</span>
                  <span class="info-value mono">{opt.product_code}</span>
                </div>
              {/if}
              <div class="info-row">
                <span class="info-label">수량</span>
                <span class="info-value">
                  {#if canEditProducts}
                    <span class="qty-count-badge">수량 {opt.qty}</span>
                    <button
                      type="button"
                      class="opt-qty-minus-small"
                      onclick={() => handleOptionQtyChange(opt.id, opt.qty - 1)}
                      disabled={opt.qty <= 1}
                      aria-label="수량 감소"
                    >−</button>
                  {:else}
                    {opt.qty}개
                  {/if}
                </span>
              </div>
              {#if canEditProducts}
                <div class="info-row">
                  <button
                    type="button"
                    class="btn-add-unit-small"
                    onclick={() => handleOptionQtyChange(opt.id, opt.qty + 1)}
                  >+ 수량 추가</button>
                </div>
              {/if}
            </div>
          {/each}
        {:else}
          <div class="loading-box" style="color: var(--cs-text-mid); font-style: italic;">옵션 없음 — + 추가로 등록하세요</div>
        {/if}
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

      <!-- 무인보관함 비밀번호 — 방문대여(visit)+영업외시간(23:00~08:59) 조합일 때만, manager 이상 전용
           (rental-lifecycle.md·service-operations.md 정책 참고 — 2026-08-20 신설) -->
      {#if showLockerPasswordField}
        <div class="section-title">무인보관함 비밀번호</div>
        {#if lockerPwLoading}
          <div class="loading-box">비밀번호 정보 조회 중...</div>
        {:else}
          <div class="info-section">
            <div class="info-row">
              <span class="info-label">비밀번호</span>
              <input
                class="tracking-input"
                type="text"
                placeholder="무인보관함 비밀번호 입력"
                bind:value={lockerPassword}
              />
            </div>
          </div>
          <div class="tracking-action-row">
            <button
              class="btn-tracking-save"
              onclick={saveLockerPassword}
              disabled={lockerPwSaving}
            >
              {lockerPwSaving ? '저장 중...' : '비밀번호 저장'}
            </button>
            {#if lockerPwError}
              <span class="tracking-error-msg">{lockerPwError}</span>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- 운송장/배송 정보 + 상태 액션 + 알림 발송 — 하나의 그룹으로 묶음 (2026-08-25 Stephen 요청) -->
      <div class="rental-shipping-group">
      <!-- 운송장 정보 / 두발히어로 배송 자동화 — pickup_method is_bulk_delivery 기준 분기 -->
      {#if isBulkMethod}
        <!-- ── 두발히어로 자동화 뷰 ──────────────────────────────────────── -->
        <div class="section-title">두발히어로 배송</div>
        {#if dheroLoading}
          <div class="loading-box">배송 정보 조회 중...</div>
        {:else if row.tracking_number}
          <!-- 배송 접수된 상태: 상태·bookId·라이더·동기화 시각 표시 -->
          <div class="info-section">
            <div class="info-row">
              <span class="info-label">배송상태</span>
              <span class="dhero-status-badge dhero-code-{row.dhero_status_code ?? ''}">
                {row.dhero_status ?? (DHERO_STATUS_LABEL[row.dhero_status_code ?? -1] ?? '접수됨')}
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">접수번호(bookId)</span>
              <span class="info-value mono">{row.tracking_number}</span>
            </div>
            {#if row.dhero_return_book_id}
              <div class="info-row">
                <span class="info-label">반송접수번호</span>
                <span class="info-value mono">{row.dhero_return_book_id}</span>
              </div>
            {/if}
            {#if dheroData?.deliveryRiderName}
              <div class="info-row">
                <span class="info-label">라이더</span>
                <span class="info-value">{dheroData.deliveryRiderName}{dheroData.deliveryRiderMobile ? ` · ${dheroData.deliveryRiderMobile}` : ''}</span>
              </div>
            {/if}
            {#if dheroData?.delayedDeliveries?.length}
              <div class="info-row">
                <span class="info-label">배송 지연</span>
                <span class="info-value">
                  {#each dheroData.delayedDeliveries as d}
                    <span class="dhero-reason-item">{d.reason}{d.delayedDate ? ` (${d.delayedDate})` : ''}</span>
                  {/each}
                </span>
              </div>
            {/if}
            {#if dheroData?.sentBackReason}
              <div class="info-row">
                <span class="info-label">반송 사유</span>
                <span class="info-value dhero-reason-text">{dheroData.sentBackReason}</span>
              </div>
            {/if}
            {#if dheroData?.lostReason}
              <div class="info-row">
                <span class="info-label">분실 사유</span>
                <span class="info-value dhero-reason-text">{dheroData.lostReason}</span>
              </div>
            {/if}
            {#if row.dhero_synced_at}
              <div class="info-row">
                <span class="info-label">마지막 동기화</span>
                <span class="info-value dhero-sync-time">{new Date(row.dhero_synced_at).toLocaleString('ko-KR')}</span>
              </div>
            {/if}
          </div>
          {#if dheroError}
            <div class="tracking-error-msg">상태 조회 실패: {dheroError}</div>
          {/if}
          <div class="tracking-action-row dhero-action-row">
            <button
              class="btn-dhero-refresh"
              onclick={refreshDheroStatus}
              disabled={dheroLoading}
            >
              상태 새로고침
            </button>
            {#if !row.dhero_return_book_id}
              <button
                class="btn-dhero-return"
                onclick={registerDheroReturn}
                disabled={dheroReturnLoading}
              >
                {dheroReturnLoading ? '처리 중...' : '반송 등록'}
              </button>
            {/if}
            <button
              class="btn-dhero-cancel"
              onclick={cancelDheroDelivery}
              disabled={dheroCancelLoading}
            >
              {dheroCancelLoading ? '처리 중...' : '배송 취소'}
            </button>
          </div>
          {#if dheroCancelError}
            <div class="tracking-error-msg">{dheroCancelError}</div>
          {/if}
          {#if dheroReturnError}
            <div class="tracking-error-msg">{dheroReturnError}</div>
          {/if}
        {:else}
          <!-- 배송 미접수: 배송접수 버튼 -->
          <div class="info-section">
            <p class="dhero-pending-note">두발히어로 배송이 아직 접수되지 않았습니다.</p>
          </div>
          {#if dheroBookError}
            <div class="tracking-error-msg">{dheroBookError}</div>
          {/if}
          <div class="tracking-action-row">
            <button
              class="btn-dhero-book"
              onclick={registerDheroDelivery}
              disabled={dheroBookLoading}
            >
              {dheroBookLoading ? '접수 중...' : '두발히어로 배송접수'}
            </button>
          </div>
        {/if}
      {:else}
        <!-- ── 일반 수동 운송장 입력 뷰 (quick/epost/locker/visit 등) ────── -->
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
                if (result.type === 'success') { csToast.success('예약이 승인되었습니다.'); onstatuschange?.(); onrefresh() }
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
                if (result.type === 'success') { csToast.success('예약이 거부되었습니다.'); onstatuschange?.(); onrefresh() }
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
                if (result.type === 'success') {
                  csToast.success('예약이 취소되었습니다.')
                  // MEDIUM-1 수정 (2026-08-25): dhero_cancel_failed 플래그 읽어 경고 노출
                  // 수동 "배송 취소" 버튼(cancelDheroDelivery)과 동일 문구 사용
                  if ((result.data as Record<string, unknown> | undefined)?.dhero_cancel_failed) {
                    csToast.warning('배송사 측 취소에 실패했습니다. 실물 배송을 별도로 확인하세요.')
                  }
                  onstatuschange?.()
                  onrefresh()
                } else {
                  csToast.error('처리 중 오류가 발생했습니다.')
                }
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
      </div>
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
          <span class="info-value">{row.payment_status ? (PAYMENT_STATUS_LABELS[row.payment_status] ?? row.payment_status) : '-'}</span>
        </div>
      </div>

      {#if modifiedKeys.size > 0}
        <!-- Stage 4: 상품구성 편집 후 금액 정합은 이번 스코프 밖(플랜 "Out of Scope") —
             표시 금액이 실제 변경된 구성을 반영하지 않을 수 있음을 관리자에게 안내만 함 -->
        <div class="amount-sync-notice">
          상품 구성이 변경됐습니다. 위 금액은 변경 전 기준일 수 있으니 별도로 확인해주세요.
        </div>
      {/if}

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

      <!-- RSV-B-C1: 환불실패 배지 — Toss 취소는 완료됐으나 DB 반영 실패 시 표시 -->
      {#if paymentDetail?.refund_failed_at}
        <div class="refund-failed-banner" role="alert">
          <span class="refund-failed-badge">⚠ 환불실패</span>
          <span class="refund-failed-desc">
            Toss 결제취소는 완료됐으나 DB 반영에 실패했습니다.
            Toss 콘솔에서 직접 확인 후 수동 처리가 필요합니다.
            {#if paymentDetail.refund_failure_reason}
              <br /><span class="refund-failed-reason">사유: {paymentDetail.refund_failure_reason}</span>
            {/if}
          </span>
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
        {#if canManagePaymentAndLocker && paymentDetail?.status === 'done' && row.status !== 'cancelled'}
          <!-- manager 이상 + payment done + 예약 미취소 상태에서만 활성 환불 버튼 -->
          <button
            class="btn-action btn-action--danger"
            disabled={isRefunding}
            onclick={handleRefund}
          >
            {isRefunding ? '환불 처리 중...' : '환불 처리'}
          </button>
          {#if refundError}
            <p class="refund-error" role="alert">{refundError}</p>
          {/if}
        {:else if paymentDetail?.status === 'cancelled' || row.status === 'cancelled'}
          <button class="btn-action" disabled title="이미 취소된 예약입니다">환불 처리 (취소됨)</button>
        {:else if !canManagePaymentAndLocker && paymentDetail?.status === 'done'}
          <button class="btn-action" disabled title="매니저 이상 권한이 필요합니다">환불 처리</button>
        {:else}
          <button class="btn-action" disabled title="결제 정보 없음">환불 처리</button>
        {/if}
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
        reservationStatus={row.status}
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
</div>

{#if enableQrVerify}
  <QrScannerOverlay
    bind:open={qrOverlayOpen}
    onDetected={handleProductQrDetected}
    onClose={() => (qrOverlayOpen = false)}
  />
{/if}

<!-- Stage 4: 상품 검색 및 선택 모달 — transform 조상 서브트리 밖에 독립 렌더링
     (ui-mobile.md "CSS transform + position:fixed 충돌" 원칙 준수) -->
<ReservationProductFinderModal
  open={showFinderModal}
  onclose={() => (showFinderModal = false)}
  onselect={handleFinderSelect}
  baseProductId={finderModalPurpose === 'option' ? row.product_id : null}
/>

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

  /* 헤더·탭·본문 3영역을 하나로 묶는 래퍼 — .panel의 flex column 흐름을 그대로 이어받아
     기존 레이아웃(헤더·탭 고정 높이, 본문만 스크롤)과 시각적으로 동일하게 동작 */
  .panel-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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

  .section-title-btns {
    display: flex;
    align-items: center;
    gap: 6px;
  }

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

  /* Stage 4: 상품 편집 UI */
  .btn-add-small {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border: 1.5px solid var(--cs-purple);
    border-radius: var(--radius-xl);
    background: transparent;
    color: var(--cs-purple);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .btn-add-small:hover:not(:disabled) {
    background: var(--cs-purple);
    color: #fff;
  }
  .btn-add-small:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-delete-icon {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .btn-delete-icon:hover:not(:disabled) {
    background: rgba(207,0,0,0.12);
    color: var(--cs-error);
  }
  .btn-delete-icon--pending {
    background: var(--cs-error);
    color: #fff;
  }
  .btn-delete-icon--pending:hover:not(:disabled) {
    background: #a80000;
    color: #fff;
  }
  .btn-delete-icon:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-reassign-small {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border: 1px solid var(--cs-text-mid);
    border-radius: var(--radius-xl);
    background: transparent;
    color: var(--cs-text-mid);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-reassign-small:hover {
    border-color: var(--cs-purple);
    color: var(--cs-purple);
  }

  .reassign-row {
    padding: 6px 14px 10px;
  }
  .reassign-picker-wrap {
    width: 100%;
  }
  .reassign-input {
    width: 100%;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    outline: none;
  }
  .reassign-input:focus {
    border-color: var(--cs-purple);
  }
  .reassign-loading,
  .reassign-error,
  .reassign-empty {
    font-size: 12px;
    color: var(--cs-text-mid);
    font-style: italic;
  }
  .reassign-error { color: var(--cs-error); }

  /* 옵션상품 수량 "-" — 메인상품 카드와 톤 통일(.qty-count-badge 옆 소형 원형 버튼) */
  .opt-qty-minus-small {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--cs-lilac);
    border-radius: 50%;
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.12s;
    vertical-align: middle;
    margin-left: 6px;
  }
  .opt-qty-minus-small:hover:not(:disabled) {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: #fff;
  }
  .opt-qty-minus-small:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Stage 4 UX 재수정(2026-09-03): 그룹당 카드 1장 + 상품코드 행 반복 방식으로 전환하며
     +/- 스텝퍼(.prod-qty-*)는 제거 — "수량"은 이제 상품코드 행 개수 자체로 표현되고, 증가는
     아래 .btn-add-unit-small, 감소는 각 상품코드 행의 .btn-delete-icon이 담당한다. */
  .qty-count-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: var(--radius-full, 99px);
    background: var(--cs-lilac);
    color: var(--cs-purple);
    font-size: 11px;
    font-weight: 700;
    vertical-align: middle;
  }

  .btn-add-unit-small {
    height: 28px;
    padding: 0 12px;
    border: 1.5px dashed var(--cs-purple);
    border-radius: var(--cms-radius-sm);
    background: transparent;
    color: var(--cs-purple);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .btn-add-unit-small:hover:not(:disabled) {
    background: var(--cs-purple);
    color: #fff;
  }
  .btn-add-unit-small:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Stage 4: 결제정보 탭 — 상품구성 변경 후 금액 별도확인 안내(cs-warning 톤) */
  .amount-sync-notice {
    margin: 4px 0 12px;
    padding: 8px 12px;
    border-radius: var(--cms-radius-sm);
    background: rgba(245, 158, 11, 0.12);
    color: var(--cs-warning);
    font: var(--text-pc-script-12);
    font-weight: 600;
  }

  /* Stage 4: 클라이언트 세션 한정 "수정" 배지 — cs-info(정보 파랑) 톤, cms-uiux.md §7-6 배지 계열 */
  .badge-modified {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: var(--radius-full, 99px);
    background: rgba(14, 165, 233, 0.12);
    color: var(--cs-info);
    font-size: 11px;
    font-weight: 700;
    vertical-align: middle;
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

  /* 예약 QR 코드(2026-08-26, ProductDetailPanel .qr-wrap/.qr-dl-btn 패턴 재사용) — 패널
     헤더로 이동 배치 + 원래 88px 대비 50% 축소(44px) */
  .reservation-qr-wrap {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .reservation-qr-wrap canvas { display: block; border-radius: var(--cms-radius-sm); border: 1px solid var(--cs-surface-gray); }
  .reservation-qr-wrap .qr-dl-btn {
    background: transparent; border: none;
    color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); min-height: 24px;
    transition: color 0.12s, background 0.12s;
  }
  .reservation-qr-wrap .qr-dl-btn:hover { background: var(--cs-lilac); color: var(--cs-purple); }
  .reservation-qr-wrap--header { margin-left: auto; margin-right: 12px; }

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

  /* 승인 이력 섹션 (Stage 2, Q3 확정, 2026-08-31) */
  .approval-step-label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .approval-step-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .approval-step-dot--done      { background: var(--cs-purple); }
  .approval-step-dot--confirmed { background: var(--cs-orange, #FF4500); }
  .amount-discount { color: var(--cs-error, #ef4444); }
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
  .btn-action--danger             { background: var(--cs-error); }
  .btn-action--danger:hover       { background: var(--cs-red-badge); }
  .btn-action--danger:disabled    { background: var(--cs-disabled-button); cursor: not-allowed; }
  .refund-error { font-size: 12px; color: var(--cs-error); margin: 6px 0 0; }
  /* RSV-B-C1 환불실패 배지 */
  .refund-failed-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: #fff5f5;
    border: 1.5px solid var(--cs-error, #e53e3e);
    border-radius: var(--cms-radius-sm, 8px);
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .refund-failed-badge {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-error, #e53e3e);
    background: #ffe0e0;
    border-radius: 4px;
    padding: 2px 6px;
  }
  .refund-failed-desc {
    font-size: 12px;
    color: var(--cs-text, #100B32);
    line-height: 1.5;
  }
  .refund-failed-reason {
    color: var(--cs-text-mid, #666);
    font-size: 11px;
  }

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

  /* ── 두발히어로 배송 자동화 UI ──────────────────────────────────────────────── */
  .dhero-status-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: var(--radius-full, 99px);
    font: var(--text-pc-script-12);
    font-weight: 700;
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    border: 1px solid var(--cs-lilac);
  }
  /* 배송완료(5) 강조 */
  .dhero-status-badge.dhero-code-5 { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
  /* 반송/분실/취소(6~9) 경고 */
  .dhero-status-badge.dhero-code-6,
  .dhero-status-badge.dhero-code-7,
  .dhero-status-badge.dhero-code-8,
  .dhero-status-badge.dhero-code-9  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  /* 배송중(3,4) 활성 */
  .dhero-status-badge.dhero-code-3,
  .dhero-status-badge.dhero-code-4  { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .dhero-sync-time {
    font-size: 11px;
    color: var(--cs-text-mid);
  }
  .dhero-reason-item {
    display: block;
    font-size: 12px;
    color: var(--cs-text-mid);
    line-height: 1.5;
  }
  .dhero-reason-text {
    font-size: 12px;
    color: var(--cs-text-mid);
  }
  .dhero-action-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .dhero-pending-note {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    margin: 0;
  }
  .btn-dhero-refresh,
  .btn-dhero-book,
  .btn-dhero-cancel,
  .btn-dhero-return {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 14px;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
    border: 1px solid;
  }
  .btn-dhero-book {
    background: var(--cs-purple);
    color: #fff;
    border-color: var(--cs-purple);
  }
  .btn-dhero-book:hover    { opacity: 0.85; }
  .btn-dhero-book:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-dhero-refresh {
    background: var(--cs-surface-gray);
    color: var(--cs-purple);
    border-color: var(--cs-purple);
  }
  .btn-dhero-refresh:hover    { background: rgba(59,47,138,0.08); }
  .btn-dhero-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-dhero-return {
    background: var(--cs-surface-gray);
    color: var(--cs-text);
    border-color: var(--cs-lilac);
  }
  .btn-dhero-return:hover    { background: rgba(0,0,0,0.04); }
  .btn-dhero-return:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-dhero-cancel {
    background: var(--cs-surface-gray);
    color: var(--cs-error, #ef4444);
    border-color: var(--cs-error, #ef4444);
  }
  .btn-dhero-cancel:hover    { background: rgba(239,68,68,0.06); }
  .btn-dhero-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
  .mono { font-family: 'Courier New', monospace; font-size: 12px; letter-spacing: 0.02em; }

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
