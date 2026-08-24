<script lang="ts">
  import { untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { slide, fly } from 'svelte/transition';
  import type { PageData } from './$types';
  import SubGnb from '$lib/components/common/SubGnb.svelte';
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte';
  import { supabase } from '$lib/services/supabase';
  import { csToast } from '$lib/utils/toast';
  import { isLockerHour } from '$lib/utils/lockerTimeRange';

  function readInputValue(event: { currentTarget: { value: string } }): string {
    return event.currentTarget.value;
  }

  interface Props { data: PageData }
  let { data }: Props = $props();

  // ── Types
  // 5탭 배송 방식 (PRD.1.2.2 Zone2 기준) — ShipmentMethodEnum 정합
  // 'delivery'(택배)는 CMS 대여방식 옵션(METHOD_KEYS)엔 있었으나 이 유니언에 누락돼 있던
  // 기존 enum 드리프트 — 2026-08-24 "배송 옵션 시스템" 기능의 전제조건으로 함께 수정
  type DeliveryMethod = 'crazydelivery' | 'quick' | 'locker' | 'visit' | 'epost' | 'delivery';
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
  const KNOWN_DELIVERY_METHODS: DeliveryMethod[] = ['crazydelivery', 'quick', 'locker', 'visit', 'epost', 'delivery'];

  // "배송" 그룹(요청 A/B 공통 판정 기준) — CMS "/cms/set/rental > 배송 설정 > 배송대여
  // 수령/반납 일괄 지정" 콤보에서 관리자가 직접 토글한 방식만 해당(2026-08-24부터 하드코딩
  // 대신 데이터 기반 판정 — sdDeliveryOpts는 이 파일 하단에서 선언되지만 이 함수는 렌더
  // 시점에만 호출되므로 참조 가능).
  function isDeliveryLocked(m: DeliveryMethod): boolean {
    return sdDeliveryOpts.some(o => o.method_key === m && o.is_bulk_delivery);
  }

  function addDays(iso: string, n: number): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function toDeliveryMethod(v: string | null, fallback: DeliveryMethod): DeliveryMethod {
    return v && (KNOWN_DELIVERY_METHODS as string[]).includes(v) ? (v as DeliveryMethod) : fallback;
  }
  function toDurationType(v: string | null): DurationType {
    return v === '12h' ? '12h' : '24h';
  }

  function defaultForm(): FormState {
    return { name: '', email: '', phone: '', addr: '', addrDetail: '', notes: '', memberCheck: false, memberCheck2: false };
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
  let bulkDate    = $state('')  // 수령일
  let bulkTime    = $state('')  // 수령시간
  // 반납일자는 수령일자와 별도로 선택 가능해야 함(2026-08-17 확정) — 이전엔 bulkDate/bulkTime을
  // 수령·반납 양쪽이 공유해 반납일을 수령일과 다르게 지정하는 것 자체가 불가능했던 결함 수정
  let bulkReturnDate = $state('')
  let bulkReturnTime = $state('')
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

  // 시간선택 노출 범위 — 24시간 전체로 확대(2026-08-20, Stephen 확정).
  // 09:00~22:00=방문배송 정상영업시간 / 23:00~08:00=영업외시간(방문대여 선택 시 무인보관함
  // 인계로 부분 반영 — isLockerHour()는 $lib/utils/lockerTimeRange 공유 유틸(CMS와 동일 로직
  // 재사용, 드리프트 방지). pickup_method/return_method DB 값은 그대로 'visit' 유지.
  const TIME_AM_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const TIME_PM_HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

  // ── 통합설정용 핸들러 (bulkOpts/bulkRentalForm/bulkReturnForm 대상 — 개별 아이템 편집 UI는
  // 통합 단일 정책 전환(2026-08-05)으로 제거되어 item 단위 핸들러는 더 이상 필요 없음)
  // 2026-07-28: 버튼("전체 적용") 클릭 없이 입력 즉시 전체 상품 카드에 반영 — 각 핸들러 끝에
  // applyBulkToItems() 호출
  function bulkHandleMethod(v: DeliveryMethod) {
    // 배송(delivery/crazydelivery) 선택 시 반납방식 강제 고정(요청 A, Stephen 확정) —
    // copyToReturn 사용자 선택과 무관하게 항상 동일 방식으로 동기화
    const forceCopy = isDeliveryLocked(v)
    bulkOpts = {
      ...bulkOpts,
      rentalMethod: v,
      ...(forceCopy || bulkOpts.copyToReturn ? { returnMethod: v } : {}),
      ...(forceCopy ? { copyToReturn: true } : {}),
    }
    applyBulkToItems()
  }
  function bulkHandleReturnMethod(v: DeliveryMethod) {
    // 수령방식이 배송으로 잠긴 상태에서는 반납방식 독립 변경 차단(요청 A)
    if (isDeliveryLocked(bulkOpts.rentalMethod)) return
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
    // 배송 잠금 상태에서는 강제 체크 고정 — 해제 시도 무시(요청 A)
    if (!v && isDeliveryLocked(bulkOpts.rentalMethod)) return
    if (v) {
      bulkOpts = { ...bulkOpts, copyToReturn: true, returnMethod: bulkOpts.rentalMethod }
      bulkReturnForm = { ...bulkRentalForm }
    } else {
      bulkOpts = { ...bulkOpts, copyToReturn: false }
    }
    applyBulkToItems()
  }
  // 수령일 달력 하나에서 대여일+반납일을 이어서 선택하는 2클릭 범위선택(2026-08-17,
  // Stephen 확정) — 아코디언을 옮겨다닐 필요 없이 이 달력 안에서 전 과정이 끝남
  //   1클릭(시작 없음, 또는 이미 완성된 범위를 다시 고르는 경우) → 시작일 지정, 달력 유지(열림)
  //   2클릭(시작만 있고 종료 대기 중) → 시작일 이후 날짜면 종료일로 확정, 달력 닫힘
  //                                     시작일 이전 날짜면 시작일을 그 날짜로 교체(다시 대기)
  function bulkHandleDate(d: string) {
    if (bulkDate && !bulkReturnDate) {
      if (d >= bulkDate) {
        bulkReturnDate = d
        applyBulkToItems()
        openCalId = null
      } else {
        bulkDate = d
        applyBulkToItems()
      }
    } else {
      bulkDate = d
      bulkReturnDate = ''
      applyBulkToItems()
    }
  }
  function bulkHandleTime(t: string) {
    bulkTime = t
    applyBulkToItems()
  }
  function bulkHandleReturnDate(d: string) {
    bulkReturnDate = d
    applyBulkToItems()
    openCalId = null
  }
  function bulkHandleReturnTime(t: string) {
    bulkReturnTime = t
    applyBulkToItems()
  }

  // 통합 입력값이 비어있으면(사용자가 손대지 않은 필드) 기존 개별 값 유지 — 덮어써서 날리지 않도록 방어
  function mergeFormForBulk(bulkForm: FormState, itemForm: FormState): FormState {
    return {
      name: bulkForm.name || itemForm.name,
      email: bulkForm.email || itemForm.email,
      phone: bulkForm.phone || itemForm.phone,
      addr: bulkForm.addr || itemForm.addr,
      addrDetail: bulkForm.addrDetail || itemForm.addrDetail,
      notes: bulkForm.notes || itemForm.notes,
      memberCheck: bulkForm.memberCheck || itemForm.memberCheck,
      memberCheck2: bulkForm.memberCheck2 || itemForm.memberCheck2,
    }
  }

  // 통합설정 필드 변경 즉시(버튼 없이) 전체 상품 카드에 반영 — 카드별 기존 설정값은 무시되고
  // bulkOpts/bulkDate·bulkTime(수령)/bulkReturnDate·bulkReturnTime(반납)/bulkRentalForm/
  // bulkReturnForm 값으로 전부 덮어씀
  function applyBulkToItems() {
    itemsState = itemsState.map(it => ({
      ...it,
      rentalDate: bulkDate || it.rentalDate,
      // bulkDate를 한 번이라도 만졌다면 returnDate는 bulkReturnDate를 그대로 반영(범위선택
      // 재시작으로 일시적으로 비어도 옛 반납일이 남아있지 않도록) — 아직 bulkDate 자체를
      // 안 만진 경우에만 기존 개별 값 유지
      returnDate: bulkDate ? bulkReturnDate : (bulkReturnDate || it.returnDate),
      rentalTime: bulkTime || it.rentalTime,
      returnTime: bulkReturnTime || it.returnTime,
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

  // 대여일시 통합 요약(요일 포함) — 날짜+시간이 모두 선택되면 한눈에 재확인할 수 있도록 노출
  const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
  function weekdayKr(iso: string): string {
    if (!iso) return '';
    return WEEKDAY_KR[new Date(`${iso}T00:00:00`).getDay()];
  }

  // ── 서버 데이터 추출 (PageData는 +page.ts 기준이므로 server 필드는 캐스트 필요)
  // datesSet 등 canProceed 조건이 라인아이템 목록을 참조하므로 Footer 섹션보다 앞에 선언
  type ProductRow = { id: string; name: string; category: string; brand: string | null; slug: string; image_urls: string[]; is_active: boolean }
  type UserCouponExt = { id: string; coupon_id: string; coupons: { id: string; code: string; discount_type: string; discount_value: number; description: string | null; valid_until: string } | null }
  type PriceRuleExt = { price12h: number | null; price24h: number | null; deposit: number | null }
  type CartLineItemOption = { optionProductId: string | null; name: string; qty: number; unitPrice: number; imageUrl: string | null }
  type CartLineItem = { reservationId: string; productId: string | null; product: ProductRow | null; price12h: number | null; price24h: number | null; deposit: number | null; startDate: string; endDate: string; pickupMethod: string | null; returnMethod: string | null; pickupTime: string | null; returnTime: string | null; durationType: string | null; options: CartLineItemOption[]; status: string }
  type ServerExt = { calcTotal: number; calcDiscount: number; calcFinal: number; depositTotal: number; membershipGrade: string | null; userPoints: number; userCoupons: UserCouponExt[]; cartLineItems: CartLineItem[]; productPriceRules: Record<string, PriceRuleExt>; hasUserAddress: boolean; rentalGuideText: string }
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
  let showGuideModal = $state(false);
  let isConfirming = $state(false);
  let footerVisible = $state(false);
  let footerSentinel = $state<HTMLDivElement | null>(null);

  // 조건 1: 결제 확정 대상(체크 해제·삭제되지 않은 상품)이 1개 이상
  const hasItems = $derived(itemsState.some(it => !it.deleted && it.checked))

  // 조건 2: 결제 확정 대상 상품의 날짜·시간(수령일·수령시간·반납일·반납시간) 모두 입력됨
  // (체크 해제한 상품은 제외) — 2026-08-19 재검수: 기존엔 날짜만 검증해 시간을 한 번도
  // 선택하지 않아도(빈 문자열 → 하위 로직에서 '00:00'으로 암묵 대체) 제출이 가능했던 결함 수정
  const datesSet = $derived(
    itemsState.every(it => it.deleted || !it.checked || (
      it.rentalDate !== '' && it.rentalTime !== '' && it.returnDate !== '' && it.returnTime !== ''
    ))
  )

  // 조건 3: 배송 마감 미초과 (TASK-D: check_delivery_deadline() 연동 후 대체)
  const deadlineOk = $derived(true)

  // 조건 4: 신원 확인 완료 — 2026-08-18 정책 변경: 장바구니는 가입 완료 계정만 접근
  // 가능(+page.server.ts에서 비회원·익명세션은 이미 /auth/login으로 리다이렉트됨) —
  // 게스트 OTP 인증 경로는 삭제, data.userId는 항상 존재하나 방어적으로 그대로 체크
  // data.userId는 +page.server.ts 반환값 (PageData 병합 — dev server 기동 시 $types 자동 재생성)
  const identityOk = $derived(data.userId != null)

  // 조건 5: 약관 동의
  // canProceed: 5가지 조건 모두 충족
  const canProceed = $derived(hasItems && datesSet && deadlineOk && identityOk && agreed)

  // 완료 버튼 문구 — 2026-08-18: 장바구니 접근이 회원 전용으로 고정되어 비회원 분기 제거
  const confirmLabel = '예약신청완료'

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
    delivery:      '택배',
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
  const sdDeliveryOpts = $derived((data.deliveryOptions as Array<{ method_key: string; name: string; fee_amount: number; is_free_for_top_grade: boolean; is_bulk_delivery: boolean }> | undefined) ?? [])
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

  // 택배 휴무일 캘린더 제어(2026-08-24) — 마스터 토글 OFF면 서버가 이미 빈 배열을 내려줌
  const courierClosedSet = $derived(new Set<string>((data.courierClosedDates as string[] | undefined) ?? []))

  // 방문대여 지점 — 카트 상품의 allowed_pickup_ids 기준으로 pickup_points 필터링(deliveryTabs와 동일 원칙)
  interface PickupPointRow { id: string; name: string; address: string; phone: string | null }

  function computeAllowedPickupIds(prods: ProductRow[]): Set<string> | 'all' | 'none' {
    type P = ProductRow & { allowed_pickup_ids?: string[] | null }
    const configured = prods.filter(p => Array.isArray((p as P).allowed_pickup_ids))
    if (configured.length === 0) return 'all'
    const sets = configured.map(p => (p as P).allowed_pickup_ids as string[])
    const intersection = sets.reduce((acc, ids) => {
      const s = new Set(ids)
      return acc.filter(id => s.has(id))
    }, [...sets[0]])
    return intersection.length > 0 ? new Set<string>(intersection) : 'none'
  }

  const allowedPickupIds = $derived(computeAllowedPickupIds(cartProductRows))
  const visitPickupPoints = $derived<PickupPointRow[]>(
    allowedPickupIds === 'none' ? [] :
    ((data.pickupPoints as PickupPointRow[] | undefined) ?? [])
      .filter((p: PickupPointRow) => allowedPickupIds === 'all' || allowedPickupIds.has(p.id))
  )

  // 서버 데이터 안전 추출
  const sdCoupons = $derived<UserCouponExt[]>((sd as { userCoupons?: UserCouponExt[] }).userCoupons ?? [])
  const sdUserPoints = $derived<number>((sd as { userPoints?: number }).userPoints ?? 0)
  // "회원정보 반영"(배송지) 체크박스 활성화 조건 — 저장된 배송지 주소가 있을 때만 사용 가능
  const sdHasUserAddress = $derived<boolean>((sd as { hasUserAddress?: boolean }).hasUserAddress ?? false)
  // "회원정보 반영" 체크박스 자동채움 원본 데이터(+page.server.ts 제공)
  type UserProfileInfo = { name: string | null; phone: string | null; email: string | null } | null
  type UserAddressInfo = { road_address: string | null; detail_address: string | null } | null
  const sdUserProfileInfo = $derived<UserProfileInfo>((sd as { userProfileInfo?: UserProfileInfo }).userProfileInfo ?? null)
  const sdUserAddressInfo = $derived<UserAddressInfo>((sd as { userAddressInfo?: UserAddressInfo }).userAddressInfo ?? null)
  // "회원정보 반영"(고객정보) 체크박스 활성화 조건 — 배송지 체크박스(sdHasUserAddress)와 동일
  // 원칙: 반영할 실 정보값(이름 또는 휴대폰)이 있을 때만 사용 가능. email은 user_profiles에
  // NOT NULL이라 항상 값이 있어 판단 기준에서 제외(있으나마나 늘 true라 무의미)
  const sdHasUserProfileInfo = $derived<boolean>(!!(sdUserProfileInfo?.name || sdUserProfileInfo?.phone))

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

  // 2026-08-19(정합성 재검수): 포인트 입력 후 쿠폰을 추가/변경하거나 상품·기간을 바꿔
  // otMaxPoints가 줄어들면(예: 쿠폰 적용으로 결제 잔액이 포인트 입력값보다 작아짐) 기존엔
  // otPointsUsed가 갱신되지 않고 그대로 남아, 화면엔 0원으로 정상 표시되면서도 제출 시점엔
  // 실제 필요한 것보다 많은 포인트가 서버로 전송돼(confirm-mock → use_points) 초과 차감될
  // 수 있었음 — otMaxPoints가 줄어들 때마다 자동으로 재클램프
  $effect(() => {
    if (otPointsUsed > otMaxPoints) otPointsUsed = otMaxPoints
  })

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

  // 쿠폰 만료까지 남은 일수 (CouponRow "N일 뒤 소멸" 표기용)
  function daysUntilExpiry(validUntil: string): number {
    if (!validUntil) return 0
    const diff = new Date(validUntil).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / 86400000))
  }

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
              <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true">
                <path d="M7.99919 20C5.88901 20 4.0824 19.2485 2.75115 17.874C1.52311 16.6061 0.785015 14.8992 0.495286 12.9902L0.443529 12.6055L0.440599 12.584L0.438646 12.5615L0.00602908 7.70508C-0.0675772 6.87997 0.5413 6.15083 1.36638 6.07715C2.19153 6.00354 2.9207 6.61332 2.99431 7.43848L3.42302 12.251L3.46208 12.543C3.67975 13.9768 4.20499 15.0629 4.90642 15.7871C5.63327 16.5374 6.64321 17 7.99919 17L13.1984 17C14.5546 17 15.5653 16.5376 16.2922 15.7871C17.0369 15.0182 17.5833 13.8414 17.7736 12.2734L18.2043 7.43848C18.2779 6.61349 19.0063 6.00382 19.8312 6.07715C20.6564 6.15076 21.2662 6.87993 21.1926 7.70508L20.759 12.5615L20.757 12.584L20.7551 12.6055C20.5096 14.6694 19.7564 16.5215 18.4465 17.874C17.1152 19.2484 15.3085 20 13.1984 20L7.99919 20Z" fill="#201857"/>
                <path d="M12.5653 7.5V5.08496C12.5653 4.27678 12.2702 3.79435 11.9296 3.49609C11.5533 3.16675 11.0458 3.0001 10.5995 3C10.1532 3 9.64579 3.16678 9.2694 3.49609C8.92865 3.79434 8.63271 4.2766 8.63269 5.08496V7.5C8.63269 8.32843 7.96111 9 7.13269 9C6.30426 9 5.63269 8.32843 5.63269 7.5V5.08496C5.63271 3.4263 6.2903 2.11575 7.29284 1.23828C8.25978 0.39198 9.48643 0 10.5995 0C11.7124 9.12656e-05 12.9383 0.392127 13.9051 1.23828C14.9077 2.11575 15.5653 3.42629 15.5653 5.08496V7.5C15.5653 8.32843 14.8937 9 14.0653 9C13.2887 8.9999 12.6499 8.40969 12.5731 7.65332L12.5653 7.5Z" fill="#CF0000"/>
              </svg>
              <p class="empty-text">대여예약 중인 상품이 없습니다.</p>
            </div>
          {/if}
        </div>

        <!-- PC 전용(≥641px) 마스터-디테일 레이아웃: 상품목록(좌) / 대여옵션 DetailPanel(우) — CMS /cms/products 구조 동일 적용 -->
        <div class="master-detail">
          <!-- 카드 목록 패널 -->
          <div class="list-pane" class:narrow={hasItems}>
            {#if itemsState.length === 0 || itemsState.every(it => it.deleted)}
              <div class="order-card empty-card">
                <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true">
                  <path d="M7.99919 20C5.88901 20 4.0824 19.2485 2.75115 17.874C1.52311 16.6061 0.785015 14.8992 0.495286 12.9902L0.443529 12.6055L0.440599 12.584L0.438646 12.5615L0.00602908 7.70508C-0.0675772 6.87997 0.5413 6.15083 1.36638 6.07715C2.19153 6.00354 2.9207 6.61332 2.99431 7.43848L3.42302 12.251L3.46208 12.543C3.67975 13.9768 4.20499 15.0629 4.90642 15.7871C5.63327 16.5374 6.64321 17 7.99919 17L13.1984 17C14.5546 17 15.5653 16.5376 16.2922 15.7871C17.0369 15.0182 17.5833 13.8414 17.7736 12.2734L18.2043 7.43848C18.2779 6.61349 19.0063 6.00382 19.8312 6.07715C20.6564 6.15076 21.2662 6.87993 21.1926 7.70508L20.759 12.5615L20.757 12.584L20.7551 12.6055C20.5096 14.6694 19.7564 16.5215 18.4465 17.874C17.1152 19.2484 15.3085 20 13.1984 20L7.99919 20Z" fill="#201857"/>
                  <path d="M12.5653 7.5V5.08496C12.5653 4.27678 12.2702 3.79435 11.9296 3.49609C11.5533 3.16675 11.0458 3.0001 10.5995 3C10.1532 3 9.64579 3.16678 9.2694 3.49609C8.92865 3.79434 8.63271 4.2766 8.63269 5.08496V7.5C8.63269 8.32843 7.96111 9 7.13269 9C6.30426 9 5.63269 8.32843 5.63269 7.5V5.08496C5.63271 3.4263 6.2903 2.11575 7.29284 1.23828C8.25978 0.39198 9.48643 0 10.5995 0C11.7124 9.12656e-05 12.9383 0.392127 13.9051 1.23828C14.9077 2.11575 15.5653 3.42629 15.5653 5.08496V7.5C15.5653 8.32843 14.8937 9 14.0653 9C13.2887 8.9999 12.6499 8.40969 12.5731 7.65332L12.5653 7.5Z" fill="#CF0000"/>
                </svg>
                <p class="empty-text">대여예약 중인 상품이 없습니다.</p>
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
            <button class="bulk-head" class:bulk-head-closed={!bulkOpen} onclick={() => bulkOpen = !bulkOpen}>
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
          <!-- 2026-08-24(Stephen 재확정): "장바구니에서 모든 설정과 대여 금액 정보까지 먼저
               보여주는 UX가 정합" — 쿠폰/포인트 선택 UI를 장바구니에 복원. 실제 소진(use_coupon/
               use_points)은 여전히 3단계(/contract/[token], pay-mock)에서만 일어나고, 여기서
               고른 값은 체크아웃 제출 시 orders.selected_coupon_id/selected_points(Migration
               340)로 저장돼 계약서명 페이지 진입 시 자동으로 미리 선택된다. -->
          {#if sdCoupons.length > 0}
            <div class="coupon-section">
              <span class="section-sub-label">사용 가능한 쿠폰</span>
              {#each sdCoupons.filter(uc => uc.coupons !== null) as uc (uc.id)}
                {@const c = uc.coupons!}
                {@const couponLabel = c.description ?? (c.discount_type === 'fixed' ? `${c.discount_value.toLocaleString('ko-KR')}원 할인` : `${c.discount_value}% 할인`)}
                {@render CouponRow({
                  label: couponLabel,
                  days: daysUntilExpiry(c.valid_until),
                  checked: otSelectedCouponIds.has(uc.id),
                  onToggle: () => {
                    // 중복 쿠폰 적용 불가 — 단일 선택만 허용(계약서명 페이지와 동일 정책)
                    otSelectedCouponIds = otSelectedCouponIds.has(uc.id) ? new Set() : new Set([uc.id])
                  },
                })}
              {/each}
            </div>
          {/if}

          <div class="points-select-section">
            <span class="section-sub-label">포인트 사용 (보유 {fmtKrw(sdUserPoints)}p)</span>
            <div class="points-input-row">
              <input
                type="number"
                class="f-input points-input"
                min="0"
                max={otMaxPoints}
                value={otPointsUsed}
                oninput={(e) => {
                  const v = Math.min(otMaxPoints, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                  otPointsUsed = v
                }}
              />
              <button
                type="button"
                class="points-all-btn"
                disabled={otMaxPoints === 0}
                onclick={() => { otPointsUsed = otMaxPoints }}
              >모두 사용</button>
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
        <button class="checkbox-btn checkbox-btn-terms" onclick={() => agreed = !agreed} aria-label="동의">
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none" class="checkbox-terms-icon">
            <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill={agreed ? 'var(--cs-purple)' : 'var(--cs-purple-op10)'}/>
          </svg>
        </button>
        <span class="footer-terms-text" style:color={agreed ? 'var(--cs-purple)' : 'var(--cs-purple-op10)'}>등록한 대여조건 및 <button type="button" class="terms-guide-link" onclick={() => (showGuideModal = true)}>이용안내</button>에 모두 동의합니다.</span>
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

            // draft 항목(날짜 없는 임시예약)을 먼저 승격(promote_draft_reservation) — 모두 성공한 뒤 주문연결 진행
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
            // 신청(hold) 시점 주문(orders/order_items) 연결 — CMS "대여정보" 탭 통합 표시 기반
            // 마련(TASK.md 2026-08-17). 이번 제출에 포함된 전체 id(방금 승격된 것 + 이미 hold였던
            // 체크 항목) 기준. 표시 편의 기능이라 실패해도 예약/체크아웃 흐름을 막지 않는다.
            // 2026-08-24: 장바구니에서 고른 쿠폰/포인트도 함께 저장(Migration 340,
            // orders.selected_coupon_id/selected_points) — 계약서명 페이지(/contract/[token])
            // 진입 시 이 값을 다시 읽어 자동으로 미리 선택된 상태로 보여준다.
            const selectedCouponId = otSelectedCouponIds.size > 0 ? [...otSelectedCouponIds][0] : null
            const createOrderRes = await fetch('/api/reservations/create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reservationIds: checkedIds, couponId: selectedCouponId, points: otPointsUsed }),
            }).catch((e) => { console.error('[cart] create-order 실패:', e); return null })

            // 2026-08-21(TASK.md "예약 결제·계약서명 순서 재설계" Phase B): 결제(mock) 트리거를
            // 이 시점(1단계 체크아웃)에서 완전히 제거했다 — GATE B 승인(Q1~Q6)에 따라 결제(mock)
            // 는 계약서명 완료 시점(3단계, /api/contracts/[token]/pay-mock)으로 이동했다(Phase C).
            // 1단계 완료 시점에는 payment_confirmed_at이 항상 NULL로 남고 status는 hold 그대로
            // 유지된다 — 여기서는 "예약신청 완료"만 안내하고 confirm-mock을 호출하지 않는다.
            if (!createOrderRes) {
              csToast.error('예약 처리 중 오류가 발생했습니다.')
              return
            }
            const nowDt = new Date()
            const padN = (n: number) => String(n).padStart(2, '0')
            const confirmedAt = `${nowDt.getFullYear()}.${padN(nowDt.getMonth()+1)}.${padN(nowDt.getDate())}·${padN(nowDt.getHours())}:${padN(nowDt.getMinutes())}`
            const activeItems = itemsState
              .filter(it => !it.deleted && it.checked)
              .map((it) => {
                const line = effectiveLineItems.find(l => l.reservationId === it.id)
                return {
                  name: line?.product?.name ?? '촬영 장비',
                  code: '',
                  startDate: it.rentalDate,
                  endDate: it.returnDate,
                  pickupMethod: DELIVERY_LABELS[it.opts.rentalMethod] ?? it.opts.rentalMethod,
                  returnMethod: DELIVERY_LABELS[it.opts.returnMethod] ?? it.opts.returnMethod,
                  price: itemCardRate(line, it.durType) * Math.max(it.qty, 1),
                  options: (line?.options ?? []).map(o => ({ name: o.name, qty: o.qty })),
                }
              })
            // 신청완료 화면(/payment/success/dev)은 이제 "결제완료"가 아니라 "예약신청 완료"
            // 안내로 통일 사용 — 쿠폰/포인트는 3단계로 이동해 이 시점엔 항상 미적용(0)이므로
            // couponDiscount/pointsUsed/paymentMethod 파라미터는 더 이상 보내지 않는다.
            const params = new URLSearchParams({
              items:              JSON.stringify(activeItems),
              amount:             String(otTotal),
              subtotal:           String(otSubtotal),
              membershipDiscount: String(otMembershipDiscount),
              deliveryFee:        String(otDeliveryFee),
              vat:                String(otVat),
              confirmedAt,
            })
            await goto(`/payment/success/dev?${params.toString()}`)
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

  <!-- 이용안내 모달 — footer(transform 적용 조상) 밖에 형제로 배치(ui-mobile.md
       "CSS transform + position:fixed 충돌" 원칙 — transform 조상 안에 두면 뷰포트
       기준 배치가 깨짐) -->
  {#if showGuideModal}
    <div class="guide-modal-overlay" role="dialog" aria-modal="true" aria-label="대여·예약 이용안내" onclick={() => (showGuideModal = false)}>
      <div class="guide-modal" onclick={(e) => e.stopPropagation()}>
        <div class="guide-modal-header">
          <span class="guide-modal-title">대여·예약 이용안내</span>
          <button type="button" class="guide-modal-close" onclick={() => (showGuideModal = false)} aria-label="닫기">✕</button>
        </div>
        <div class="guide-modal-body">
          {#if sd.rentalGuideText}
            <p class="guide-modal-text">{sd.rentalGuideText}</p>
          {:else}
            <p class="guide-modal-empty">등록된 이용안내가 없습니다.</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

</div>

<!-- ═══════════════════════ SNIPPET COMPONENTS ═══════════════════════ -->

{#snippet OrderCard(item: CartItemUiState, line: CartLineItem | undefined)}
  {#if !item.deleted}
    {@const rate24 = itemRate24h(line)}
    {@const rate12 = itemRate12h(line, rate24)}
    <div class="order-card" class:selected={item.checked}>
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
          <div class="product-info-group">
          <div class="product-meta">
            <p class="product-name">{line?.product?.name ?? '상품'}</p>
            <!-- 2026-08-18: 비활성 상태로 숨김(삭제 아님) — 개별 상품카드에서 대여기간
                 변경 시 장바구니 합계·체크아웃 금액(itemCardRate)에 영향을 주는 기능이나,
                 현재 "대여예약옵션" 통합 편집기가 이 설정을 아직 포괄하지 않아 개별 변경
                 경로를 임시로 막아둠. 추후 대여예약옵션 쪽에 편입되면 재활성 고려 -->
            <div class="dur-tabs dur-tabs-disabled" role="group" aria-label="대여 기간 유형" aria-hidden="true">
              {#each DUR_TYPES as d}
                <button
                  class="dur-tab"
                  class:dur-tab-active={item.durType === d}
                  disabled
                  aria-pressed={item.durType === d}
                >{DUR_LABELS[d]}</button>
              {/each}
            </div>
            <div class="dual-price-row">
              <div class="price-unit">
                <span class="price-unit-label">Day</span>
                <span class="price-amount">{rate24.toLocaleString()}</span>
                <span class="price-currency">원</span>
              </div>
              <span class="price-sep">/</span>
              <div class="price-unit">
                <span class="price-unit-label">12H</span>
                <span class="price-amount">{rate12.toLocaleString()}</span>
                <span class="price-currency">원</span>
              </div>
            </div>
          </div>
          <div class="qty-wrap">
            <div class="qty-ctrl qty-ctrl--optstyle" role="group" aria-label="수량">
              <button class="qty-arrow qty-arrow--optstyle" onclick={() => updateItem(item.id, { qty: Math.max(1, item.qty - 1) })} disabled={item.qty <= 1} aria-label="수량 감소">−</button>
              <span class="qty-num qty-num--optstyle">{item.qty}</span>
              <button class="qty-arrow qty-arrow--optstyle" onclick={() => updateItem(item.id, { qty: item.qty + 1 })} aria-label="수량 증가">+</button>
            </div>
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
                    <div class="dual-price-row dual-price-row--opt">
                      <div class="price-unit">
                        <span class="price-unit-label">Day</span>
                        <span class="price-amount">{fmtKrw(opt.unitPrice * opt.qty)}</span>
                        <span class="price-currency">원</span>
                      </div>
                      <span class="price-sep">/</span>
                      <div class="price-unit">
                        <span class="price-unit-label">12H</span>
                        <span class="price-amount">{fmtKrw(opt.unitPrice * opt.qty)}</span>
                        <span class="price-currency">원</span>
                      </div>
                    </div>
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
  <div class="item-card" class:selected={item.checked} role="listitem">
    <div class="item-card-topbar">
      <button class="item-card-check" onclick={() => updateItem(item.id, { checked: !item.checked })} aria-label="선택">
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
      <button class="delete-btn item-card-delete" onclick={() => removeItem(item)} aria-label="삭제">
        <svg width="14" height="14" viewBox="0 0 17 17" fill="none">
          <path d="M15.5 1.5L8.5 8.5M8.5 8.5L1.5 15.5M8.5 8.5L15.5 15.5M8.5 8.5L1.5 1.5" stroke="#AAAAAA" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
        </svg>
      </button>
    </div>
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
            <div class="dual-price-row">
              <div class="price-unit">
                <span class="price-unit-label">Day</span>
                <span class="price-amount">{rate24.toLocaleString()}</span>
                <span class="price-currency">원</span>
              </div>
              <span class="price-sep">/</span>
              <div class="price-unit">
                <span class="price-unit-label">12H</span>
                <span class="price-amount">{rate12.toLocaleString()}</span>
                <span class="price-currency">원</span>
              </div>
            </div>
          </div>
          <div class="qty-wrap qty-wrap--sm">
            <div class="qty-ctrl qty-ctrl--optstyle" role="group" aria-label="수량">
              <button class="qty-arrow qty-arrow--optstyle" onclick={(e) => { e.stopPropagation(); updateItem(item.id, { qty: Math.max(1, item.qty - 1) }) }} disabled={item.qty <= 1} aria-label="수량 감소">−</button>
              <span class="qty-num qty-num--optstyle">{item.qty}</span>
              <button class="qty-arrow qty-arrow--optstyle" onclick={(e) => { e.stopPropagation(); updateItem(item.id, { qty: item.qty + 1 }) }} aria-label="수량 증가">+</button>
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
                  <div class="dual-price-row dual-price-row--opt">
                    <div class="price-unit">
                      <span class="price-unit-label">Day</span>
                      <span class="price-amount">{fmtKrw(opt.unitPrice * opt.qty)}</span>
                      <span class="price-currency">원</span>
                    </div>
                    <span class="price-sep">/</span>
                    <div class="price-unit">
                      <span class="price-unit-label">12H</span>
                      <span class="price-amount">{fmtKrw(opt.unitPrice * opt.qty)}</span>
                      <span class="price-currency">원</span>
                    </div>
                  </div>
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
          {@render RentalForm({ type: 'rental', calId: 'bulk-rental', selectedDate: bulkDate, onDateChange: bulkHandleDate, timeId: 'bulk-rental-t', selectedTime: bulkTime, onTimeChange: bulkHandleTime, method: bulkOpts.rentalMethod, form: bulkRentalForm, copyToReturn: bulkOpts.copyToReturn, onMethodChange: bulkHandleMethod, onFormChange: bulkHandleRentalForm, onCopyChange: bulkHandleCopy, hasUserAddress: sdHasUserAddress, hasUserProfileInfo: sdHasUserProfileInfo, userProfileInfo: sdUserProfileInfo, userAddressInfo: sdUserAddressInfo, pickupPoints: visitPickupPoints, rangeStart: bulkDate, rangeEnd: bulkReturnDate })}
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
          {@render RentalForm({ type: 'return', calId: 'bulk-return', selectedDate: bulkReturnDate, onDateChange: bulkHandleReturnDate, timeId: 'bulk-return-t', selectedTime: bulkReturnTime, onTimeChange: bulkHandleReturnTime, method: bulkOpts.returnMethod, form: bulkReturnForm, onMethodChange: bulkHandleReturnMethod, onFormChange: bulkHandleReturnForm, hasUserProfileInfo: sdHasUserProfileInfo, userProfileInfo: sdUserProfileInfo, pickupPoints: visitPickupPoints, minDate: bulkDate, rangeStart: bulkDate, rangeEnd: bulkReturnDate })}
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
  hasUserProfileInfo?: boolean;
  userProfileInfo?: UserProfileInfo;
  userAddressInfo?: UserAddressInfo;
  pickupPoints?: PickupPointRow[];
  // 반납일 캘린더 전용 — 수령일 이전 선택 방지(수령일자 값 그대로 전달)
  minDate?: string;
  // 대여 기간 범위 시각화 — 수령·반납 달력 양쪽 모두에 전달해 어느 쪽을 열어도 전체
  // 기간이 하나의 밴드로 보이도록 함(2026-08-17)
  rangeStart?: string;
  rangeEnd?: string;
})}
  {@const sectionLabel = props.type === 'rental' ? '수령 방식' : '반납 방식'}
  {@const dateLabel = props.type === 'rental' ? '수령일' : '반납일'}
  {@const timeLabel = '시간'}
  {@const isVisit = props.method === 'visit'}
  {@const addrLabel = isVisit ? '방문지점 정보' : (props.type === 'rental' ? '배송지 정보' : '반납위치 지정정보')}
  {@const addrNote = props.type === 'rental'
    ? '대여 시작일은 배송일 기준 최소 2일 전까지 선택 가능합니다.'
    : '반납 방식이 수령 방식과 다를 경우 추가 비용이 발생할 수 있습니다.'}
  {@const isCalOpen = openCalId === props.calId}
  {@const isTimeOpen = openTimeId === props.timeId}
  <!-- 배송(delivery/crazydelivery) 잠금 상태(요청 A) — 시간선택 숨김 + 반납leg 콤보 잠금 기준 -->
  {@const locked = isDeliveryLocked(props.method)}
  {@const returnComboLocked = props.type === 'return' && locked}


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
              class:combo-btn-locked={returnComboLocked && tab.v !== props.method}
              disabled={returnComboLocked && tab.v !== props.method}
              title={returnComboLocked && tab.v !== props.method ? '배송 선택 시 반납방식이 자동으로 고정됩니다.' : undefined}
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
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" class="datetime-btn-chevron" class:datetime-btn-chevron-open={isCalOpen}><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
            </button>
            {#if !locked}
              <button class="datetime-btn datetime-btn-mid" onclick={() => openTime(props.timeId)}>
                <div class="datetime-btn-left">
                  <svg width="23" height="23" viewBox="0 0 22.5 22.5" fill="none">
                    <path d="M11.25 0C13.69 0 15.95 0.78 17.8 2.1L19 0.5C19.41 -0.05 20.2 -0.16 20.75 0.25C21.3 0.66 21.41 1.45 21 2L19.66 3.78C21.43 5.77 22.5 8.38 22.5 11.25C22.5 17.46 17.46 22.5 11.25 22.5C5.04 22.5 0 17.46 0 11.25C0 8.33 1.11 5.68 2.93 3.68L1.55 2.06C1.1 1.54 1.16 0.75 1.69 0.3C2.21 -0.15 3 -0.09 3.45 0.44L4.81 2.03C6.63 0.75 8.85 0 11.25 0ZM11 5C10.31 5 9.75 5.56 9.75 6.25V12.17C9.75 12.64 10.01 13.07 10.42 13.28L14.42 15.36C15.04 15.68 15.79 15.44 16.11 14.83C16.43 14.21 16.19 13.46 15.58 13.14L12.25 11.41V6.25C12.25 5.56 11.69 5 11 5Z" fill="rgba(255,255,255,0.8)"/>
                  </svg>
                  <span class="datetime-btn-label">{props.selectedTime || timeLabel}</span>
                </div>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none" class="datetime-btn-chevron" class:datetime-btn-chevron-open={isTimeOpen}><path d="M1 1L7 7L1 13" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
              </button>
            {/if}
          </div>

          <!-- 대여일시 통합 요약 — 날짜+시간 모두 선택 시 요일 포함 한 줄로 재확인 -->
          {#if props.selectedDate && props.selectedTime}
            <p class="datetime-summary">
              {displayDate(props.selectedDate)}({weekdayKr(props.selectedDate)}) {props.selectedTime} {props.type === 'rental' ? '수령' : '반납'}
            </p>
          {/if}

          <!-- 달력 레이어 -->
          {#if isCalOpen}
            <div class="cal-layer" transition:slide={{ duration: 200 }}>
              <CalendarGrid
                value={props.selectedDate}
                minDate={props.minDate}
                rangeStart={props.rangeStart}
                rangeEnd={props.rangeEnd}
                rangeStartLabel="수령일"
                rangeEndLabel="반납일"
                onselect={(iso) => props.onDateChange(iso)}
                isDateDisabled={!locked ? undefined : (props.type === 'rental'
                  ? (iso: string) => courierClosedSet.has(addDays(iso, -1))
                  : (iso: string) => courierClosedSet.has(iso))}
              />
            </div>
          {/if}

          <!-- 시간 선택 레이어 — 오전/오후 구획 세로 리스트(2026-08-17 가독성 개선:
               6열 그리드+12px 텍스트가 터치타겟 44px 미만·가독성 저하 지적돼 교체) -->
          {#if isTimeOpen && !locked}
            <div class="time-layer" transition:slide={{ duration: 200 }}>
              <div class="time-list">
                <div class="time-section">
                  <span class="time-section-label">오전</span>
                  {#each TIME_AM_HOURS as h}
                    {@const t = fmtTime(h)}
                    {@const isSel = props.selectedTime === t}
                    {@const isLocker = isLockerHour(t)}
                    <button
                      class="time-row"
                      class:time-row-locker={isLocker}
                      class:time-row-sel={isSel && !isLocker}
                      class:time-row-locker-sel={isSel && isLocker}
                      onclick={() => { props.onTimeChange(t); openTimeId = null; }}
                    >{t}</button>
                  {/each}
                </div>
                <div class="time-section">
                  <span class="time-section-label">오후</span>
                  {#each TIME_PM_HOURS as h}
                    {@const t = fmtTime(h)}
                    {@const isSel = props.selectedTime === t}
                    {@const isLocker = isLockerHour(t)}
                    <button
                      class="time-row"
                      class:time-row-locker={isLocker}
                      class:time-row-sel={isSel && !isLocker}
                      class:time-row-locker-sel={isSel && isLocker}
                      onclick={() => { props.onTimeChange(t); openTimeId = null; }}
                    >{t}</button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
        {#if isVisit && props.selectedTime && isLockerHour(props.selectedTime)}
          <p class="form-note form-note-locker">
            선택한 {props.type === 'rental' ? '방문대여' : '방문반납'} 시간은 고객센터
            '무인보관함' 이용만 가능하며 1시간 전 비밀번호를 채팅서비스로 발송해 드립니다.
          </p>
        {:else if locked}
          <p class="form-note">{addrNote}</p>
        {/if}
      </div>
    </div>

    <!-- 고객 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">고객 정보</span>
        <label class="form-check-label" class:form-check-label-disabled={!props.hasUserProfileInfo}>
          <button
            class="checkbox-btn small"
            disabled={!props.hasUserProfileInfo}
            onclick={() => {
              const next = !props.form.memberCheck
              props.onFormChange(next
                ? {
                    ...props.form,
                    memberCheck: true,
                    name:  props.userProfileInfo?.name  ?? props.form.name,
                    email: props.userProfileInfo?.email ?? props.form.email,
                    phone: props.userProfileInfo?.phone ?? props.form.phone,
                  }
                : { ...props.form, memberCheck: false })
            }}
            aria-label="회원정보 반영"
          >
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
        <input class="f-input" placeholder="휴대번호를 '-' 없이 입력" value={props.form.phone} oninput={(e) => props.onFormChange({ ...props.form, phone: readInputValue(e) })}/>
      </div>
    </div>

    <!-- 배송지/반납위치 정보 -->
    <div class="form-section">
      <div class="form-section-header">
        <span class="form-section-label">{addrLabel}</span>
        {#if props.type === 'rental' && !isVisit}
          <label class="form-check-label" class:form-check-label-disabled={!props.hasUserAddress}>
            <button
              class="checkbox-btn small"
              disabled={!props.hasUserAddress}
              onclick={() => {
                const next = !props.form.memberCheck2
                props.onFormChange(next
                  ? {
                      ...props.form,
                      memberCheck2: true,
                      addr:       props.userAddressInfo?.road_address  ?? props.form.addr,
                      addrDetail: props.userAddressInfo?.detail_address ?? props.form.addrDetail,
                    }
                  : { ...props.form, memberCheck2: false })
              }}
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
      {#if isVisit}
        <!-- 방문대여/방문반납 선택 시 배송지 입력 대신 실제 방문 지점 정보로 대체(2026-08-17) -->
        <div class="visit-info">
          {#if props.pickupPoints && props.pickupPoints.length > 0}
            {#each props.pickupPoints as point (point.id)}
              <p><strong>{point.name}</strong>{point.address ? ` — ${point.address}` : ''}</p>
            {/each}
          {:else}
            <p>등록된 방문 지점이 없습니다. 고객센터로 문의해 주세요.</p>
          {/if}
        </div>
      {:else}
        <div class="form-fields">
          <input class="f-input" placeholder="기본주소 입력" value={props.form.addr} oninput={(e) => props.onFormChange({ ...props.form, addr: readInputValue(e) })}/>
          <input class="f-input" placeholder="상세주소 입력" value={props.form.addrDetail} oninput={(e) => props.onFormChange({ ...props.form, addrDetail: readInputValue(e) })}/>
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
      <label class="copy-label" class:copy-label-locked={locked}>
        <button
          class="checkbox-btn small"
          disabled={locked}
          onclick={() => props.onCopyChange?.(!props.copyToReturn)}
          aria-label="반납에 동일 적용"
        >
          <svg viewBox="0 0 20 20" fill="none" class="checkbox-svg">
            {#if props.copyToReturn || locked}
              <rect fill="#3B2F8A" height="18" rx="4" width="18" x="1" y="1"/>
              <path d="M5 10L8.5 13.5L15 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            {:else}
              <rect fill="white" height="18" rx="4" width="18" x="1" y="1"/>
              <rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1"/>
            {/if}
          </svg>
        </button>
        <span>{locked ? '배송 선택 시 반납방식이 자동으로 동일하게 고정됩니다.' : '설정옵션을 반납방법에 적용합니다.'}</span>
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
      <span>일</span>
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
    /* app.css --radius-lg는 "배지·날짜 행"용 토큰(20px)이지 카드용이 아님 — 이 카드는
       같은 화면의 .order-card(흰 카드, --radius-2xl 50px)와 동일한 흰 카드 계열이라
       --radius-2xl로 통일(2026-08-17, front-uiux.md §4 문서표 대신 app.css 실제
       토큰 주석 기준 — 지난 .order-card 정정과 동일 원칙) */
    border-radius: var(--radius-2xl, 50px);
    box-shadow: 0px 1px 2px rgba(0,0,0,0.06);
    border: 1.5px solid transparent;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
    overflow: hidden;
    /* front-uiux.md §카드형 레이아웃 상하 패딩 — PC 30px(2026-08-17 확정). 이 카드는
       PC 전용(master-detail display:none 이하 641px)이라 모바일 20px 값은 해당 없음.
       좌우는 기존 spacing 토큰(20px) 그대로 유지 */
    /* 2026-08-18: 상단 83px로 재확대 — .item-card-topbar(체크박스+삭제)와 .item-card-body
       콘텐츠 시작선 사이 여백을 실측 기준 30px로 확보. PC 전용 컴포넌트(master-detail
       display:none 이하 641px)라 이 값은 PC 반응형에만 적용됨 — 별도 모바일 오버라이드
       불필요. 좌우/하단은 기존 표준값(20px/30px) 그대로 유지 */
    padding: 83px var(--spacing-5, 20px) 30px;
  }
  /* 결제 포함 체크박스 + 삭제 버튼 묶음(2026-08-18) — 기존엔 각자 독립적으로 카드 좌/우
     상단에 absolute 배치돼 있던 것을 하나의 상단바(.item-card-topbar)로 그룹화. 카드
     (BG 영역) 최상단에 고정 — 옵션상품이 늘어나 카드가 길어져도 항상 카드 첫 줄 높이에
     맞춰 고정된다. 12px = 카드 패딩(20px) - 버튼 자체 여백(8px), 콘텐츠 여백과 시각적으로
     정렬 */
  .item-card-topbar {
    position: absolute;
    /* 2026-08-18: 카드 BG 최상단과의 여백을 12px → 20px로 확대(체크박스 버튼 높이
       28px 기준 하단 끝이 정확히 콘텐츠 시작선(padding-top 48px)에 닿아 여전히
       겹치지 않음) */
    top: 20px;
    left: 12px;
    right: 12px;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* 2026-08-18: 좌우 8px 추가 — 기존 left/right:12px(카드 기준 절대 인셋)에 더해
       버튼 자체를 안쪽으로 8px 밀어 총 20px 여백(top:20px와 동일 수준)으로 정렬 */
    padding: 0 8px;
  }
  /* 결제 포함 체크박스(PC) — 모바일 .card-top-row .checkbox-btn과 동일 위치(카드 좌상단)·
     동일 아이콘(checkbox-svg 20px, PC 폼 체크박스와 이미 같은 크기 재사용)로 노출
     (2026-08-18 — 기존엔 PC 카드에 체크박스가 없어 전체 배경색 변화로만 선택을 표현했음,
     모바일과 시각적으로 통일) */
  .item-card-check {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
  }
  .item-card:hover { background: var(--cs-lilac); }
  /* 결제 포함 여부(item.checked) — 이전 세대 체크박스 아이콘 UI 대체, 카드 자체 배경색으로 표현 */
  .item-card.selected { background: var(--cs-purple-op10); }
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
    /* 2026-08-18: 이미지~정보 여백 2배 확대(15px → 30px). 이 카드는 PC 전용 컴포넌트
       (master-detail display:none 이하 641px)라 모바일 대응 인스턴스가 별도로 없음 —
       이 값 자체가 PC 반응형 적용값 */
    gap: 30px;
    width: 100%;
    /* 2026-08-18: 641px 근처의 좁은 PC창(list-pane+detail-pane 분할로 카드 자체 폭이
       매우 좁아지는 구간)에서 .item-info(min-width:0)가 계속 짜부라지다가 배지 행
       (.item-info-top)만 2줄로 줄바꿈돼 정보 열 높이가 108px 썸네일보다 커지고, 그
       결과 하단 수량 스테퍼가 썸네일 바닥선 아래로 삐져나와 보이던 결함 — flex-wrap
       추가 + 아래 .item-info min-width 플로어로, 공간이 부족하면 배지만 어색하게
       줄바꿈되는 대신 정보 블록 전체가 깔끔하게 썸네일 아래 새 줄로 내려가도록 변경 */
    flex-wrap: wrap;
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
  .item-info { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 6px; }
  .item-info-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  /* 2026-08-18: /products/[id] 상세페이지 .price-row("Day 72,000원 / 12H 52,000원")
     레이아웃을 그대로 가져와 기존 dur-badge/fee-badge(단일 배지 2개) 표시를 대체 —
     반응형별(모바일 기본값/PC ≥641px) 폰트·컬러 토큰도 원본 그대로 반영. 이 카드는
     PC 전용(master-detail, ≥641px)이라 실제로는 PC 분기값만 보이지만, 원본과 동일하게
     양쪽 다 정의해둠 */
  /* 2026-08-18(수정): 클래스명이 기존 무관한 .price-row(대여요금/배송요금 라인아이템
     행, justify-content:space-between 포함)와 충돌해 "/" 구분자가 우측으로 밀려나는
     등 스타일이 오염되고 있었음 — dual-price-row로 개명해 충돌 해소(같은 이유로
     .price-period-label도 price-unit-label로 개명 완료) */
  .dual-price-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cs-red-badge);
    flex-wrap: wrap;
  }
  .price-unit { display: flex; align-items: baseline; gap: 4px; }
  .price-unit-label { font: var(--text-m-script-12); }
  @media (min-width: 641px) { .price-unit-label { font: var(--text-pc-ad-kr-22); } }
  /* 2026-08-18: 카드 폭에 맞춰 축소(모바일 24px→14px, PC 35px→18px) — 참조 페이지의
     히어로급 가격 크기는 이 컴팩트 카드 행에는 과했음 */
  .price-amount {
    font-family: var(--font-kr-heading);
    font-weight: 700;
    font-size: 14px;
  }
  @media (min-width: 641px) { .price-amount { font-size: 18px; } }
  .price-currency { font: var(--text-m-script-12); }
  @media (min-width: 641px) { .price-currency { font: var(--text-pc-ad-kr-22); } }
  /* 2026-08-18: 옵션카드(.dual-price-row--opt)와 동일 수준으로 본상품 dual-price-row도
     한 단계 더 축소 — 위 font: 토큰(라벨/통화) 위에 font-size만 덮어써서 폭 좁힘.
     PC(≥641px)만 이 축소값 유지 */
  @media (min-width: 641px) { .price-unit-label { font-size: 11px; } }
  @media (min-width: 641px) { .price-amount { font-size: 13px; } }
  @media (min-width: 641px) { .price-currency { font-size: 11px; } }
  /* 2026-08-18: 모바일 반응형만 한 단계 큰 폰트 토큰값으로 재확대 — price-unit-label/
     price-currency는 위 10px 오버라이드를 제거해 원래 선언된 토큰(--text-m-script-12,
     12px)으로 복귀(폰트 타입은 그대로 유지, 크기만 한 단계 큰 기존 토큰값 적용).
     price-amount는 토큰화된 속성이 아니라 family+weight를 그대로 유지한 채
     font-size만 12px→14px로 확대
     2026-08-19(QA 발견·수정): 이 규칙에 미디어쿼리 스코프가 빠져 있어 "모바일만"이라는
     주석 의도와 달리 PC(≥641px)에서도 항상 이 14px이 위 1922행의 13px을 덮어쓰고
     있었음 — 원래 의도대로 모바일 전용으로 스코프 추가 */
  @media (max-width: 640px) { .price-amount { font-size: 14px; } }
  .price-sep { font: var(--text-m-script-14); color: var(--cs-red-badge); }
  .item-name {
    /* 2026-08-18: --text-m-htitle-24B 스타일(900 Black)을 반영하되, 이 카드 규모에 맞춰
       18px(중간 크기) 버전인 신설 토큰 --text-m-htitle-18B 적용(app.css 참고) */
    font: var(--text-m-htitle-18B);
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
    /* front-uiux.md §4 "카드(대)" PC값 — 50px(--radius-2xl). Mobile은 30px로 의도적으로
       다름(@media max-width:640px 오버라이드 참고, 2026-08-17 Stephen 확정) */
    border-radius: var(--radius-2xl, 50px);
    width: 100%;
    box-sizing: border-box;
  }
  /* 결제 포함 여부(item.checked) — PC .item-card.selected와 동일 배경색 토큰 적용(2026-08-18,
     기존엔 모바일만 흰색 고정이라 선택 상태가 카드 배경에 반영되지 않았음) */
  .order-card.selected { background: var(--cs-purple-op10); }
  .order-card-inner {
    display: flex;
    flex-direction: column;
    gap: 50px;
    padding: 40px;
  }
  /* 2026-08-19: front 표준 디자인 시스템(카드(중) 티어) 기준으로 라운드값 축소
     (--radius-2xl 50px → --radius-xl 30px, PC·모바일 공용) + 아이콘 추가로 세로폭
     2배 확대(패딩 40px→60px + 아이콘+간격+텍스트 레이아웃) */
  .empty-card {
    border-radius: var(--radius-xl, 30px);
    padding: 60px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    text-align: center;
  }
  .empty-icon { width: 56px; height: auto; flex-shrink: 0; }
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
  /* 2026-08-18: 기존엔 .product-img/.product-meta/.qty-wrap이 .product-row의 flex 자식
     3개로 나란히 있어, 좁은 화면에서 수량 스테퍼가 나머지와 무관하게 자기 혼자 다음 줄로
     떨어져 나가 시각적으로 붕 떠 보이던 결함 — .product-meta+.qty-wrap을 이 래퍼 하나로
     묶어 "이미지 | 정보그룹(이름·기간탭·가격·배지·수량)" 2열 구조로 재구성 */
  .product-info-group {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px;
  }
  .product-name {
    /* 2026-08-18: 한 단계 큰 토큰으로 교체(--text-m-title-18B 18px Bold →
       --text-m-htitle-24B 24px Black) — font 축약형이 weight/line-height도 함께 지정 */
    font: var(--text-m-htitle-24B);
    color: #100B32;
    letter-spacing: -0.3px;
    margin: 0 0 5px;
    word-break: break-word;
  }
  /* ══ 옵션상품 하위 카드 — Figma(node 2447:12056) 기준: 본상품과 동일한 크기/폰트를 쓰고
     연결선(ㄴ)만으로 하위 관계를 표시. 12H/24H 이중가격·수량 스테퍼는 옵션상품에 해당
     데이터·기능이 없어 제외(이름·수량·합계금액·썸네일만 정직하게 표시) */
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
  /* 2026-08-18: 옵션상품도 본상품과 동일한 Day/12H price-row로 통일(옵션은 기간별
     요금이 실제로 없어 동일 unitPrice*qty 값을 양쪽에 동일 표시 — Stephen 확인).
     옵션 카드 규모(본상품보다 작음)에 맞춰 price-amount 등 폭 축소 */
  /* 2026-08-18: 본상품 price-amount/label/currency도 이 옵션 규격과 동일하게
     맞춰져(위 본상품 규칙 참고) 폰트 크기 오버라이드는 더 이상 필요 없음 — gap만
     옵션 카드 쪽이 좁게 유지 */
  /* 2026-08-24: 좁은 화면에서 option-subcard-bottom(가격+수량 한 행)이 빠듯할 때, 이 내부
     dual-price-row 자체가 먼저 wrap되어 "Day 23,000원 /"가 어색하게 줄바꿈되던 결함 —
     가격 블록은 항상 한 줄로 유지하고, 대신 바깥 option-subcard-bottom(flex-wrap:wrap)이
     가격 블록 전체 vs 수량 컨트롤 단위로 줄바꿈하도록 역할 분리 */
  .dual-price-row--opt { gap: 6px; flex-wrap: nowrap; }
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
    gap: 10px;
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
    border-radius: 10px;
    padding: 7px 5px;
    font-size: 10px;
    font-weight: 700;
    color: var(--cs-text, #100B32);
    letter-spacing: -0.5px;
    line-height: 2;
    min-width: 62px;
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
  .option-subcard--compact .opt-qty-arrow { width: 22px; height: 22px; font-size: 14px; }
  .option-subcard--compact .opt-qty-num {
    border-radius: 10px;
    padding: 7px 5px;
    font-size: 10px;
    letter-spacing: -0.5px;
    line-height: 2;
    min-width: 62px;
  }

  /* ══ Duration Type Tabs ══ */
  /* 2026-08-18: 비활성 상태로 숨김(삭제 아님, Stephen 확인) — 마크업·로직은 보존해
     추후 "대여예약옵션" 통합 편집기에 편입 시 이 규칙만 제거하면 즉시 재활성 가능 */
  .dur-tabs.dur-tabs-disabled { display: none; }
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
  /* 2026-08-18: 모바일 본상품 수량조절 UI를 옵션상품(.opt-qty-ctrl) 스타일로 교체
     (SVG 화살표 → 텍스트 −/+ 문자, 최소수량 시 비활성 상태 추가) + 30% 확대 배치.
     신규 모디파이어 클래스로 분리해 PC ItemListCard(.qty-wrap--sm, 여전히 SVG 사용)에는
     영향 없음 — opt-qty-arrow(22px/14px)·opt-qty-num(패딩 2px 10px/12px/최소폭22px)
     기준값에 ×1.3 적용 */
  /* 2026-08-24: 모바일(OrderCard, 화살표 29px)도 PC ItemListCard(화살표 22px, 아래
     .qty-wrap--sm 스코프)와 동일한 숫자칸:화살표 비율(min-width 62/22 ≈ 2.82배)로 확대 —
     화살표가 22→29px(×1.318)이므로 나머지 값도 동일 배율로 스케일 */
  .qty-ctrl--optstyle { gap: 13px; }
  .qty-arrow--optstyle {
    width: 29px;
    height: 29px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    color: var(--cs-text-dark, #444444);
  }
  .qty-arrow--optstyle:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
  .qty-arrow--optstyle:disabled { opacity: 0.35; cursor: not-allowed; }
  .qty-num--optstyle {
    background: var(--cs-white, #fff);
    border-radius: 13px;
    padding: 9px 7px;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text, #100B32);
    letter-spacing: -0.5px;
    line-height: 2;
    min-width: 82px;
    text-align: center;
  }
  /* PC ItemListCard 전용 축소 스케일(30% 작게) — 모바일 OrderCard의 기본 .qty-wrap 크기는 그대로 유지
     2026-08-24: 옵션상품(.opt-qty-ctrl) 수량 UI(텍스트 −/+)와 동일 스타일로 통일(기존 SVG 화살표 폐기) */
  .qty-wrap--sm { gap: 10px; justify-content: flex-start; }
  .qty-wrap--sm .qty-ctrl--optstyle { gap: 10px; padding: 0; }
  .qty-wrap--sm .qty-arrow--optstyle { width: 22px; height: 22px; font-size: 14px; }
  /* 수량표시 폼(qty-num) 좌우 패딩 5px(2026-08-24 Stephen 확정 — 이전 28px→0→5px) */
  .qty-wrap--sm .qty-num--optstyle { padding: 7px 5px; font-size: 10px; min-width: 62px; border-radius: 10px; }

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
    color: var(--cs-purple-dark);
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
    color: var(--cs-purple-dark);
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
  .form-note-locker {
    color: var(--cs-red);
    margin-top: 4px;
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
    background: var(--cs-surface-gray);
    border-radius: var(--radius-md, 15px);
    padding: 16px 20px;
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
    color: var(--cs-text-dark);
    justify-content: center;
  }
  /* 배송(delivery/crazydelivery) 선택 시 반납방식 강제 고정(요청 A) — 체크박스 비활성 표시 */
  .copy-label-locked {
    cursor: not-allowed;
    opacity: 0.7;
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
  /* 배송 선택 시 반납방식 콤보 잠금(요청 A) — 선택되지 않은 나머지 방식 비활성 */
  .combo-btn-locked {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .combo-btn-locked:hover {
    border-color: #DCDCDC;
    background: #fff;
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

  /* 대여일시 통합 요약 배지 — 날짜+시간 모두 선택 시 확인용 */
  .datetime-summary {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font: var(--text-m-script-14B);
    font-weight: 700;
    color: var(--cs-purple-dark);
    background: var(--cs-purple-op10);
    border-radius: var(--radius-full, 9999px);
    padding: 10px 16px;
    margin: 8px 0 0;
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
  .datetime-btn-dark { background: var(--cs-text-dark); }
  .datetime-btn-mid { background: var(--cs-text-mid); }
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
  /* 수령일/수령시간 아코디언 펼침 상태 표시 — 화살표 90도 회전(2026-08-24) */
  .datetime-btn-chevron { transition: transform 0.2s ease; flex-shrink: 0; }
  .datetime-btn-chevron-open { transform: rotate(90deg); }

  /* ══ Calendar + Time Layer ══ */
  .datetime-wrap { position: relative; display: flex; flex-direction: column; gap: 0; padding: 30px 0; }
  .cal-layer {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 100;
    background: var(--cs-white);
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    /* 2026-08-18: 기존 50%는 상단 .datetime-btns(수령일+수령시간 2버튼) 중 절반(수령일
       버튼)폭에만 맞춰져 있어 날짜 그리드 우측 열이 좁게 잘려 보이던 결함 — .datetime-wrap
       (부모, position:relative) 전체 폭인 100%로 확장해 두 버튼을 합친 가로폭과 정렬.
       PC·모바일 공용 규칙(미디어쿼리 분기 없음)이라 양쪽 반응형에 동시 적용됨 */
    width: 100%;
    box-sizing: border-box;
  }

  /* ══ Time Layer ══ */
  .time-layer {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 100;
    background: var(--cs-white);
    border-radius: 20px;
    padding: 16px;
    box-shadow: 0 8px 30px rgba(16,11,50,0.15);
    width: 50%;
    box-sizing: border-box;
  }
  /* 시간 선택 — 오전/오후 구획 세로 스크롤 리스트(2026-08-17, B안 채택).
     기존 6열×4행 그리드(셀당 세로 ~28px)는 ui-mobile.md 44×44px 터치타겟 기준 미달 +
     "00:00" 전체 표기가 12px로 밀집돼 가독성 저하 지적됨(Stephen) — 세로 목록 + 큰
     행 높이로 교체. 대안(C안: 네이티브 <input type="time"> 또는 커스텀 휠피커)은
     각각 "기존 브랜드 디자인 언어(보라색 강조·pill 형태)와 이질적" / "스크롤스냅 등
     구현·크로스브라우저 리스크 큼" 이유로 기각(Stephen 승인) — SuggestPicker와 동일한
     max-height+overflow-y:auto 스크롤 컨테이너 패턴 재사용. */
  .time-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 280px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .time-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .time-section-label {
    display: block;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--cs-white);
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-text-light);
    padding: 6px 4px;
  }
  .time-row {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 44px;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: 10px;
    font: var(--text-pc-body-14);
    font-weight: 600;
    color: var(--cs-text-dark);
    cursor: pointer;
    transition: background 0.15s;
  }
  .time-row:hover { background: var(--cs-purple-op10); }
  .time-row-sel { background: var(--cs-purple) !important; color: var(--cs-white) !important; font-weight: 700; }
  /* 영업외시간(23:00~08:59) 구간 — 무인보관함 인계 대상 시간대 시각적 구분(2026-08-20)
     bg: --cs-red-xlight(red-5%, #FFEAEA) / hover: --cs-chat-in-bg(red-10%, #FFCFCF)
     — 2026-08-20 Stephen 확정값. 선택 시 아웃라인 강조는 제거(배경·텍스트 색상만으로 구분) */
  .time-row-locker { background: var(--cs-red-xlight); }
  .time-row-locker:hover { background: var(--cs-chat-in-bg); }
  .time-row-locker-sel {
    background: var(--cs-red-xlight) !important;
    color: var(--cs-red) !important;
    font-weight: 700;
  }

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

  /* ══ Coupon Row ══ (CouponRow 스니펫 — 2026-08-24 장바구니 체크아웃에 다시 노출) */
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
  .coupon-section { display: flex; flex-direction: column; gap: 15px; padding: 20px; }
  .coupon-section .section-sub-label { padding: 0 0 5px; }

  /* ══ 포인트 사용 입력(장바구니) ══ */
  .points-select-section { display: flex; flex-direction: column; gap: 15px; padding: 20px; }
  .points-input-row { display: flex; align-items: center; gap: 10px; }
  .points-input { flex: 1; }
  .points-all-btn {
    flex-shrink: 0;
    background: var(--cs-purple-op10);
    border: none;
    border-radius: 15px;
    padding: 0 20px;
    height: 44px;
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    cursor: pointer;
  }
  .points-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }

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
    /* app.css --radius-xl(30px, "총금액 박스·CTA 버튼" 주석)와 정확히 일치하는 값 —
       하드코딩만 정리(2026-08-17, 카드 라운드값 정렬 작업 연장) */
    border-radius: var(--radius-xl, 30px);
    overflow: hidden;
    width: 100%;
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

  .total-dark-box {
    background: #100B32;
    /* app.css --radius-xl(30px, "총금액 박스·CTA 버튼")와 일치 — PC 30px인데 모바일만
       20px로 갈라져 있던 파편화도 함께 정리(모바일 오버라이드 제거, 2026-08-17) */
    border-radius: var(--radius-xl, 30px);
    /* 좌우 패딩을 프론트 표준 레이아웃 토큰(--layout-pc-pad, 40px)으로 명시 — 기존엔
       같은 40px를 하드코딩해 값 자체는 표준과 일치했지만 토큰 참조가 아니었음. 모바일
       오버라이드는 이미 --layout-mob-pad를 쓰고 있어 PC만 정정 */
    padding: 20px var(--layout-pc-pad, 40px);
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
    /* 형제 박스(.total-details-box/.total-dark-box)와 동일 계열인데 --radius-lg(20px,
       "배지·날짜 행"용 토큰)를 잘못 쓰고 있었음 — --radius-xl(30px, "총금액 박스")로
       통일, PC·모바일 동일값이라 별도 모바일 오버라이드 불필요(2026-08-17) */
    border-radius: var(--radius-xl, 30px);
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
    line-height: 2;
    white-space: nowrap;
  }
  .checkbox-terms-icon { display: block; flex-shrink: 0; }
  .terms-guide-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: inherit;
    color: var(--cs-text);
    text-decoration: underline;
    cursor: pointer;
  }

  /* ══ 이용안내 모달 ══ */
  .guide-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(16, 11, 50, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .guide-modal {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    width: 100%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .guide-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px 30px;
    border-bottom: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }
  .guide-modal-title { font-size: 18px; font-weight: 700; color: var(--cs-text); }
  .guide-modal-close {
    background: none;
    border: none;
    font-size: 18px;
    color: var(--cs-text-dark);
    cursor: pointer;
    width: 28px;
    height: 28px;
  }
  .guide-modal-body {
    padding: 24px 30px 30px;
    overflow-y: auto;
  }
  .guide-modal-text {
    font-size: 14px;
    line-height: 1.7;
    color: var(--cs-text-dark);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .guide-modal-empty { font-size: 14px; color: var(--cs-text-light, #AAAAAA); }

  @media (max-width: 640px) {
    .guide-modal-overlay { align-items: flex-end; padding: 0; }
    .guide-modal {
      max-width: 100%;
      max-height: 75vh;
      border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    }
    .guide-modal-header { padding: 20px; }
    .guide-modal-body { padding: 20px 20px 30px; }
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
    /* 2026-08-17(재정정) — front-uiux.md §4 대/중 2단 체계 확정: 카드(대) 반경은
       PC 50px(--radius-2xl) / Mobile 30px로 의도적으로 다르다(동일값 통일이 아님) —
       Stephen 확정 지침에 따라 모바일 전용 30px 오버라이드를 다시 명시 */
    .order-card { border-radius: 30px; }
    .order-card-inner { padding: 20px; gap: 30px; }
    /* 2026-08-19(재정정): 가로 1열 재배치는 Stephen이 요청한 적 없는 임의 변경이었음 —
       PC와 동일한 세로중앙정렬 구조(column/center)로 되돌리고, 패딩만 카드 크기에 맞춰
       축소 유지. 아이콘은 PC 대비 1.5배(56px→84px) 유지, 안내텍스트는 1.5배(24px)가
       과했다는 후속 지적으로 한 단계 아래 토큰(--text-m-title-21, 21px)으로 하향 조정 */
    .empty-card { padding: 40px 24px; gap: 20px; }
    .empty-icon { width: 84px; }
    .empty-text { font: var(--text-m-title-21); }

    /* 2026-08-19: 쿠폰 행 — PC는 좌측(체크박스+쿠폰명)·우측(만료일뱃지)이 한 줄 양끝정렬인데,
       모바일 좁은 폭에서 쿠폰명이 길면 만료일뱃지와 부딪혀 잘리기 쉬워 세로 2줄 구조로 변경
       (쿠폰명 줄 → 만료일뱃지 줄, 뱃지는 우측 정렬 유지) */
    .coupon-row { flex-direction: column; align-items: flex-start; gap: 10px; }
    .coupon-expiry { align-self: flex-end; }
    /* 2026-08-18: 20% 축소(120px → 96px) + 상단 정렬 반영 */
    .product-img { width: 96px; height: 96px; border-radius: 24px; }
    /* 2026-08-18: 이미지~정보그룹 여백 축소(20px → 12px) + 이미지 상단 정렬(기존
       align-items:center는 .product-row 기본 규칙 — 이미지 축소 후 정보그룹과 세로
       중앙정렬되면 어색해 보여 상단 기준으로 변경) */
    .product-row { gap: 12px; align-items: flex-start; }
    /* 2026-08-17: min-width:0(PC 기본값)이라 좁은 화면에서 이미지 옆에서 한없이 짜부라져
       대여기간 배지("12H"/"24H"/"1일"/"구매")·가격 텍스트가 세로로 쪼개져 보이던 결함
       수정 — 폭이 부족하면 이미지 아래 새 줄로 완전히 내려가도록 최소폭 확보(.product-row는
       이미 flex-wrap:wrap이라 이 min-width만 주면 자동으로 줄바꿈됨). 2026-08-18:
       .product-meta+.qty-wrap을 .product-info-group으로 묶으면서 이 오버라이드도
       래퍼 기준으로 이동, 좌측 패딩(16px)은 불필요 요소로 판단돼 제거 */
    .product-info-group { min-width: 180px; padding: 0; }
    /* 2026-08-18: PC .item-name과 동일 계열(htitle, 900 Black)로 통일 — 모바일 카드
       규모에 맞춰 신설된 --text-m-htitle-20B(20px Black) 적용(기존 --text-m-body-16B
       16px Bold보다 한 단계 더 굵고 큼) */
    .product-name { font: var(--text-m-htitle-20B); }
    /* 2026-08-17: 옵션상품 하위카드도 본상품과 동일한 원인(min-width:0 무한축소)으로 상품명이
       "SONY PXW-" / "Z90"처럼 쪼개져 보이던 결함 — 동일하게 최소폭 확보 + 줄바꿈 허용 */
    /* 2026-08-18: 기존 width:100%(기본 규칙)가 margin-left:28px에 더해져 카드 우측이
       order-card-inner 우측 패딩을 무시하고 그만큼 밀려나가던 결함 — width:auto로 교체해
       flex 스트레치가 margin을 반영해 폭을 계산하도록 수정(폭을 더 줄이는 방향) */
    .option-subcard { flex-wrap: wrap; margin-left: 28px; width: auto; padding: 16px 16px; }
    .option-subcard-connector { left: -28px; }
    .option-subcard-info { min-width: 140px; }
    /* 2026-08-18: 20% 축소(120px → 96px) */
    .option-subcard-img { width: 96px; height: 96px; border-radius: 24px; }
    /* 2026-08-18: 한 단계 큰 토큰으로 교체(--text-m-script-14B 14px Bold →
       --text-m-body-16B 16px Bold) */
    .option-subcard-name { font: var(--text-m-body-16B); }
    /* 2026-08-18: card-top-row(모바일 OrderCard 체크박스+삭제)가 PC .item-card-topbar와
       동일한 checkbox-svg(20px)/delete-btn(14px+padding8px) 공유 클래스를 그대로 써서
       모바일 반응형 비율이 전혀 반영되지 않던 결함 — ui-mobile.md 최소 터치타겟(44×44px)
       기준으로 이 컨텍스트만 확대(다른 checkbox-svg/delete-btn 사용처는 영향 없음) */
    .card-top-row .checkbox-svg { width: 24px; height: 24px; }
    .card-top-row .checkbox-btn { padding: 10px; }
    .card-top-row .delete-btn { padding: 14px; }
    .card-top-row .delete-btn svg { width: 16px; height: 16px; }
    .qty-ctrl { gap: 16px; }
    .qty-num { padding: 6px 14px; font-size: 13px; }
    .acc-head { padding: 16px 20px; border-radius: 20px; }
    .acc-label { font-size: 15px; }
    /* 2026-08-19(재조정): 21px가 과했다는 피드백 — 한 단계 작은 토큰(--text-m-title-18B,
       18px Bold)으로 축소. PC(--text-pc-title-18, 18px Bold)와 완전히 동일한 크기·굵기 */
    .acc-value { font: var(--text-m-title-18B); }
    .acc-body { padding-top: 20px; }
    .datetime-btn { padding: 12px 16px; }
    .datetime-btn-label { font: var(--text-m-body-16B); letter-spacing: -0.5px; }
    /* 모바일: 시간선택 리스트는 50%(PC 기준)로는 너무 좁아 전체폭 확보(가독성 개선,
       2026-08-17) — 날짜/시간 팝업은 한 번에 하나만 열리므로 폭 겹침 없음 */
    .time-layer { width: 100%; }
    .time-list { max-height: 240px; }
    .time-row { font: var(--text-m-script-14B); }
    .total-gray-section { padding: 20px; }
    .total-dark-box { padding: 16px var(--layout-mob-pad); }
    .total-label { font-size: 14px; }
    .total-num { font-size: 18px; }
    .cart-footer { padding-bottom: max(14px, env(safe-area-inset-bottom)); }
    .footer-inner { padding: 16px 16px 14px; gap: 16px; flex-direction: column; align-items: stretch; }
    .footer-terms { flex-shrink: 1; }
    /* 2026-08-17: 기존 13px는 모바일 타이포 스케일 어디에도 정확히 대응하지 않는
       하드코딩값이었음(script-12/14B 사이) — 한 단계 큰 토큰(--text-m-body-16B,
       16px Bold)으로 교체, PC 기본값(16px)과도 동일해짐 */
    .footer-terms-text { font: var(--text-m-body-16B); white-space: normal; }
    /* 2026-08-18: 기존 15px 하드코딩값을 한 단계 큰 토큰(--text-m-title-18B, 18px Bold)으로 교체 */
    .footer-cta { flex: none; width: 100%; height: 56px; font: var(--text-m-title-18B); }
    .price-detail-list { padding: 0 10px; }
    /* 모바일 letter-spacing (m-body_com_16b: -0.5px, m-titie_com_18b: -0.3px) */
    .product-name { letter-spacing: -0.3px; }
    .form-section-label { letter-spacing: -0.5px; }
    .form-check-label { letter-spacing: -0.5px; }
    .coupon-label { letter-spacing: -0.5px; }
    .coupon-expiry { letter-spacing: -0.5px; }
    .price-row-label { letter-spacing: -0.5px; }
    .price-row-val { letter-spacing: -0.5px; }
    /* 2026-08-18: 모바일 반응형 — 폰트 한 단계 큰 토큰(하드코딩 12px → --text-m-script-14B
       14px Bold, 기존 font-weight:700과 동일 weight 유지) + BG 패딩 확대(8px 12px → 12px 20px) */
    /* 2026-08-18(후속): 상하 패딩만 20% 축소(12px → 9.6px), 좌우 20px는 유지 */
    .combo-btn { padding: 9.6px 20px; }
    .combo-label { font: var(--text-m-script-14B); }
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
    /* front-uiux.md §4 "카드(대)" Mobile값 — 30px. 이 컴포넌트는 @media(min-width:641px)
       에서 display:none이라 PC에는 노출되지 않으므로 항상 Mobile값(30px)을 쓴다(2026-08-17
       Stephen 확정 — .order-card/.item-card와 같은 "카드(대)" 계열, PC값 50px는 여기 해당 없음) */
    border-radius: 30px;
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
  /* 닫힘 상태에선 .bulk-body(border-top로 이어지는 하단 여백 16px)가 없어 pill 전체의
     하단 여백만 상단(30px)보다 좁아 보이던 문제 — 닫힘 상태에 한해 상하 패딩 대칭(2026-08-17) */
  .bulk-head-closed { padding-bottom: 30px; }
  .bulk-head-title {
    /* 2026-08-17: 카드 자체는 큰 pill(min-height:54px+상하 넉넉한 패딩)인데 라벨만
       가장 작은 타이포 토큰(14px)이라 속이 빈 것처럼 어정쩡해 보이던 문제 — 다른
       섹션 헤더(.sec-title 등)와 동일한 소제목 톤인 18px Bold로 확대 */
    font: var(--text-m-title-18B);
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
