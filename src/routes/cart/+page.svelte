<script lang="ts">
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { slide, fly } from 'svelte/transition';
  import type { PageData } from './$types';
  import SubGnb from '$lib/components/common/SubGnb.svelte';
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte';
  import { supabase } from '$lib/services/supabase';
  import { csToast } from '$lib/utils/toast';

  function readInputValue(event: { currentTarget: { value: string } }): string {
    return event.currentTarget.value;
  }

  interface Props { data: PageData }
  let { data }: Props = $props();

  // ── Types
  // 5탭 배송 방식 (PRD.1.2.2 Zone2 기준) — ShipmentMethodEnum 정합
  type DeliveryMethod = 'crazydelivery' | 'quick' | 'locker' | 'visit' | 'epost';
  // 대여 기간 유형 (price_rules.duration_type 정합)
  type DurationType = '12h' | '24h' | '1day' | 'purchase';
  // 상품 상세에서 저장된 실제 선택값 (서버 cartLineItems에서 넘어오는 시드값)
  type CartLineItemSeed = { pickupMethod: string | null; returnMethod: string | null; pickupTime: string | null; returnTime: string | null; durationType: string | null };

  interface CardOptions {
    rentalMethod: DeliveryMethod;
    returnMethod: DeliveryMethod;
    copyToReturn: boolean;
    couponWelcome: boolean;
    couponMembership: boolean;
  }

  // 단일 오픈(상호배타) 아코디언 키 — 일괄설정 패널 공용
  type AccKey = 'rental' | 'return_'

  interface FormState {
    name: string;
    email: string;
    phone: string;
    authCode: string;
    addr: string;
    addrDetail: string;
    notes: string;
    memberCheck: boolean;
    memberCheck2: boolean;
  }

  function defaultOptions(): CardOptions {
    return {
      rentalMethod: 'crazydelivery', returnMethod: 'crazydelivery',
      copyToReturn: false, couponWelcome: false, couponMembership: false
    };
  }

  // 상품 상세에서 저장된 값 → 체크아웃 표시값 매핑 (알 수 없는 method_key는 기존 기본값으로 폴백)
  const KNOWN_DELIVERY_METHODS: DeliveryMethod[] = ['crazydelivery', 'quick', 'locker', 'visit', 'epost'];
  function toDeliveryMethod(v: string | null, fallback: DeliveryMethod): DeliveryMethod {
    return v && (KNOWN_DELIVERY_METHODS as string[]).includes(v) ? (v as DeliveryMethod) : fallback;
  }
  function toDurationType(v: string | null): DurationType {
    return v === '12h' ? '12h' : '24h';
  }

  function defaultForm(): FormState {
    return { name: '', email: '', phone: '', authCode: '', addr: '', addrDetail: '', notes: '', memberCheck: false, memberCheck2: false };
  }

  // ── 카트 라인아이템 UI 상태 (무제한 — 카드1/카드2 고정 구조 폐기 2026-07-27)
  interface CartItemUiState {
    id: string;   // reservationId (rental_reservations.id)
    checked: boolean;
    deleted: boolean;
    qty: number;
    durType: DurationType;
    opts: CardOptions;
    rentalForm: FormState;
    returnForm: FormState;
    rentalDate: string;
    rentalTime: string;
    returnDate: string;
    returnTime: string;
  }

  function newItemState(id: string, rentalDate: string, returnDate: string, seed?: CartLineItemSeed): CartItemUiState {
    const defaults = defaultOptions();
    return {
      id, checked: true, deleted: false, qty: 1,
      durType: toDurationType(seed?.durationType ?? null),
      opts: {
        ...defaults,
        rentalMethod: toDeliveryMethod(seed?.pickupMethod ?? null, defaults.rentalMethod),
        returnMethod: toDeliveryMethod(seed?.returnMethod ?? null, defaults.returnMethod),
      },
      rentalForm: defaultForm(),
      returnForm: defaultForm(),
      rentalDate, rentalTime: seed?.pickupTime ?? '',
      returnDate, returnTime: seed?.returnTime ?? '',
    };
  }

  let itemsState = $state<CartItemUiState[]>([]);

  function updateItem(id: string, patch: Partial<CartItemUiState>) {
    itemsState = itemsState.map(it => it.id === id ? { ...it, ...patch } : it);
  }

  // 카트에서 상품 삭제 — 서버에 취소(cancelled) 반영 후 재로드
  async function removeItem(item: CartItemUiState) {
    updateItem(item.id, { deleted: true })
    try {
      const res = await fetch('/api/checkout/remove-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: item.id }),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) {
        updateItem(item.id, { deleted: false })
        csToast.error('삭제 처리 중 오류가 발생했습니다.')
        return
      }
      await invalidateAll()
    } catch {
      updateItem(item.id, { deleted: false })
      csToast.error('네트워크 오류가 발생했습니다.')
    }
  }

  // ── 통합 대여예약옵션 상태 (통합 단일 정책 — 2026-08-05)
  let bulkOpen    = $state(false)
  let bulkDate    = $state('')
  let bulkTime    = $state('')
  // 대여방법/반납방법 아코디언 — RentalForm 재사용
  // 단일 오픈(상호배타)
  let bulkOpenAcc     = $state<AccKey>('rental')
  let bulkOpts        = $state<CardOptions>(defaultOptions())
  let bulkRentalForm  = $state<FormState>(defaultForm())
  let bulkReturnForm  = $state<FormState>(defaultForm())

  // 패널을 열 때 첫 번째(가장 위) 상품 카드의 현재 대여/반납 방식으로 시딩 — 항상 기본값
  // (크레이지배송)으로 빈 상태로 열리던 문제 수정. 이 대입 자체는 다른 카드에 되쓰지 않음
  // (실 반영은 아래 applyBulkToItems() 호출부에서만 발생 — 시딩과 반영을 분리)
  // ⚠️ hasSeededBulk는 일반 변수(비-$state)로 유지할 것 — 이 이펙트는 itemsState를 읽으므로
  // itemsState가 바뀔 때마다(=사용자가 통합설정을 편집해 applyBulkToItems()가 실행될 때마다)
  // 다시 실행된다. 가드 없이 매번 bulkOpts를 재대입하면 사용자가 값을 바꾸는 순간 바로 그
  // 변경으로 인한 itemsState 갱신이 이 이펙트를 재실행시켜 방금 입력한 값을 계속 덮어써서
  // "수정이 안 되는" 것처럼 보이는 버그가 생김 — "itemsState 최초 1회만" 시딩되게 가드
  let hasSeededBulk = false
  $effect(() => {
    if (hasSeededBulk) return
    const first = itemsState.find(it => !it.deleted)
    if (!first) return
    hasSeededBulk = true
    bulkOpts = { ...bulkOpts, rentalMethod: first.opts.rentalMethod, returnMethod: first.opts.returnMethod }
  })

  // ── Order Total
  let otSelectedCouponIds = $state(new Set<string>())
  let otPointsUsed = $state(0)

  // ── Calendar & Time
  let openCalId = $state<string | null>(null);
  let openTimeId = $state<string | null>(null);

  function openCal(id: string, _currentDate: string) {
    openCalId = openCalId === id ? null : id;
    openTimeId = null;
  }

  function openTime(id: string) {
    openTimeId = openTimeId === id ? null : id;
    openCalId = null;
  }

  function fmtTime(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
  }

  // ── 통합설정용 핸들러 (bulkOpts/bulkRentalForm/bulkReturnForm 대상 — 개별 아이템 편집 UI는
  // 통합 단일 정책 전환(2026-08-05)으로 제거되어 item 단위 핸들러는 더 이상 필요 없음)
  // 2026-07-28: 버튼("전체 적용") 클릭 없이 입력 즉시 전체 상품 카드에 반영 — 각 핸들러 끝에
  // applyBulkToItems() 호출
  function bulkHandleMethod(v: DeliveryMethod) {
    bulkOpts = { ...bulkOpts, rentalMethod: v, ...(bulkOpts.copyToReturn ? { returnMethod: v } : {}) }
    applyBulkToItems()
  }
  function bulkHandleReturnMethod(v: DeliveryMethod) {
    bulkOpts = { ...bulkOpts, returnMethod: v }
    applyBulkToItems()
  }
  function bulkHandleRentalForm(f: FormState) {
    bulkRentalForm = f
    if (bulkOpts.copyToReturn) bulkReturnForm = { ...f }
    applyBulkToItems()
  }
  function bulkHandleReturnForm(f: FormState) {
    bulkReturnForm = f
    applyBulkToItems()
  }
  function bulkHandleCopy(v: boolean) {
    if (v) {
      bulkOpts = { ...bulkOpts, copyToReturn: true, returnMethod: bulkOpts.rentalMethod }
      bulkReturnForm = { ...bulkRentalForm }
    } else {
      bulkOpts = { ...bulkOpts, copyToReturn: false }
    }
    applyBulkToItems()
  }
  function bulkHandleDate(d: string) {
    bulkDate = d
    applyBulkToItems()
  }
  function bulkHandleTime(t: string) {
    bulkTime = t
    applyBulkToItems()
  }

  // 통합 입력값이 비어있으면(사용자가 손대지 않은 필드) 기존 개별 값 유지 — 덮어써서 날리지 않도록 방어
  function mergeFormForBulk(bulkForm: FormState, itemForm: FormState): FormState {
    return {
      name: bulkForm.name || itemForm.name,
      email: bulkForm.email || itemForm.email,
      phone: bulkForm.phone || itemForm.phone,
      authCode: bulkForm.authCode || itemForm.authCode,
      addr: bulkForm.addr || itemForm.addr,
      addrDetail: bulkForm.addrDetail || itemForm.addrDetail,
      notes: bulkForm.notes || itemForm.notes,
      memberCheck: bulkForm.memberCheck || itemForm.memberCheck,
      memberCheck2: bulkForm.memberCheck2 || itemForm.memberCheck2,
    }
  }

  // 통합설정 필드 변경 즉시(버튼 없이) 전체 상품 카드에 반영 — 카드별 기존 설정값은 무시되고
  // bulkOpts/bulkDate/bulkTime/bulkRentalForm/bulkReturnForm 값으로 전부 덮어씀
  function applyBulkToItems() {
    itemsState = itemsState.map(it => ({
      ...it,
      rentalDate: bulkDate || it.rentalDate,
      returnDate: bulkDate || it.returnDate,
      rentalTime: bulkTime || it.rentalTime,
      returnTime: bulkTime || it.returnTime,
      opts: { ...it.opts, rentalMethod: bulkOpts.rentalMethod, returnMethod: bulkOpts.returnMethod },
      rentalForm: mergeFormForBulk(bulkRentalForm, it.rentalForm),
      returnForm: mergeFormForBulk(bulkReturnForm, it.returnForm),
    }))
    // sync_cart_dates() RPC — TASK-D 연동 시 호출 예정
  }

  function displayDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}.${m}.${d}`;
  }

  // ── Guest OTP (비로그인 인증)
  let guestOtpSent     = $state(false)
  let guestOtpVerified = $state(false)

  async function requestGuestOtp(email: string) {
    if (!email) { csToast.error('이메일을 먼저 입력해 주세요.'); return }
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (!error) {
      guestOtpSent = true
      csToast.success('인증 이메일을 발송했습니다. 메일함을 확인해 주세요.')
    } else {
      csToast.error('인증 이메일 발송에 실패했습니다.')
    }
  }

  async function verifyGuestOtp(email: string, code: string, form: FormState) {
    if (!code) { csToast.error('인증번호를 입력해 주세요.'); return }
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) { csToast.error('인증번호가 올바르지 않습니다.'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // @ts-expect-error — sync_checkout_to_profile은 database.ts 미등록 RPC
      await supabase.rpc('sync_checkout_to_profile', {
        p_user_id: user.id,
        p_name:    form.name  || null,
        p_phone:   form.phone || null,
        p_address: form.addr  ? `${form.addr} ${form.addrDetail}`.trim() : null,
      })
      guestOtpVerified = true
      csToast.success('인증이 완료되었습니다!')
    }
  }

  // ── 서버 데이터 추출 (PageData는 +page.ts 기준이므로 server 필드는 캐스트 필요)
  // datesSet 등 canProceed 조건이 라인아이템 목록을 참조하므로 Footer 섹션보다 앞에 선언
  type ProductRow = { id: string; name: string; category: string; brand: string | null; slug: string; image_urls: string[]; is_active: boolean }
  type UserCouponExt = { id: string; coupon_id: string; coupons: { id: string; code: string; discount_type: string; discount_value: number; description: string | null; valid_until: string } | null }
  type PriceRuleExt = { price12h: number | null; price24h: number | null; deposit: number | null }
  type CartLineItemOption = { optionProductId: string | null; name: string; qty: number; unitPrice: number; imageUrl: string | null }
  type CartLineItem = { reservationId: string; productId: string | null; product: ProductRow | null; price12h: number | null; price24h: number | null; deposit: number | null; startDate: string; endDate: string; pickupMethod: string | null; returnMethod: string | null; pickupTime: string | null; returnTime: string | null; durationType: string | null; options: CartLineItemOption[]; status: string }
  type ServerExt = { calcTotal: number; calcDiscount: number; calcFinal: number; depositTotal: number; membershipGrade: string | null; userPoints: number; userCoupons: UserCouponExt[]; cartLineItems: CartLineItem[]; productPriceRules: Record<string, PriceRuleExt>; hasUserAddress: boolean }
  const sd = $derived(data as unknown as ServerExt)

  // 카트 라인아이템 — 항상 실 DB 기준 (게스트도 예약 시 익명 로그인으로 실 세션을 가지므로
  // 별도 데모/미리보기 데이터가 필요 없음 — 2026-07-27 fixture 폴백 설계 제거)
  const effectiveLineItems = $derived<CartLineItem[]>((sd as { cartLineItems?: CartLineItem[] }).cartLineItems ?? [])
  const sdPriceRules = $derived<Record<string, PriceRuleExt>>((sd as { productPriceRules?: Record<string, PriceRuleExt> }).productPriceRules ?? {})

  // effectiveLineItems ↔ itemsState 동기화 — 기존 로컬 UI 상태(아코디언 열림 등)는 보존
  $effect(() => {
    const lines = effectiveLineItems
    const prev = untrack(() => itemsState)
    itemsState = lines.map(line => prev.find(it => it.id === line.reservationId) ?? newItemState(line.reservationId, line.startDate ?? '', line.endDate ?? '', {
      pickupMethod: line.pickupMethod, returnMethod: line.returnMethod,
      pickupTime: line.pickupTime, returnTime: line.returnTime,
      durationType: line.durationType,
    }))
  })

  // ── Footer + canProceed 5조건 가드
  let agreed = $state(false);
  let isConfirming = $state(false);
  let footerVisible = $state(false);
  let footerSentinel = $state<HTMLDivElement | null>(null);

  // 조건 1: 결제 확정 대상(체크 해제·삭제되지 않은 상품)이 1개 이상
  const hasItems = $derived(itemsState.some(it => !it.deleted && it.checked))

  // 조건 2: 결제 확정 대상 상품의 날짜(수령일·반납일) 입력됨 (체크 해제한 상품은 제외)
  const datesSet = $derived(
    itemsState.every(it => it.deleted || !it.checked || (it.rentalDate !== '' && it.returnDate !== ''))
  )

  // 조건 3: 배송 마감 미초과 (TASK-D: check_delivery_deadline() 연동 후 대체)
  const deadlineOk = $derived(true)

  // 조건 4: 신원 확인 완료 — 로그인 세션 또는 게스트 OTP 인증
  // data.userId는 +page.server.ts 반환값 (PageData 병합 — dev server 기동 시 $types 자동 재생성)
  const identityOk = $derived(
    guestOtpVerified ||
    (data.userId != null)
  )

  // 조건 5: 약관 동의
  // canProceed: 5가지 조건 모두 충족
  const canProceed = $derived(hasItems && datesSet && deadlineOk && identityOk && agreed)

  // 완료 버튼 문구 — 회원/비회원(익명 게스트) 구분
  const confirmLabel = $derived((data.isGuest as boolean | undefined) ? '비회원 예약신청완료' : '예약신청완료')

  // 페이지 최하단(결제 영역) 근접 시에만 CTA 푸터 노출 — 절대 위치 기반(IntersectionObserver)이라
  // 스크롤 방향 델타 비교 방식과 달리 관성·러버밴드 반동에 의한 반복 토글(떨림)이 구조적으로 발생하지 않음
  $effect(() => {
    const sentinel = footerSentinel
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => { footerVisible = entry.isIntersecting },
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  })

  // ── Helpers
  const DUR_LABELS: Record<DurationType, string> = {
    '12h': '12H', '24h': '24H', '1day': '1일', 'purchase': '구매',
  }
  const DUR_TYPES: DurationType[] = ['12h', '24h', '1day', 'purchase']

  // 기간 유형별 단가 반환 (카드 표시용 — 실제 합계는 calculate_cart_total RPC 기준)
  function cardRate(daily: number, half: number, dur: DurationType): number {
    if (dur === '12h') return half
    if (dur === 'purchase') return daily * 8  // 임시값 — 구매(판매) 요금정책 연동 예정
    return daily  // '24h' | '1day'
  }

  // CMS 대여관리(/cms/set/rental)에서 설정한 실제 이름을 우선 사용 — 아래 맵은 CMS 데이터가
  // 아직 로드되지 않았거나 해당 method_key가 CMS 목록에 없을 때만 쓰는 최후 폴백
  const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
    crazydelivery: '크레이지배송', quick: '퀵서비스',
    locker:        '무인보관함',   visit: '직접방문', epost: '택배',
  };
  function methodLabel(m: DeliveryMethod): string {
    const cmsOpt = sdDeliveryOpts.find(o => o.method_key === m)
    return cmsOpt?.name ?? DELIVERY_LABELS[m] ?? m;
  }

  // 단가: 실제 요금정책(price_rules) 기준 (없으면 기본 단가 폴백)
  function itemRate24h(line: CartLineItem | undefined): number {
    if (!line) return 150000
    return sdPriceRules[line.productId ?? '']?.price24h ?? line.price24h ?? 150000
  }
  function itemRate12h(line: CartLineItem | undefined, rate24: number): number {
    if (!line) return Math.round(rate24 * 0.6)
    return sdPriceRules[line.productId ?? '']?.price12h ?? line.price12h ?? Math.round(rate24 * 0.6)
  }
  function itemCardRate(line: CartLineItem | undefined, durType: DurationType): number {
    const r24 = itemRate24h(line)
    const r12 = itemRate12h(line, r24)
    return cardRate(r24, r12, durType)
  }
  function itemDeposit(line: CartLineItem | undefined): number {
    if (!line) return 0
    return sdPriceRules[line.productId ?? '']?.deposit ?? line.deposit ?? 0
  }
  // 옵션상품 금액 합계 (unit_price × qty) — 상품상세에서 선택한 옵션이 체크아웃 합계에도 반영되도록
  function itemOptionsAmount(line: CartLineItem | undefined): number {
    if (!line) return 0
    return line.options.reduce((s, o) => s + o.unitPrice * o.qty, 0)
  }

  // ── 등급별 할인율
  const GRADE_RATE: Record<string, number> = { NONE: 0, EASY: 0, POP: 10, CRAZY: 20 }

  const otGrade = $derived<string>(sd.membershipGrade ?? 'NONE')
  const otDiscountRate = $derived(GRADE_RATE[otGrade] ?? 0)

  // 대여료 소계 — 체크된(선택된) 상품만 합산 (체크 해제 시 약정요금에서 제외)
  // 옵션상품 금액(itemOptionsAmount)도 기본 대여료와 동일하게 qty 배수 적용해 합산
  const otSubtotal = $derived(
    itemsState.reduce((sum, it, i) => {
      if (it.deleted || !it.checked) return sum
      const line = effectiveLineItems[i]
      return sum + (itemCardRate(line, it.durType) + itemOptionsAmount(line)) * Math.max(it.qty, 1)
    }, 0)
  )

  // 멤버십 할인 — 등급 할인율을 체크된 소계에 적용
  const otMembershipDiscount = $derived(Math.round(otSubtotal * otDiscountRate / 100))

  // 배송비: DB rental_method_options.fee_amount 우선, 없으면 하드코딩 폴백
  // @ts-expect-error — deliveryOptions: +page.server.ts 제공
  const sdDeliveryOpts = $derived((data.deliveryOptions as Array<{ method_key: string; name: string; fee_amount: number; is_free_for_top_grade: boolean }> | undefined) ?? [])
  function deliveryFee(method: DeliveryMethod, grade: string): number {
    if (sdDeliveryOpts.length) {
      const opt = sdDeliveryOpts.find(o => o.method_key === method)
      if (opt) return (opt.is_free_for_top_grade && grade === 'CRAZY') ? 0 : opt.fee_amount
    }
    return method === 'crazydelivery' && grade !== 'CRAZY' ? 3500 : 0
  }

  // 수령·반납 방식 DB 저장 (hold 예약에만)
  type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>
  async function saveShipmentMethod(
    resId: string | undefined,
    pickup: DeliveryMethod,
    return_: DeliveryMethod,
    pickupTime?: string,
    returnTime?: string,
  ) {
    if (!resId) return
    await (supabase.rpc as unknown as RpcFn)('set_reservation_shipment_method', {
      p_reservation_id: Number(resId),
      p_pickup_method:  pickup,
      p_return_method:  return_,
      p_pickup_time:    pickupTime || null,
      p_return_time:    returnTime || null,
    })
  }

  // 옵션상품 수량 변경 — set_reservation_options는 전체 옵션 목록을 통째로 교체(delete+insert)하는
  // RPC라, 바뀐 항목 하나만이 아니라 이 예약의 옵션 전체를 다시 보내야 함(상품상세 handleReserve와
  // 동일한 페이로드 형태 재사용). 성공 시 invalidateAll()로 서버 실값(금액 포함) 재조회 — 로컬
  // 낙관적 갱신 없음(effectiveLineItems가 서버 파생값이라 직접 변형 불가)
  let pendingOptionKey = $state<string | null>(null)
  type SetOptionsRpcFn = (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>
  async function updateOptionQty(reservationId: string, line: CartLineItem | undefined, optionProductId: string | null, newQty: number) {
    if (!line || newQty < 1) return
    const key = `${reservationId}:${optionProductId}`
    pendingOptionKey = key
    try {
      const payload = line.options.map(o => ({
        option_product_id: o.optionProductId,
        option_name:       o.name,
        qty:                o.optionProductId === optionProductId ? newQty : o.qty,
        unit_price:        o.unitPrice,
      }))
      const { error } = await (supabase.rpc as unknown as SetOptionsRpcFn)('set_reservation_options', {
        p_reservation_id: Number(reservationId),
        p_options:        payload,
      })
      if (error) {
        csToast.error('옵션 수량 변경에 실패했습니다.')
        return
      }
      await invalidateAll()
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      pendingOptionKey = null
    }
  }

  // 배송 탭 — 카트 상품의 allowed_method_ids 기준으로 rental_method_options 필터링
  interface DeliveryTabMeta { v: DeliveryMethod; label: string; deadline: string }
  interface DeliveryOptionRow { id: string; method_key: string; name: string; deadline_time: string | null }

  function computeAllowedMethodIds(prods: ProductRow[]): Set<string> | 'all' | 'none' {
    type P = ProductRow & { allowed_method_ids?: string[] | null }
    const configured = prods.filter(p => Array.isArray((p as P).allowed_method_ids))
    // 카트가 비어있거나 allowed_method_ids 미설정 상품만 있으면 → 전체 표시
    if (configured.length === 0) return 'all'
    const sets = configured.map(p => (p as P).allowed_method_ids as string[])
    // 모든 카트 상품의 교집합
    const intersection = sets.reduce((acc, ids) => {
      const s = new Set(ids)
      return acc.filter(id => s.has(id))
    }, [...sets[0]])
    return intersection.length > 0 ? new Set<string>(intersection) : 'none'
  }

  // 카트 상품에 설정된 허용 방식 ID 교집합 ('all'=전체, 'none'=없음, Set=필터)
  const cartProductRows = $derived<ProductRow[]>(effectiveLineItems.map(l => l.product).filter((p): p is ProductRow => p !== null))
  const allowedMethodIds = $derived(computeAllowedMethodIds(cartProductRows))
  const deliveryTabs = $derived<DeliveryTabMeta[]>(
    allowedMethodIds === 'none' ? [] :
    ((data.deliveryOptions as DeliveryOptionRow[] | undefined) ?? [])
      .filter((o: DeliveryOptionRow) => o.method_key && (allowedMethodIds === 'all' || allowedMethodIds.has(o.id)))
      .map((o: DeliveryOptionRow) => ({ v: o.method_key as DeliveryMethod, label: o.name, deadline: o.deadline_time ?? '' }))
  );
  const otDeliveryFee = $derived(
    itemsState.reduce((sum, it) => sum + ((it.deleted || !it.checked) ? 0 : deliveryFee(it.opts.rentalMethod, otGrade)), 0)
  )

  // 서버 데이터 안전 추출
  const sdCoupons = $derived<UserCouponExt[]>((sd as { userCoupons?: UserCouponExt[] }).userCoupons ?? [])
  const sdUserPoints = $derived<number>((sd as { userPoints?: number }).userPoints ?? 0)
  // "회원정보 반영"(배송지) 체크박스 활성화 조건 — 저장된 배송지 주소가 있을 때만 사용 가능
  const sdHasUserAddress = $derived<boolean>((sd as { hasUserAddress?: boolean }).hasUserAddress ?? false)

  // 쿠폰 할인 합산
  const otCouponDiscount = $derived(
    sdCoupons
      .filter((uc) => otSelectedCouponIds.has(uc.id) && uc.coupons !== null)
      .reduce((sum, uc) => {
        const c = uc.coupons!
        return sum + (c.discount_type === 'fixed'
          ? c.discount_value
          : Math.round(otSubtotal * c.discount_value / 100))
      }, 0)
  )

  // 할인 후 금액 (VAT 부과 기준)
  const otNetBeforeVat = $derived(otSubtotal - otMembershipDiscount)

  // VAT 10%
  const otVat = $derived(Math.round(otNetBeforeVat * 0.1))

  // 포인트 사용 최대값 (보유 포인트 & 결제 금액 중 작은 값)
  const otMaxPoints = $derived(Math.min(sdUserPoints, Math.max(0, otNetBeforeVat + otVat + otDeliveryFee - otCouponDiscount)))

  // 합계 (VAT + 배송비 + 쿠폰 할인 - 포인트 사용)
  const otTotal = $derived(Math.max(0, otNetBeforeVat + otVat + otDeliveryFee - otCouponDiscount - otPointsUsed))

  // 보증금 (PRD.1.2.2.1.11) — 체크된(선택된) 상품만 합산
  const otDeposit = $derived(
    itemsState.reduce((sum, it, i) => {
      if (it.deleted || !it.checked) return sum
      return sum + itemDeposit(effectiveLineItems[i])
    }, 0)
  )

  // 적립 예정 포인트 (5%)
  const otEarnPoints = $derived(Math.round(otTotal * 0.05))

  // 대여 기간 (일수)
  function rentalDays(start: string, end: string): number {
    if (!start || !end) return 0
    const diff = new Date(end).getTime() - new Date(start).getTime()
    return Math.max(0, Math.ceil(diff / 86400000))
  }
  const otTotalDays = $derived(
    itemsState.reduce((sum, it) => sum + ((it.deleted || !it.checked) ? 0 : rentalDays(it.rentalDate, it.returnDate)), 0)
  )

  function fmtKrw(n: number): string {
    return n === 0 ? '0' : n.toLocaleString('ko-KR')
  }
</script>

<!-- ══ 공통 Sub GNB (PC + 모바일) ══ -->
<SubGnb title="Cart" mobileOnly />

<!-- ═══════════════════════ MAIN ═══════════════════════ -->
<div class="cart-root">
  <!-- 기존 PC 헤더 제거 — SubGnb로 통합 -->
  <header class="sub-gnb-b">
    <div class="sub-gnb-b-inner">
      <!-- Back + Cart pill -->
      <button type="button" class="sub-gnb-b-pill" onclick={() => history.back()} aria-label="뒤로 가기, 장바구니">
        <div class="sub-gnb-b-pill-left">
          <svg class="sub-gnb-b-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
            <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
          </svg>
          <span class="sub-gnb-b-back">Back</span>
        </div>
        <span class="sub-gnb-b-title">Order items</span>
      </button>
    </div>
  </header>

  <!-- ═══════════════════════ MAIN SCROLL ═══════════════════════ -->
  <main class="cart-main">
    <div class="cart-content">

      <!-- ── ORDER ITEMS ── -->
      <section class="cs-section">
        <!-- 모바일 전용(<641px): 상품별 개별 카드 (기존 레이아웃 그대로 유지 — 2026-07-27 마스터-디테일 변경은 PC 전용) -->
        <div class="mobile-cart-list">
          {#each itemsState as item, i (item.id)}
            {@render OrderCard(item, effectiveLineItems[i])}
          {/each}

          {#if itemsState.length === 0 || itemsState.every(it => it.deleted)}
            <div class="order-card empty-card">
              <p class="empty-text">장바구니가 비어 있습니다.</p>
            </div>
          {/if}
        </div>

        <!-- PC 전용(≥641px) 마스터-디테일 레이아웃: 상품목록(좌) / 대여옵션 DetailPanel(우) — CMS /cms/products 구조 동일 적용 -->
        <div class="master-detail">
          <!-- 카드 목록 패널 -->
          <div class="list-pane" class:narrow={hasItems}>
            {#if itemsState.length === 0 || itemsState.every(it => it.deleted)}
              <div class="order-card empty-card">
                <p class="empty-text">장바구니가 비어 있습니다.</p>
              </div>
            {:else}
              <div class="card-list" role="list">
                {#each itemsState as item, i (item.id)}
                  {#if !item.deleted}
                    {@render ItemListCard(item, effectiveLineItems[i])}
                  {/if}
                {/each}
              </div>
            {/if}
          </div>

          <!-- 통합 대여예약옵션 패널 (체크된 상품 1개 이상 시 활성화) -->
          {#if hasItems}
            <div class="detail-pane" transition:fly={{ x: 24, duration: 200 }}>
              <div class="order-card">
                <div class="order-card-inner">
                  {@render RentalOptionsEditor()}
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- ── 통합 대여예약옵션 패널 (체크된 상품 1개 이상일 때만 렌더 — 모바일 전용, PC는 detail-pane) -->
        {#if hasItems}
          <div class="bulk-panel">
            <button class="bulk-head" onclick={() => bulkOpen = !bulkOpen}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="bulk-lock">
                <rect x="2" y="6" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 6V4.5C5 2.84 6.34 1.5 8 1.5C9.66 1.5 11 2.84 11 4.5V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="8" cy="10.5" r="1.5" fill="currentColor"/>
              </svg>
              <span class="bulk-head-title">대여예약옵션</span>
              <svg width="11" height="7" viewBox="0 0 12 8" fill="none" aria-hidden="true" class="bulk-chevron"
                   style="transform:{bulkOpen ? 'rotate(180deg)' : 'rotate(0deg)'}">
                <path d="M1 1L6 7L11 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            {#if bulkOpen}
              <div transition:slide={{ duration: 250 }} class="bulk-body">
                {@render RentalOptionsEditor()}
              </div>
            {/if}
          </div>
        {/if}
      </section>

      <!-- ── ORDER TOTAL ── -->
      <section class="cs-section">
        <div class="sec-header">
          <span class="sec-title">Order Total</span>
        </div>

        <!-- Coupon + Fee detail box -->
        <div class="total-details-box">
          <!-- 쿠폰 섹션 (white bg) -->
          <div class="total-white-section">
            <span class="section-sub-label">사용 가능한 쿠폰</span>
            <div class="coupon-list">
              {#each sdCoupons as uc (uc.id)}
                {#if uc.coupons}
                  {@const c = uc.coupons}
                  {@const daysLeft = Math.max(0, Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86400000))}
                  {@const couponLabel = c.description ?? (c.discount_type === 'fixed' ? `${fmtKrw(c.discount_value)}원 할인` : `${c.discount_value}% 할인`)}
                  {@render CouponRow({
                    label: couponLabel,
                    days: daysLeft,
                    checked: otSelectedCouponIds.has(uc.id),
                    onToggle: () => {
                      // 중복 쿠폰 적용 불가(안내 문구와 일치) — 단일 선택만 허용
                      otSelectedCouponIds = otSelectedCouponIds.has(uc.id)
                        ? new Set()
                        : new Set([uc.id])
                    },
                  })}
                {/if}
              {:else}
                <p class="hint-text">사용 가능한 쿠폰이 없습니다.</p>
              {/each}
            </div>
            <p class="hint-text">중복 쿠폰 적용은 불가능합니다.</p>

            <!-- 포인트 사용 -->
            <span class="section-sub-label" style="margin-top: 16px; display: block;">포인트 사용</span>
            <div class="points-input-row">
              <input
                type="number"
                class="points-input"
                min="0"
                max={otMaxPoints}
                value={otPointsUsed}
                oninput={(e) => {
                  const v = Math.min(otMaxPoints, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                  otPointsUsed = v
                }}
              />
              <span class="points-avail">보유 <strong>{fmtKrw(sdUserPoints)}</strong>p</span>
            </div>
          </div>

          <!-- 약정요금 섹션 (gray bg) -->
          <div class="total-gray-section">
            <span class="section-sub-label">약정 요금</span>
            <div class="price-detail-list">
              <div class="price-period-row">
                <span class="price-period-label">총 대여기간</span>
                <div class="price-period-values">
                  {#if otTotalDays > 0}
                    <div class="period-val"><span class="period-num">{otTotalDays}</span><span class="period-unit">일</span></div>
                  {:else}
                    <span class="period-unset">날짜 미선택</span>
                  {/if}
                </div>
              </div>
              {@render PriceRow({ label: '대여요금', value: fmtKrw(otSubtotal) })}
              {#if otMembershipDiscount > 0}
                {@render PriceRow({ label: `멤버십 할인 (${otDiscountRate}%)`, value: `-${fmtKrw(otMembershipDiscount)}` })}
              {/if}
              {#if otCouponDiscount > 0}
                {@render PriceRow({ label: '쿠폰 할인', value: `-${fmtKrw(otCouponDiscount)}` })}
              {/if}
              {@render PriceRow({ label: '배송요금', value: otDeliveryFee > 0 ? fmtKrw(otDeliveryFee) : '무료' })}
              {@render PriceRow({ label: '부가세 (10%)', value: fmtKrw(otVat) })}
              {#if otPointsUsed > 0}
                {@render PriceRow({ label: '포인트 사용', value: `-${fmtKrw(otPointsUsed)}` })}
              {/if}
              <div class="price-divider"></div>
              {@render PriceRow({ label: '합계요금', value: fmtKrw(otTotal), large: true })}
              <div class="points-row">
                <span class="points-label">적립 예정 포인트</span>
                <div class="points-value"><span class="points-num">{fmtKrw(otEarnPoints)}</span><span class="points-unit">p</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 보증금 별도 고지 (PRD.1.2.2.1.11) -->
        <div class="deposit-notice">
          <div class="deposit-notice-row">
            <span class="deposit-label">보증금 (별도)</span>
            <div class="deposit-amount">
              <span class="deposit-num">{fmtKrw(otDeposit)}</span>
              <span class="deposit-unit">원</span>
            </div>
          </div>
          <p class="deposit-note">보증금은 대여 합계금액과 별도로 청구되며 반납 완료 후 전액 환불됩니다.</p>
        </div>

        <!-- Total dark box -->
        <div class="total-dark-box">
          <div class="total-dark-row">
            <span class="total-label">총 약정요금</span>
            <div class="total-amount">
              <span class="total-num">{fmtKrw(otTotal)}</span>
              <span class="total-unit">원</span>
            </div>
          </div>
          <div class="total-dark-row total-points-row">
            <span class="total-points-label">적립 예정 포인트</span>
            <div class="total-points-val">
              <span>{fmtKrw(otEarnPoints)}</span>
              <span>p</span>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA 푸터 노출 트리거 — 결제 영역(합계·보증금) 근접 시 IntersectionObserver 감지 -->
      <div bind:this={footerSentinel} class="footer-sentinel" aria-hidden="true"></div>
      <div style="height: 100px;"></div>
    </div>
  </main>

  <!-- ═══════════════════════ FOOTER ═══════════════════════ -->
  <footer class="cart-footer" class:footer-visible={footerVisible}>
    <div class="footer-inner">
      <label class="footer-terms">
        <button class="checkbox-btn" onclick={() => agreed = !agreed} aria-label="동의">
          <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
            {#if agreed}
              <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
              <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
              <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
            {/if}
          </svg>
        </button>
        <span class="footer-terms-text">등록한 대여 조건에 모두 동의합니다.</span>
      </label>
      <button
        class="footer-cta"
        class:footer-cta-active={canProceed && !isConfirming}
        class:footer-cta-disabled={!canProceed || isConfirming}
        disabled={!canProceed || isConfirming}
        onclick={async () => {
          if (!canProceed || isConfirming) return
          isConfirming = true
          try {
            // 체크 해제한 상품은 이번 결제 확정 대상에서 제외 — 선택된(checked) 예약 id만 전송
            const checkedIds = itemsState.filter(it => !it.deleted && it.checked).map(it => it.id)

            // draft 항목(날짜 없는 임시예약)을 먼저 승격(promote_draft_reservation) — 모두 성공한 뒤 confirm-mock 진행
            const draftItemIds = new Set(
              effectiveLineItems
                .filter(l => l.status === 'draft' && checkedIds.includes(l.reservationId))
                .map(l => l.reservationId)
            )
            if (draftItemIds.size > 0) {
              const TWO_DAY_LEADTIME_KEYS_CO = new Set(['delivery', 'epost'])
              const nowTimeCo = new Date()
              for (const it of itemsState.filter(x => !x.deleted && x.checked && draftItemIds.has(x.id))) {
                // 리드타임 재검증 (날짜 없이 예약됐으므로 여기서 처음 검증)
                const needsTwoDayLeadtime = TWO_DAY_LEADTIME_KEYS_CO.has(it.opts.rentalMethod)
                if (needsTwoDayLeadtime) {
                  const twoDaysLater = new Date(nowTimeCo.getFullYear(), nowTimeCo.getMonth(), nowTimeCo.getDate() + 2)
                  const startDateOnly = new Date(`${it.rentalDate}T00:00:00`)
                  if (startDateOnly < twoDaysLater) {
                    csToast.error('택배 대여는 대여일 2일 전 예약 가능합니다.')
                    return
                  }
                } else {
                  const todayIsoCo = `${nowTimeCo.getFullYear()}-${String(nowTimeCo.getMonth() + 1).padStart(2, '0')}-${String(nowTimeCo.getDate()).padStart(2, '0')}`
                  if (it.rentalDate === todayIsoCo) {
                    const [hStr, mStr] = (it.rentalTime || '00:00').split(':')
                    const startH = parseInt(hStr ?? '0', 10)
                    const startM = parseInt(mStr ?? '0', 10)
                    const startDt = new Date(`${it.rentalDate}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`)
                    const threeHoursLater = new Date(nowTimeCo.getTime() + 3 * 60 * 60 * 1000)
                    if (startDt < threeHoursLater) {
                      csToast.error('당일 대여는 대여시간 기준 3시간 전 방문만 가능합니다.')
                      return
                    }
                  }
                }
                // promote_draft_reservation RPC 호출
                type PromoteRpcFn = (name: string, args: Record<string, unknown>) => Promise<{
                  data: Array<{ success: boolean; reservation_id: number | null; error_message: string | null }> | null;
                  error: unknown;
                }>
                const { data: promoteRows } = await (supabase.rpc as unknown as PromoteRpcFn)('promote_draft_reservation', {
                  p_reservation_id: Number(it.id),
                  p_start_date:     it.rentalDate,
                  p_end_date:       it.returnDate,
                })
                const promoteRow = promoteRows?.[0]
                if (!promoteRow?.success) {
                  csToast.error(promoteRow?.error_message ?? '해당 기간에 예약 가능한 재고가 없습니다.')
                  return
                }
                // 수령·반납 방식 저장 (기존 saveShipmentMethod 재사용)
                await saveShipmentMethod(it.id, it.opts.rentalMethod, it.opts.returnMethod, it.rentalTime, it.returnTime)
                // 대여 기간 유형 저장 (products/[id]/+page.svelte L320-322와 동일 판정 기준)
                const isSameDayRentalCo = it.rentalDate === it.returnDate
                const [rhStr, rmStr] = (it.rentalTime || '00:00').split(':')
                const [etStr, emStr] = (it.returnTime || '00:00').split(':')
                const startMinsCo = parseInt(rhStr ?? '0', 10) * 60 + parseInt(rmStr ?? '0', 10)
                const endMinsCo   = parseInt(etStr ?? '0', 10) * 60 + parseInt(emStr ?? '0', 10)
                const sameDayMinsCo   = endMinsCo - startMinsCo
                const durationTypeCo  = isSameDayRentalCo && sameDayMinsCo > 0 && sameDayMinsCo <= 720 ? '12h' : '24h'
                type DurationRpcFnCo = (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>
                await (supabase.rpc as unknown as DurationRpcFnCo)('set_reservation_duration', {
                  p_reservation_id: Number(it.id),
                  p_duration_type:  durationTypeCo,
                })
                // 채팅 알림 발송 (draft 생성 시 미발송 → 승격 성공 시점에 최초 발송 — FE-2 STEP4 참고)
                fetch('/api/checkout/notify-hold', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reservationId: Number(it.id) }),
                }).catch(() => {})
              }
            }
            // 모든 draft 승격 완료 후 confirm-mock 호출 (confirm-mock은 status='hold' 행만 처리)
            const selectedCouponId = otSelectedCouponIds.size > 0 ? [...otSelectedCouponIds][0] : null
            const res = await fetch('/api/checkout/confirm-mock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reservationIds: checkedIds, userCouponId: selectedCouponId }),
            })
            const result = await res.json()
            if (res.ok && result.success) {
              const firstIndex = itemsState.findIndex(it => !it.deleted && it.checked)
              const first = firstIndex >= 0 ? itemsState[firstIndex] : undefined
              const firstLine = firstIndex >= 0 ? effectiveLineItems[firstIndex] : undefined
              const firstReservation = result.confirmedReservations?.[0] as { id: number; reservationCode: string | null } | undefined
              const nowDt = new Date()
              const padN = (n: number) => String(n).padStart(2, '0')
              const confirmedAt = `${nowDt.getFullYear()}.${padN(nowDt.getMonth()+1)}.${padN(nowDt.getDate())}·${padN(nowDt.getHours())}:${padN(nowDt.getMinutes())}`
              const activeItems = itemsState
                .filter(it => !it.deleted && it.checked)
                .map((it) => {
                  const line = effectiveLineItems.find(l => l.reservationId === it.id)
                  const res = (result.confirmedReservations as Array<{id: number; reservationCode: string | null}>).find(r => String(r.id) === it.id)
                  return {
                    name: line?.product?.name ?? '촬영 장비',
                    code: res?.reservationCode ?? '',
                    startDate: it.rentalDate,
                    endDate: it.returnDate,
                    pickupMethod: DELIVERY_LABELS[it.opts.rentalMethod] ?? it.opts.rentalMethod,
                    returnMethod: DELIVERY_LABELS[it.opts.returnMethod] ?? it.opts.returnMethod,
                    price: itemCardRate(line, it.durType) * Math.max(it.qty, 1),
                    options: (line?.options ?? []).map(o => ({ name: o.name, qty: o.qty })),
                  }
                })
              const params = new URLSearchParams({
                items:              JSON.stringify(activeItems),
                amount:             String(otTotal),
                subtotal:           String(otSubtotal),
                membershipDiscount: String(otMembershipDiscount),
                couponDiscount:     String(otCouponDiscount),
                deliveryFee:        String(otDeliveryFee),
                vat:                String(otVat),
                pointsUsed:         String(otPointsUsed),
                paymentMethod:      '카드(테스트)',
                confirmedAt,
              })
              await goto(`/payment/success/dev?${params.toString()}`)
            } else {
              csToast.error('예약 처리 중 오류가 발생했습니다.')
            }
          } catch {
            csToast.error('네트워크 오류가 발생했습니다.')
          } finally {
            isConfirming = false
          }
        }}
      >
        {isConfirming ? '처리 중...' : confirmLabel}
      </button>
    </div>
  </footer>

</div>

<!-- ═══════════════════════ SNIPPET COMPONENTS ═══════════════════════ -->

{#snippet OrderCard(item: CartItemUiState, line: CartLineItem | undefined)}
  {#if !item.deleted}
    {@const rate24 = itemRate24h(line)}
    {@const rate12 = itemRate12h(line, rate24)}
    {@const cardRateVal = cardRate(rate24, rate12, item.durType)}
    <div class="order-card">
      <div class="order-card-inner">
        <!-- Check & Delete -->
        <div class="card-top-row">
          <button class="checkbox-btn" onclick={() => updateItem(item.id, { checked: !item.checked })} aria-label="선택">
            <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
              {#if item.checked}
                <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              {:else}
                <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
              {/if}
            </svg>
          </button>
          <button class="delete-btn" onclick={() => removeItem(item)} aria-label="삭제">
            <svg width="14" height="14" viewBox="0 0 17 17" fill="none">
              <path d="M15.5 1.5L8.5 8.5M8.5 8.5L1.5 15.5M8.5 8.5L15.5 15.5M8.5 8.5L1.5 1.5" stroke="#AAAAAA" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
            </svg>
          </button>
        </div>

        <!-- Product Row -->
        <div class="product-row">
          <div class="product-img">
            <img src={line?.product?.image_urls?.[0] ?? 'https://picsum.photos/seed/cam/150/150'} alt={line?.product?.name ?? '상품'} width="150" height="150"/>
          </div>
          <div class="product-meta">
            <p class="product-name">{line?.product?.name ?? '상품'}</p>
            <div class="dur-tabs" role="group" aria-label="대여 기간 유형">
              {#each DUR_TYPES as d}
                <button
                  class="dur-tab"
                  class:dur-tab-active={item.durType === d}
                  onclick={() => updateItem(item.id, { durType: d })}
                  aria-pressed={item.durType === d}
                >{DUR_LABELS[d]}</button>
              {/each}
            </div>
            <p class="product-price">
              {DUR_LABELS[item.durType]}&nbsp;
              {item.durType === 'purchase' ? '별도 문의' : `${cardRateVal.toLocaleString()} 원`}
            </p>
            <div class="product-badges">
              <div class="badge-mem">
                <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                  <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#FF3535"/>
                  <path d="M23.0742 19.2136C23.0742 20.9516 21.6979 22.3606 20.0001 22.3606C18.3022 22.3606 16.9259 20.9516 16.9259 19.2136C16.9259 17.4755 18.3022 16.0665 20.0001 16.0665C21.6979 16.0665 23.0742 17.4755 23.0742 19.2136Z" fill="white"/>
                </svg>
              </div>
              <div class="badge-deal">
                <svg viewBox="0 0 40 40" fill="none" class="badge-svg">
                  <path d="M20 0L23.9714 3.03625L28.9008 1.98062L31.1277 6.39613L36.0388 7.5302L36.08 12.4504L40 15.5496L37.8475 20L40 24.4504L36.08 27.5496L36.0388 32.4698L31.1277 33.6039L28.9008 38.0194L23.9714 36.9637L20 40L16.0286 36.9637L11.0992 38.0194L8.87228 33.6039L3.96124 32.4698L3.91998 27.5496L0 24.4504L2.15253 20L0 15.5496L3.91998 12.4504L3.96124 7.5302L8.87228 6.39613L11.0992 1.98062L16.0286 3.03625L20 0Z" fill="#553FE0"/>
                  <path d="M25 14L22 20L25 26H15L18 20L15 14H25Z" fill="white"/>
                </svg>
              </div>
            </div>
          </div>
          <div class="qty-wrap">
            <span class="qty-label">수량</span>
            <div class="qty-ctrl">
              <button class="qty-arrow" onclick={() => updateItem(item.id, { qty: Math.max(1, item.qty - 1) })}>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
              </button>
              <div class="qty-num">{item.qty}</div>
              <button class="qty-arrow" onclick={() => updateItem(item.id, { qty: item.qty + 1 })}>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 옵션상품 — 본상품 카드와 동일한 형태의 하위 카드로 표시 -->
        {#if line?.options?.length}
          <div class="option-subcard-list">
            {#each line.options as opt}
              <div class="option-subcard">
                <svg class="option-subcard-connector" aria-hidden="true" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1.50404 1.5C1.50404 1.5 1.49303 5.60062 1.50738 12.8098C1.52173 20.0189 7 23.5 11.5 23.5C16 23.5 23.5 23.5 23.5 23.5" stroke="var(--cs-text-light)" stroke-width="3" stroke-linecap="round"/>
                </svg>
                <div class="option-subcard-img">
                  {#if opt.imageUrl}
                    <img src={opt.imageUrl} alt={opt.name} loading="lazy" />
                  {/if}
                </div>
                <div class="option-subcard-info">
                  <p class="option-subcard-name">{opt.name}</p>
                  <div class="option-subcard-bottom">
                    <p class="option-subcard-price">{fmtKrw(opt.unitPrice * opt.qty)}원</p>
                    <div class="opt-qty-ctrl">
                      <button class="opt-qty-arrow" onclick={() => updateOptionQty(item.id, line, opt.optionProductId, opt.qty - 1)} disabled={opt.qty <= 1 || pendingOptionKey === `${item.id}:${opt.optionProductId}`} aria-label="옵션 수량 감소">−</button>
                      <span class="opt-qty-num">{opt.qty}</span>
                      <button class="opt-qty-arrow" onclick={() => updateOptionQty(item.id, line, opt.optionProductId, opt.qty + 1)} disabled={pendingOptionKey === `${item.id}:${opt.optionProductId}`} aria-label="옵션 수량 증가">+</button>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}

      </div>
    </div>
  {/if}
{/snippet}

{#snippet ItemListCard(item: CartItemUiState, line: CartLineItem | undefined)}
  {@const rate24 = itemRate24h(line)}
  {@const rate12 = itemRate12h(line, rate24)}
  {@const cardRateVal = cardRate(rate24, rate12, item.durType)}
  <div class="item-card" class:selected={item.checked} role="listitem">
    <div
      class="item-card-body"
      role="button"
      tabindex="0"
      onclick={() => updateItem(item.id, { checked: !item.checked })}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateItem(item.id, { checked: !item.checked }) } }}
      aria-pressed={item.checked}
      aria-label={`${line?.product?.name ?? '상품'} 결제 포함 선택`}
    >
      <div class="item-card-top-row">
        <div class="item-thumb-wrap">
          <img src={line?.product?.image_urls?.[0] ?? 'https://picsum.photos/seed/cam/150/150'} alt={line?.product?.name ?? '상품'} class="item-thumb" width="108" height="108" loading="lazy"/>
        </div>
        <div class="item-info">
          <p class="item-name">{line?.product?.name ?? '상품'}</p>
          <div class="item-info-top">
            <span class="dur-badge">{DUR_LABELS[item.durType]}</span>
            <span class="fee-badge">{((cardRateVal + itemOptionsAmount(line)) * item.qty).toLocaleString()}원</span>
          </div>
          <div class="qty-wrap qty-wrap--sm">
            <div class="qty-ctrl" role="group" aria-label="수량">
              <button class="qty-arrow" onclick={(e) => { e.stopPropagation(); updateItem(item.id, { qty: Math.max(1, item.qty - 1) }) }} aria-label="수량 감소">
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
              </button>
              <div class="qty-num">{item.qty}</div>
              <button class="qty-arrow" onclick={(e) => { e.stopPropagation(); updateItem(item.id, { qty: item.qty + 1 }) }} aria-label="수량 증가">
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="#444444" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      {#if line?.options?.length}
        <div class="option-subcard-list option-subcard-list--compact">
          {#each line.options as opt}
            <div class="option-subcard option-subcard--compact">
              <svg class="option-subcard-connector" aria-hidden="true" width="18" height="18" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.50404 1.5C1.50404 1.5 1.49303 5.60062 1.50738 12.8098C1.52173 20.0189 7 23.5 11.5 23.5C16 23.5 23.5 23.5 23.5 23.5" stroke="var(--cs-text-light)" stroke-width="3" stroke-linecap="round"/>
              </svg>
              <div class="option-subcard-img">
                {#if opt.imageUrl}
                  <img src={opt.imageUrl} alt={opt.name} loading="lazy" />
                {/if}
              </div>
              <div class="option-subcard-info">
                <p class="option-subcard-name">{opt.name}</p>
                <div class="option-subcard-bottom">
                  <p class="option-subcard-price">{fmtKrw(opt.unitPrice * opt.qty)}원</p>
                  <div class="opt-qty-ctrl">
                    <button class="opt-qty-arrow" onclick={(e) => { e.stopPropagation(); updateOptionQty(item.id, line, opt.optionProductId, opt.qty - 1) }} disabled={opt.qty <= 1 || pendingOptionKey === `${item.id}:${opt.optionProductId}`} aria-label="옵션 수량 감소">−</button>
                    <span class="opt-qty-num">{opt.qty}</span>
                    <button class="opt-qty-arrow" onclick={(e) => { e.stopPropagation(); updateOptionQty(item.id, line, opt.optionProductId, opt.qty + 1) }} disabled={pendingOptionKey === `${item.id}:${opt.optionProductId}`} aria-label="옵션 수량 증가">+</button>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <button class="delete-btn item-card-delete" onclick={() => removeItem(item)} aria-label="삭제">
      <svg width="14" height="14" viewBox="0 0 17 17" fill="none">
        <path d="M15.5 1.5L8.5 8.5M8.5 8.5L1.5 15.5M8.5 8.5L15.5 15.5M8.5 8.5L1.5 1.5" stroke="#AAAAAA" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
      </svg>
    </button>
  </div>
{/snippet}

{#snippet RentalOptionsEditor()}
  <!-- 통합 단일 대여예약옵션 편집기 — bulkOpts/bulkDate/bulkTime/bulkRentalForm/bulkReturnForm 클로저 참조 -->
  <div class="accordions">
    <!-- 대여 방법 -->
    <div class="acc-item">
      <button class="acc-head" onclick={() => bulkOpenAcc = 'rental'}>
        <span class="acc-label">대여 방법</span>
        <div class="acc-head-right">
          <span class="acc-value">{methodLabel(bulkOpts.rentalMethod)}</span>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{bulkOpenAcc === 'rental' ? 'rotate(180deg)' : 'none'}">
            <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
      {#if bulkOpenAcc === 'rental'}
        <div transition:slide={{ duration: 300 }} class="acc-body">
          {@render RentalForm({ type: 'rental', calId: 'bulk-rental', selectedDate: bulkDate, onDateChange: bulkHandleDate, timeId: 'bulk-rental-t', selectedTime: bulkTime, onTimeChange: bulkHandleTime, method: bulkOpts.rentalMethod, form: bulkRentalForm, copyToReturn: bulkOpts.copyToReturn, onMethodChange: bulkHandleMethod, onFormChange: bulkHandleRentalForm, onCopyChange: bulkHandleCopy, hasUserAddress: sdHasUserAddress })}
        </div>
      {/if}
    </div>
    <!-- 반납 방법 -->
    <div class="acc-item">
      <button class="acc-head" onclick={() => bulkOpenAcc = 'return_'}>
        <span class="acc-label">반납 방법</span>
        <div class="acc-head-right">
          <span class="acc-value">{methodLabel(bulkOpts.returnMethod)}</span>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style="transition:transform 0.3s;transform:{bulkOpenAcc === 'return_' ? 'rotate(180deg)' : 'none'}">
            <path d="M1 1L6 7L11 1" stroke="#444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
      {#if bulkOpenAcc === 'return_'}
        <div transition:slide={{ duration: 300 }} class="acc-body">
          {@render RentalForm({ type: 'return', calId: 'bulk-return', selectedDate: bulkDate, onDateChange: bulkHandleDate, timeId: 'bulk-return-t', selectedTime: bulkTime, onTimeChange: bulkHandleTime, method: bulkOpts.returnMethod, form: bulkReturnForm, onMethodChange: bulkHandleReturnMethod, onFormChange: bulkHandleReturnForm })}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet RentalForm(props: {
  type: 'rental' | 'return';
  method: DeliveryMethod;
  form: FormState;
  calId: string;
  selectedDate: string;
  onDateChange: (d: string) => void;
  timeId: string;
  selectedTime: string;
  onTimeChange: (t: string) => void;
  copyToReturn?: boolean;
  onMethodChange: (v: DeliveryMethod) => void;
  onFormChange: (f: FormState) => void;
  onCopyChange?: (v: boolean) => void;
  hasUserAddress?: boolean;
})}
  {@const sectionLabel = props.type === 'rental' ? '수령 방식' : '반납 방식'}
  {@const dateLabel = props.type === 'rental' ? '수령일' : '반납일'}
  {@const timeLabel = props.type === 'rental' ? '수령시간' : '반납시간'}
  {@const addrLabel = props.type === 'rental' ? '배송지 정보' : '반납위치 지정정보'}
  {@const addrNote = props.type === 'rental'
    ? '대여 시작일은 배송일 기준 최소 2일 전까지 선택 가능합니다.'
    : '반납 방식이 수령 방식과 다를 경우 추가 비용이 발생할 수 있습니다.'}
  {@const isCalOpen = openCalId === props.calId}
  {@const isTimeOpen = openTimeId === props.timeId}


  <div class="rental-form">
    <!-- 수령/반납 방식 -->
    <div class="form-section">
      <span class="form-section-label">{sectionLabel}</span>
      <div class="form-section-body">
        <!-- DB rental_method_options → 콤보 버튼 -->
        <div class="delivery-combo">
          {#each deliveryTabs as tab}
            <button
              class="combo-btn"
              class:combo-btn-active={props.method === tab.v}
              onclick={() => props.onMethodChange(tab.v)}
            >
              <span class="combo-label">{tab.label}</span>
            </button>
          {/each}
        </div>
        <!-- 선택된 방식 마감 정보 -->
        {#each deliveryTabs.filter(t => t.v === props.method) as tab}
          {#if tab.deadline}<p class="delivery-deadline">{tab.deadline}</p>{/if}
        {/each}
        <!-- Date/Time buttons + Calendar -->
        <div class="datetime-wrap">
          <div class="datetime-btns">
            <button class="datetime-btn datetime-btn-dark" onclick={() => openCal(props.calId, props.selectedDate)}>
              <div class="datetime-btn-left">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect fill="rgba(255,255,255,0.3)" height="20" rx="5.5" width="22" y="2"/>
                  <path d="M3 3C3 1.27 4.27 0 5.97 0C7.47 0 8.69 1.27 8.69 2.84C8.69 4.42 7.47 5.69 5.97 5.69H5.72C4.22 5.69 3 4.42 3 2.84" fill="rgba(255,255,255,0.6)"/>
                  <path d="M13.28 2.84C13.28 1.27 14.5 0 16 0C17.75 0 18.97 1.27 18.97 2.84C18.97 4.42 17.75 5.69 16.25 5.69H16C14.5 5.69 13.28 4.42 13.28 2.84" fill="rgba(255,255,255,0.6)"/>
                  <path d="M3 7C3 5.89 3.72 5 4.6 5L17.4 5C18.28 5 19 5.9 19 7C19 8.1 18.28 9 17.4 9L4.6 9C3.72 9 3 8.1 3 7Z" fill="white"/>
                  <path d="M3 13C3 11.9 3.76 11 4.7 11L9.3 11C10.24 11 11 11.9 11 13V15C11 16.1 10.24 17 9.3 17H4.7C3.76 17 3 16.1 3 15V13Z" fill="white"/>
                </svg>
                <span class="datetime-btn-label">{props.selectedDate ? displayDate(props.selectedDate) : dateLabel}</span>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
            <button class="datetime-btn datetime-btn-mid" onclick={() => openTime(props.timeId)}>
              <div class="datetime-btn-left">
                <svg width="23" height="23" viewBox="0 0 22.5 22.5" fill="none">
                  <path d="M11.25 0C13.69 0 15.95 0.78 17.8 2.1L19 0.5C19.41 -0.05 20.2 -0.16 20.75 0.25C21.3 0.66 21.41 1.45 21 2L19.66 3.78C21.43 5.77 22.5 8.38 22.5 11.25C22.5 17.46 17.46 22.5 11.25 22.5C5.04 22.5 0 17.46 0 11.25C0 8.33 1.11 5.68 2.93 3.68L1.55 2.06C1.1 1.54 1.16 0.75 1.69 0.3C2.21 -0.15 3 -0.09 3.45 0.44L4.81 2.03C6.63 0.75 8.85 0 11.25 0ZM11 5C10.31 5 9.75 5.56 9.75 6.25V12.17C9.75 12.64 10.01 13.07 10.42 13.28L14.42 15.36C15.04 15.68 15.79 15.44 16.11 14.83C16.43 14.21 16.19 13.46 15.58 13.14L12.25 11.41V6.25C12.25 5.56 11.69 5 11 5Z" fill="rgba(255,255,255,0.8)"/>
                </svg>
                <span class="datetime-btn-label">{props.selectedTime || timeLabel}</span>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
          </div>

          <!-- 달력 레이어 -->
          {#if isCalOpen}
            <div class="cal-layer" transition:slide={{ duration: 200 }}>
              <CalendarGrid
                value={props.selectedDate}
                onselect={(iso) => { props.onDateChange(iso); openCalId = null; }}
              />
            </div>
          {/if}

          <!-- 시간 선택 레이어 -->
          {#if isTimeOpen}
            <div class="time-layer" transition:slide={{ duration: 200 }}>
              <div class="time-grid">
                {#each Array.from({length: 24}, (_, i) => i) as h}
                  {@const t = fmtTime(h)}
                  {@const isSel = props.selectedTime === t}
                  <button
                    class="time-cell"
                    class:time-cell-sel={isSel}
                    onclick={() => { props.onTimeChange(t); openTimeId = null; }}
                  >{t}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <p class="form-note">{addrNote}</p>
      </div>
    </div>

    <!-- 고객 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">고객 정보</span>
        <label class="form-check-label">
          <button class="checkbox-btn small" onclick={() => props.onFormChange({ ...props.form, memberCheck: !props.form.memberCheck })} aria-label="회원정보 반영">
            <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
              {#if props.form.memberCheck}
                <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              {:else}
                <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
              {/if}
            </svg>
          </button>
          <span>회원정보 반영</span>
        </label>
      </div>
      <div class="form-fields">
        <input class="f-input" placeholder="이름 입력" value={props.form.name} oninput={(e) => props.onFormChange({ ...props.form, name: readInputValue(e) })}/>
        <input class="f-input" placeholder="전자메일주소 입력" value={props.form.email} oninput={(e) => props.onFormChange({ ...props.form, email: readInputValue(e) })}/>
        <div class="f-row">
          <input class="f-input f-grow" placeholder="휴대번호를 '-' 없이 입력" value={props.form.phone} oninput={(e) => props.onFormChange({ ...props.form, phone: readInputValue(e) })}/>
          <button class="f-action-btn" onclick={() => requestGuestOtp(props.form.email)}>인증실행</button>
        </div>
        <div class="f-row">
          <input class="f-input f-grow" placeholder="6자리 인증번호를 입력" value={props.form.authCode} oninput={(e) => props.onFormChange({ ...props.form, authCode: readInputValue(e) })}/>
          <button class="f-action-btn" onclick={() => verifyGuestOtp(props.form.email, props.form.authCode, props.form)}>인증확인</button>
        </div>
      </div>
    </div>

    <!-- 배송지/반납위치 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">{addrLabel}</span>
        {#if props.type === 'rental'}
          <label class="form-check-label" class:form-check-label-disabled={!props.hasUserAddress}>
            <button
              class="checkbox-btn small"
              disabled={!props.hasUserAddress}
              onclick={() => props.onFormChange({ ...props.form, memberCheck2: !props.form.memberCheck2 })}
              aria-label="회원정보 반영"
            >
              <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
                {#if props.form.memberCheck2}
                  <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
                  <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                {:else}
                  <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
                  <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
                {/if}
              </svg>
            </button>
            <span>회원정보 반영</span>
          </label>
        {/if}
      </div>
      <div class="form-fields">
        <input class="f-input" placeholder="기본주소 입력" value={props.form.addr} oninput={(e) => props.onFormChange({ ...props.form, addr: readInputValue(e) })}/>
        <input class="f-input" placeholder="상세주소 입력" value={props.form.addrDetail} oninput={(e) => props.onFormChange({ ...props.form, addrDetail: readInputValue(e) })}/>
      </div>
      {#if props.method === 'visit'}
        <div class="visit-info">
          <p>인천공항 제1터미널 도착홀 D, 5번 게이트 대면 수령</p>
          <p>가양동 사옥 1층 고객센터 방문 수령</p>
        </div>
      {/if}
    </div>

    <!-- 요청 사항 -->
    <div class="form-section">
      <span class="form-section-label">요청 사항</span>
      <input class="f-input" placeholder="알아보기 쉽게 입력 필수" value={props.form.notes} oninput={(e) => props.onFormChange({ ...props.form, notes: readInputValue(e) })}/>
      <p class="form-note-sm">공동현관 출입번호 / 경비실 호출 / 세대호출 / 자유 출입가능 등</p>
    </div>

    <!-- Copy to return checkbox -->
    {#if props.type === 'rental' && props.onCopyChange}
      <label class="copy-label">
        <button class="checkbox-btn small" onclick={() => props.onCopyChange?.(!props.copyToReturn)} aria-label="반납에 동일 적용">
          <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
            {#if props.copyToReturn}
              <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
              <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
              <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
            {/if}
          </svg>
        </button>
        <span>선택된 수령 옵션을 상품 반납 방법에 동일하게 적용합니다.</span>
      </label>
    {/if}
  </div>
{/snippet}

{#snippet CouponRow(props: { label: string; days: number; checked: boolean; onToggle: () => void })}
  <div class="coupon-row">
    <label class="coupon-row-left">
      <button class="checkbox-btn small" onclick={props.onToggle} aria-label={props.label}>
        <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
          {#if props.checked}
            <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
            <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          {:else}
            <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
            <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
          {/if}
        </svg>
      </button>
      <span class="coupon-label">{props.label}</span>
    </label>
    <div class="coupon-expiry">
      <span class="coupon-days">{props.days}</span>
      <span>일 뒤 소멸</span>
    </div>
  </div>
{/snippet}

{#snippet PriceRow(props: { label: string; value: string; large?: boolean })}
  <div class="price-row">
    <span class="price-row-label" class:price-row-large={props.large}>{props.label}</span>
    <div class="price-row-right">
      <span class="price-row-val" class:price-row-val-large={props.large}>{props.value}</span>
      <span class="price-row-unit">원</span>
    </div>
  </div>
{/snippet}

<style>
  /* ══ Reset & Root ══ */
  :global(body) {
    margin: 0;
    font-family: var(--font-kr);
    background: #ECEBF4;
  }

  .cart-root {
    min-height: 100vh;
    background: #ECEBF4;
    display: flex;
    flex-direction: column;
    font-family: var(--font-kr);
  }

  /* ══ Header ══ */
  .sub-gnb-b {
    position: sticky;
    top: 0;
    z-index: 50;
    background: transparent;
    border-bottom: none;
    /* 모바일: SubGnb가 대체 — 헤더 숨김 */
    display: none;
  }
  @media (min-width: 641px) {
    .sub-gnb-b { display: block; }
  }
  .sub-gnb-b-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 30px;
    width: 100%;
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: 20px var(--layout-pc-pad);
    flex-wrap: nowrap;
    box-sizing: border-box;
  }
  .sub-gnb-b-pill {
    background: rgba(225, 222, 243, 0.4);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 40px;
    border-radius: 25px;
    width: 100%;
    max-width: none;
    min-width: 0;
    min-height: 62px;
    flex: 1 1 auto;
    box-sizing: border-box;
    color: var(--cs-text);
    transition: background 0.2s;
  }
  .sub-gnb-b-pill:hover { background: rgba(225, 222, 243, 0.85); }
  .sub-gnb-b-pill-left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .sub-gnb-b-arrow {
    width: 22px;
    height: 18px;
    flex-shrink: 0;
  }
  .sub-gnb-b-back {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    white-space: nowrap;
  }
  .sub-gnb-b-title {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-text);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* ══ Main ══ */
  .cart-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 50px 0;
  }
  .cart-content {
    width: 100%;
    max-width: 1240px;
    padding: 0 20px;
    display: flex;
    flex-direction: column;
    gap: 50px;
    box-sizing: border-box;
  }

  /* ══ Section ══ */
  .cs-section {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .sec-header {
    display: flex;
    align-items: center;
    padding: 20px 40px;
  }
  .sec-title {
    font-family: var(--font-en-display);
    font-size: 20px;
    color: #100B32;
    line-height: 1.6;
  }
  /* ══ 모바일 전용(<641px) 카트 목록 — 상품별 개별 카드 (기존 레이아웃) ══ */
  .mobile-cart-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  @media (min-width: 641px) {
    .mobile-cart-list { display: none; }
  }

  /* ══ PC 전용(≥641px) 마스터-디테일 레이아웃: 상품목록(좌) / 대여옵션 DetailPanel(우) — CMS /cms/products 구조 동일 ══ */
  .master-detail {
    display: none;
  }
  @media (min-width: 641px) {
    .master-detail {
      display: flex;
      flex-direction: row;
      gap: 16px;
      align-items: flex-start;
    }
  }

  /* 카드 목록 패널 */
  .list-pane {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: width 0.22s ease;
  }
  @media (min-width: 641px) {
    /* 목록(좌) : 상세(우) = 5:5 비율 */
    .list-pane.narrow { width: auto; flex: 1 1 0; }
  }

  /* 카드 목록 */
  .card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* 상품 리스트 카드 */
  .item-card {
    position: relative;
    display: flex;
    align-items: stretch;
    background: white;
    border-radius: var(--radius-lg, 20px);
    box-shadow: 0px 1px 2px rgba(0,0,0,0.06);
    border: 1.5px solid transparent;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
    overflow: hidden;
    padding: var(--spacing-5, 20px);   /* 카드 내부 상하좌우 패딩 — front 표준 spacing 토큰(lg=20px) */
  }
  .item-card:hover { background: var(--cs-lilac); }
  /* 결제 포함 여부(item.checked) — 이전 세대 체크박스 아이콘 UI 대체, 카드 자체 배경색으로 표현 */
  .item-card.selected { background: var(--cs-purple-op10); }
  /* 카드(BG 영역) 최상단 우측 고정 — 옵션상품이 늘어나 카드가 길어져도 항상 카드 첫 줄
     높이에 맞춰 고정. 12px = 카드 패딩(20px) - 버튼 자체 여백(8px), 콘텐츠 여백과 시각적으로 정렬 */
  .item-card-delete {
    position: absolute;
    top: 12px;
    right: 12px;
  }
  .item-card-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    flex: 1;
    min-width: 0;
    padding: 0 34px 0 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .item-card-top-row {
    display: flex;
    align-items: center;
    gap: 15px;
    width: 100%;
  }
  .item-thumb-wrap {
    flex-shrink: 0;
    width: 108px;
    height: 108px;
    border-radius: var(--radius-md, 15px);
    overflow: hidden;
    background: #F2F2F8;
  }
  .item-thumb { width: 108px; height: 108px; object-fit: cover; display: block; }
  .item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .item-info-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .dur-badge {
    display: inline-block;
    padding: 4px 9px;
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-radius: var(--radius-full, 9999px);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }
  .fee-badge {
    display: inline-block;
    padding: 4px 9px;
    background: #F3F4F6;
    color: var(--cs-text-dark);
    border-radius: var(--radius-full, 9999px);
    font: var(--text-pc-script-12);
    font-weight: 700;
    white-space: nowrap;
  }
  .item-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 대여옵션 DetailPanel — 목록(좌) : 상세(우) = 5:5 비율 */
  .detail-pane {
    flex: 1 1 0;
    min-width: 0;
    width: 100%;
  }

  /* ══ Order Card (DetailPanel 내부 카드) ══ */
  .order-card {
    background: white;
    border-radius: 50px;
    width: 100%;
    box-sizing: border-box;
  }
  .order-card-inner {
    display: flex;
    flex-direction: column;
    gap: 50px;
    padding: 40px;
  }
  .empty-card { padding: 40px; text-align: center; }
  .empty-text { color: #AAAAAA; font-size: 16px; font-weight: 500; }

  /* Card top row (모바일 개별 카드 전용) */
  .card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .checkbox-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .checkbox-btn.small { }
  .checkbox-svg { width: 20px; height: 20px; display: block; }
  .delete-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    opacity: 1;
    transition: opacity 0.2s;
  }
  .delete-btn:hover { opacity: 0.6; }

  /* ══ Product Row ══ */
  .product-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  .product-img {
    width: 150px;
    height: 150px;
    border-radius: 30px;
    overflow: hidden;
    background: #F2F2F8;
    flex-shrink: 0;
  }
  .product-img img { width: 100%; height: 100%; object-fit: cover; }
  .product-meta {
    flex: 1;
    min-width: 0;
    padding: 0 20px;
  }
  .product-name {
    font-size: 18px;
    font-weight: 700;
    color: #100B32;
    line-height: 1.6;
    letter-spacing: -0.3px;
    margin: 0 0 5px;
    word-break: break-word;
  }
  .product-price {
    font-size: 14px;
    font-weight: 700;
    color: #444444;
    line-height: 2;
    letter-spacing: -0.5px;
    margin: 0 0 5px;
  }
  .product-badges { display: flex; gap: 15px; align-items: center; }
  .badge-mem, .badge-deal { width: 40px; height: 40px; flex-shrink: 0; }
  .badge-svg { width: 40px; height: 40px; }
  /* ══ 옵션상품 하위 카드 — Figma(node 2447:12056) 기준: 본상품과 동일한 크기/폰트를 쓰고
     연결선(ㄴ)만으로 하위 관계를 표시. 12H/24H 이중가격·회원/특가 배지·수량 스테퍼는
     옵션상품에 해당 데이터·기능이 없어 제외(이름·수량·합계금액·썸네일만 정직하게 표시) */
  .option-subcard-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
  }
  .option-subcard {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    margin-left: 40px;
    padding: 16px 20px;
    background: var(--cs-lilac);
    border-radius: 30px;
    box-sizing: border-box;
  }
  .option-subcard-connector {
    position: absolute;
    left: -40px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }
  /* 본상품 .product-img와 동일 크기(150×150, radius 30px) */
  .option-subcard-img {
    width: 150px;
    height: 150px;
    border-radius: 30px;
    overflow: hidden;
    background: #EDEDF2;
    flex-shrink: 0;
  }
  .option-subcard-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .option-subcard-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* 본상품 .product-name과 동일 스타일 */
  .option-subcard-name {
    font-size: 18px;
    font-weight: 700;
    color: #100B32;
    line-height: 1.6;
    letter-spacing: -0.3px;
    margin: 0;
    word-break: break-word;
  }
  /* 본상품 .product-price와 동일 스타일 */
  .option-subcard-price {
    font-size: 14px;
    font-weight: 700;
    color: #444444;
    line-height: 1.6;
    letter-spacing: -0.5px;
    margin: 0;
  }
  /* 옵션상품 수량 조절 — 본상품 .qty-wrap과 동일 인터랙션 패턴(± 버튼) 축소 적용 */
  .option-subcard-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .opt-qty-ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .opt-qty-arrow {
    background: none;
    border: none;
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    color: var(--cs-text-dark, #444444);
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .opt-qty-arrow:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
  .opt-qty-arrow:disabled { opacity: 0.35; cursor: not-allowed; }
  .opt-qty-num {
    background: var(--cs-white, #fff);
    border-radius: 8px;
    padding: 2px 10px;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text, #100B32);
    min-width: 22px;
    text-align: center;
  }

  /* 컴팩트 버전 — ItemListCard(PC 목록행) 전용. 이 카드 자체가 이미 축소형(.item-thumb 90px)
     이므로 "본상품과 동일 크기" 기준을 이 카드의 실제 크기(90px)에 맞춰 적용 */
  .option-subcard-list--compact { gap: 10px; margin-top: 4px; }
  .option-subcard--compact {
    margin-left: 30px;
    padding: 10px 14px;
    gap: 14px;
    border-radius: 20px;
  }
  .option-subcard--compact .option-subcard-connector {
    left: -30px;
  }
  /* 본상품 .item-thumb-wrap과 동일 크기(90×90, radius var(--radius-md)) */
  .option-subcard--compact .option-subcard-img {
    width: 90px;
    height: 90px;
    border-radius: var(--radius-md, 15px);
  }
  /* 본상품 .item-name과 동일 스타일 */
  .option-subcard--compact .option-subcard-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .option-subcard--compact .option-subcard-price { font-size: 13px; font-weight: 600; color: var(--cs-text-mid); }
  .option-subcard--compact .opt-qty-arrow { width: 18px; height: 18px; font-size: 12px; }
  .option-subcard--compact .opt-qty-num { font-size: 11px; padding: 1px 8px; min-width: 18px; }

  /* ══ Duration Type Tabs ══ */
  .dur-tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin: 4px 0 2px;
  }
  .dur-tab {
    padding: 5px 11px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--cs-lilac);
    background: transparent;
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
    cursor: pointer;
    min-height: 30px;
    line-height: 1;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .dur-tab:hover:not(.dur-tab-active) {
    background: var(--cs-lilac);
    border-color: var(--cs-purple-pale, #d0c8f0);
  }
  .dur-tab-active {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
    color: white;
  }

  /* ══ Quantity Control ══ */
  .qty-wrap {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-shrink: 0;
  }
  .qty-label {
    font-size: 16px;
    font-weight: 700;
    color: #444444;
    letter-spacing: -0.5px;
  }
  .qty-ctrl {
    display: flex;
    align-items: center;
    gap: 30px;
    padding: 0 10px;
  }
  .qty-arrow {
    background: none;
    border: none;
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  .qty-arrow:hover { background: #F0F0F0; }
  .qty-num {
    background: #ECEBF4;
    border-radius: 10px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 700;
    color: #100B32;
    letter-spacing: -0.5px;
    line-height: 2;
    min-width: 44px;
    text-align: center;
  }
  /* PC ItemListCard 전용 축소 스케일(30% 작게) — 모바일 OrderCard의 기본 .qty-wrap 크기는 그대로 유지 */
  .qty-wrap--sm { gap: 10px; }
  .qty-wrap--sm .qty-ctrl { gap: 21px; padding: 0 7px; }
  .qty-wrap--sm .qty-arrow { width: 22px; height: 22px; }
  .qty-wrap--sm .qty-arrow svg { width: 6px; height: 10px; }
  .qty-wrap--sm .qty-num { padding: 7px 14px; font-size: 10px; min-width: 31px; }

  /* ══ Accordions ══ */
  .accordions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .acc-item { display: flex; flex-direction: column; }
  .acc-head {
    background: var(--cs-lilac);
    border: none;
    cursor: pointer;
    border-radius: var(--radius-lg, 20px);
    padding: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    transition: background 0.2s;
  }
  .acc-head:hover { background: #D9D6F0; }
  .acc-label {
    font-size: 18px;
    font-weight: 400;
    color: var(--cs-text-dark);
    letter-spacing: -0.3px;
    line-height: 1.6;
  }
  .acc-head-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .acc-value {
    font: var(--text-pc-title-18);
    color: var(--cs-text-dark);
  }
  .acc-body {
    padding-top: 30px;
    /* overflow는 지정하지 않음 — transition:slide가 애니메이션 중에만 자체적으로 clip 처리.
       여기서 overflow:hidden을 고정하면 달력/시간 팝업(.cal-layer/.time-layer, position:absolute)이
       아코디언 높이를 넘어서는 부분에서 배경까지 잘려 보이는 문제가 있었음. */
  }
  .rotate-180 { transform: rotate(180deg); }

  /* ══ Rental Form ══ */
  .rental-form {
    display: flex;
    flex-direction: column;
    gap: 40px;
    padding-bottom: 30px;
  }
  .form-section {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .form-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .form-section-label {
    font-size: 16px;
    font-weight: 500;
    color: #444444;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .form-section-body {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .form-check-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    white-space: nowrap;
  }
  .form-check-label-disabled {
    cursor: not-allowed;
    opacity: 0.35;
    filter: grayscale(1);
  }
  .form-check-label-disabled .checkbox-btn { cursor: not-allowed; }
  .form-check-label-disabled span { color: var(--cs-text-light, #AAAAAA); }
  .form-fields { display: flex; flex-direction: column; gap: 15px; }
  .form-note {
    font-size: 14px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 2;
    margin: 0;
  }
  .form-note-sm {
    font-size: 12px;
    font-weight: 500;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }
  .visit-info {
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-red);
    line-height: 2;
  }
  .visit-info p { margin: 0; }
  .copy-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    justify-content: center;
  }

  /* 5탭 배송 방식 선택기 */
  .delivery-combo {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .delivery-combo::-webkit-scrollbar { display: none; }
  .combo-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: var(--radius-xl, 30px);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .combo-btn:hover {
    border-color: var(--cs-purple, #3B2F8A);
    background: #F5F4FA;
  }
  .combo-btn-active {
    border-color: var(--cs-purple, #3B2F8A);
    background: var(--cs-purple, #3B2F8A);
  }
  .combo-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text, #100B32);
  }
  .combo-btn-active .combo-label { color: #fff; }
  .delivery-deadline {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    background: var(--cs-red-xlight);
    border-radius: var(--radius-full, 9999px);
    padding: 10px 16px;
    margin: 4px 0 0;
  }

  /* Datetime buttons */
  .datetime-btns {
    display: flex;
    width: 100%;
    border-radius: 20px;
    overflow: hidden;
  }
  .datetime-btn {
    flex: 1;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    transition: filter 0.2s;
  }
  .datetime-btn:hover { filter: brightness(1.1); }
  .datetime-btn-dark { background: #444; }
  .datetime-btn-mid { background: #666; }
  .datetime-btn-left {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .datetime-btn-label {
    color: white;
    font: var(--text-m-title-18B);
    letter-spacing: -0.5px;
    white-space: nowrap;
  }

  /* ══ Calendar + Time Layer ══ */
  .datetime-wrap { position: relative; display: flex; flex-direction: column; gap: 0; padding: 30px 0; }
  .cal-layer {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 100;
    background: white;
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    width: 50%;
    box-sizing: border-box;
  }

  /* ══ Time Layer ══ */
  .time-layer {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 100;
    background: white;
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    width: 50%;
    box-sizing: border-box;
  }
  .time-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .time-cell {
    background: #f6f6f6;
    border: none;
    border-radius: 10px;
    padding: 8px 4px;
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 500;
    color: #444;
    cursor: pointer;
    transition: background 0.15s;
    text-align: center;
  }
  .time-cell:hover { background: #ECEBF4; }
  .time-cell-sel { background: #3B2F8A !important; color: white !important; font-weight: 700; }

  /* Form inputs */
  .f-input {
    background: #F6F6F6;
    border: none;
    border-radius: 15px;
    padding: 10px 20px;
    width: 100%;
    font-size: 14px;
    font-weight: 500;
    color: #444;
    font-family: var(--font-kr);
    outline: none;
    box-sizing: border-box;
    min-height: 44px;
  }
  .f-input::placeholder { color: #B6B6B6; }
  .f-input:focus { outline: 2px solid #3B2F8A; outline-offset: -2px; }
  .f-row { display: flex; gap: 16px; align-items: center; }
  .f-grow { flex: 1; min-width: 0; width: auto; }
  .f-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    color: #444;
    white-space: nowrap;
    padding: 0;
    transition: color 0.2s;
  }
  .f-action-btn:hover { color: #3B2F8A; }

  /* ══ Coupon Row ══ */
  .coupon-list { display: flex; flex-direction: column; gap: 15px; }
  .coupon-row {
    background: #F6F6F6;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 20px;
    min-height: 52px;
  }
  .coupon-row-left { display: flex; align-items: center; gap: 20px; cursor: pointer; }
  .coupon-label { font-size: 14px; font-weight: 700; color: #444; }
  .coupon-expiry { font-size: 14px; font-weight: 700; color: #444; display: flex; align-items: center; gap: 10px; }
  .coupon-days { color: var(--cs-red-badge); }
  .hint-text { font-size: 12px; font-weight: 500; color: #AAAAAA; letter-spacing: -0.5px; line-height: 1.6; margin: 0; }

  /* ══ Price Detail ══ */
  .price-detail-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 20px;
  }
  .price-period-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .price-period-label {
    font-size: 16px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .price-period-values {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .period-val { display: flex; align-items: center; gap: 10px; }
  .period-num { font-size: 18px; font-weight: 700; color: #444; letter-spacing: -0.3px; }
  .period-unit { font-size: 16px; font-weight: 700; color: #AAAAAA; letter-spacing: -0.5px; }
  .price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .price-row-label {
    font-size: 14px;
    font-weight: 700;
    color: #AAAAAA;
    letter-spacing: -0.5px;
    line-height: 2;
  }
  .price-row-large { font-size: 16px; }
  .price-row-right { display: flex; align-items: center; gap: 15px; }
  .price-row-val { font-size: 16px; font-weight: 700; color: #444; line-height: 1.6; }
  .price-row-val-large { }
  .price-row-unit { font-size: 14px; font-weight: 700; color: #AAAAAA; line-height: 2; }
  .price-divider { background: #AAAAAA; height: 1px; width: 100%; margin: 5px 0; }
  .points-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #553FE0;
  }
  .points-label { font-size: 14px; font-weight: 700; line-height: 2; }
  .points-value { display: flex; align-items: center; gap: 15px; padding: 0 20px; }
  .points-num { font-size: 16px; font-weight: 700; line-height: 1.6; }
  .points-unit { font-size: 14px; font-weight: 700; line-height: 2; }

  /* ══ Order Total ══ */
  .total-details-box {
    border-radius: 30px;
    overflow: hidden;
    width: 100%;
  }
  .total-white-section {
    background: white;
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .total-gray-section {
    background: #F6F6F6;
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .section-sub-label {
    font-size: 16px;
    font-weight: 500;
    color: #444;
    letter-spacing: -0.5px;
  }

  .points-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }
  .points-input {
    flex: 1;
    height: 44px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    padding: 0 12px;
    font-size: 16px;
    font-weight: 500;
    color: var(--cs-text);
    background: white;
    outline: none;
    max-width: 180px;
  }
  .points-input:focus { border-color: var(--cs-purple); }
  .points-avail {
    font-size: 14px;
    color: #888;
    white-space: nowrap;
  }
  .points-avail strong { color: var(--cs-purple); }

  .total-dark-box {
    background: #100B32;
    border-radius: 30px;
    padding: 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-top: 0;
  }
  .total-dark-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .total-label {
    font-size: 16px;
    font-weight: 500;
    color: white;
    letter-spacing: -0.5px;
    line-height: 1.6;
    font-family: var(--font-kr);
  }
  .total-amount {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
  }
  .total-num { font-size: 18px; color: white; letter-spacing: -0.3px; }
  .total-unit { font-size: 14px; color: white; line-height: 2; }
  .total-points-row { }
  .total-points-label { font-size: 14px; font-weight: 700; color: #C1BBEC; line-height: 2; }
  .total-points-val {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 0 20px;
    font-size: 16px;
    font-weight: 700;
    color: #C1BBEC;
    line-height: 1.6;
  }

  /* 날짜 미선택 */
  .period-unset {
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-error, #D32F2F);
  }

  /* 보증금 별도 고지 (PRD.1.2.2.1.11) */
  .deposit-notice {
    background: var(--cs-white);
    border: 1.5px solid var(--cs-border, #e0e0e0);
    border-radius: var(--radius-lg);
    padding: 16px 24px;
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .deposit-notice-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .deposit-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text-dark);
  }
  .deposit-amount {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .deposit-num {
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .deposit-unit {
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text-dark);
  }
  .deposit-note {
    font-size: 11px;
    color: var(--cs-text-light, #888888);
    margin: 0;
    line-height: 1.5;
  }

  /* ══ Footer ══ */
  .footer-sentinel {
    height: 1px;
  }
  .cart-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 50;
    background: white;
    border-top: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 -4px 20px rgba(16,11,50,0.1);
    padding-bottom: env(safe-area-inset-bottom);
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .cart-footer.footer-visible {
    transform: translateY(0);
  }
  .footer-inner {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 50px;
    padding: 20px 40px;
  }
  .footer-terms {
    display: flex;
    align-items: center;
    gap: 15px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .footer-terms-text {
    font-size: 16px;
    font-weight: 700;
    color: #444;
    line-height: 2;
    white-space: nowrap;
  }
  .footer-cta {
    flex: 1;
    height: 60px;
    border: none;
    border-radius: 30px;
    font-size: 16px;
    font-weight: 700;
    font-family: var(--font-kr);
    cursor: pointer;
    transition: all 0.3s;
    color: white;
  }
  .footer-cta-active {
    background: #3B2F8A;
    box-shadow: 0 4px 15px rgba(59,47,138,0.3);
  }
  .footer-cta-active:hover { background: #4A3BA8; }
  .footer-cta-active:active { transform: scale(0.98); }
  .footer-cta-disabled {
    background: #CCCCCC;
    cursor: not-allowed;
  }
  /* ══ Responsive ══ */
  @media (max-width: 1024px) {
    .cart-content { padding: 0 var(--layout-tab-pad); }
    .sub-gnb-b-inner {
      padding: 16px var(--layout-tab-pad);
      gap: 20px;
      justify-content: space-between;
    }
    .sub-gnb-b-pill {
      flex: 1 1 auto;
      max-width: none;
      padding: 14px 28px;
      min-height: 56px;
    }
    .footer-inner { padding: 20px 32px; gap: 30px; }
  }

  @media (max-width: 640px) {
    .sub-gnb-b-inner {
      padding: 12px var(--layout-mob-pad);
      gap: 12px;
      flex-direction: column;
      align-items: stretch;
    }
    .sub-gnb-b-pill {
      flex: 1 1 auto;
      max-width: none;
      width: 100%;
      padding: 12px var(--layout-mob-pad);
      min-height: 48px;
      border-radius: var(--radius-lg);
    }
    .sub-gnb-b-pill-left { gap: 6px; }
    .sub-gnb-b-arrow { width: 18px; height: 15px; }
    .sub-gnb-b-back { font: var(--text-m-body-16B); }
    .sub-gnb-b-title { font: var(--text-m-title-18B); font-family: var(--font-en-display); font-weight: 400; }
    .cart-main { padding: 30px 0; }
    .cart-content { padding: 0 12px; gap: 30px; }
    .sec-header { padding: 16px 20px; }
    .sec-title { font-size: 18px; }
    .order-card { border-radius: 40px; }
    .order-card-inner { padding: 20px; gap: 30px; }
    .product-img { width: 120px; height: 120px; border-radius: 24px; }
    .product-name { font-size: 14px; }
    .product-price { font-size: 12px; }
    .option-subcard-img { width: 120px; height: 120px; border-radius: 24px; }
    .option-subcard-name { font-size: 14px; }
    .option-subcard-price { font-size: 12px; }
    .badge-mem, .badge-deal, .badge-svg { width: 30px; height: 30px; }
    .qty-label { font-size: 14px; }
    .qty-ctrl { gap: 16px; }
    .qty-num { padding: 6px 14px; font-size: 13px; }
    .acc-head { padding: 16px 20px; border-radius: 20px; }
    .acc-label { font-size: 15px; }
    .acc-value { font-size: 14px; }
    .acc-body { padding-top: 20px; }
    .datetime-btn { padding: 12px 16px; }
    .datetime-btn-label { font: var(--text-m-body-16B); letter-spacing: -0.5px; }
    .total-white-section, .total-gray-section { padding: 20px; }
    .total-dark-box { padding: 16px 20px; border-radius: 20px; }
    .total-label { font-size: 14px; }
    .total-num { font-size: 18px; }
    .cart-footer { padding-bottom: max(14px, env(safe-area-inset-bottom)); }
    .footer-inner { padding: 16px 16px 14px; gap: 16px; flex-direction: column; align-items: stretch; }
    .footer-terms { flex-shrink: 1; }
    .footer-terms-text { font-size: 13px; white-space: normal; }
    .footer-cta { flex: none; width: 100%; height: 56px; font-size: 15px; }
    .price-detail-list { padding: 0 10px; }
    /* 모바일 letter-spacing (m-body_com_16b: -0.5px, m-titie_com_18b: -0.3px) */
    .product-name { letter-spacing: -0.3px; }
    .form-section-label { letter-spacing: -0.5px; }
    .form-check-label { letter-spacing: -0.5px; }
    .coupon-label { letter-spacing: -0.5px; }
    .coupon-expiry { letter-spacing: -0.5px; }
    .price-row-label { letter-spacing: -0.5px; }
    .price-row-val { letter-spacing: -0.5px; }
    .combo-btn { padding: 8px 12px; }
    .combo-label { font-size: 12px; }
    .f-input { letter-spacing: -0.5px; }
    .copy-label { letter-spacing: -0.5px; }
    .acc-label { letter-spacing: -0.3px; }
    .sub-gnb-b-pill { padding: 12px 20px; border-radius: 18px; min-height: 44px; }
  }

  /* ── Pending reservation banner */
  /* ── 전체 일괄 설정 배너 ── */
  /* ── bulk-panel: 화이트 카드 (front-uiux §16 준수) ── */
  .bulk-panel {
    background: #fff;
    border-radius: var(--radius-2xl, 20px);
    margin-bottom: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  /* PC에서는 detail-pane이 동일 역할 — bulk-panel 중복 노출 방지 */
  @media (min-width: 641px) {
    .bulk-panel { display: none; }
  }
  .bulk-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 30px 20px 16px;
    background: none;
    border: none;
    cursor: pointer;
    min-height: 54px;
  }
  .bulk-lock { color: var(--cs-purple, #3B2F8A); flex-shrink: 0; }
  .bulk-head-title {
    font: var(--text-m-script-14B);
    color: var(--cs-purple, #3B2F8A);
    flex: 1;
    text-align: left;
  }
  .bulk-chevron {
    color: var(--cs-text-dark, #444);
    flex-shrink: 0;
    transition: transform 0.3s;
  }
  .bulk-body {
    padding: 16px 20px 30px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-top: 1px solid var(--cs-lilac, #ECEBF4);
  }

</style>
