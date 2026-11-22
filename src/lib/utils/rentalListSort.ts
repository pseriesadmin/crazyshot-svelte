// 예약대여현황(/cms/rentals) 탭별 정렬·필터 정의 — '예약대여현황 탭별 정렬·필터 정리 v1'(2026-11-20) 그대로.
// 실제 정렬·필터는 DB 함수 get_rental_list(Migration #842 p_sort·p_pickup_filter·p_return_filter·p_payment_stage)가 집행하고,
// 이 파일은 탭별 옵션 목록·기본값·URL 값 검증만 맡는다(옵션 키 이름이 SQL 정렬 키와 1:1).

export type RentalTabKey =
  | 'draft' | 'hold' | 'contract_pending' | 'confirmed' | 'shipped'
  | 'in_use' | 'returning' | 'inspection' | 'completed' | 'cancelled_refunded'

/** 표 헤더에서 정렬을 걸 수 있는 컬럼 — 표의 모든 컬럼(상태=전환 시점, 대여기간=수령·반납 예정일시) */
export type RentalSortColumn =
  | 'status' | 'code' | 'customer' | 'product' | 'productCode' | 'period'
  | 'pickupMethod' | 'returnMethod' | 'amount' | 'contract' | 'created'

export interface RentalSortOption {
  /** URL(?sort=) 값 */
  value: string
  label: string
  /** 이 정렬을 대표하는 표 헤더 컬럼 */
  column: RentalSortColumn
  /** 헤더 화살표 방향 — asc 위쪽(빠른·오래된 것 먼저), desc 아래쪽(최신 먼저) */
  dir: 'asc' | 'desc'
  /** get_rental_list p_sort 로 보낼 값 */
  rpc: string
  /** true 면 DB 정렬(전환 최신순) 뒤에 반납 진행 단계(예정→발송→등록)를 페이지 안에서 다시 정렬 */
  returnStage?: boolean
}

export type RentalFilterKind = 'pickup' | 'return' | 'payment'

export interface RentalFilterOption {
  value: string
  label: string
  /** DB 방식 값 — 방문픽업은 무인보관함도 포함 */
  match: string[]
}

export interface RentalFilterConfig {
  kind: RentalFilterKind
  label: string
  /** payment 는 단일 선택, 방식은 복수 선택 */
  multi: boolean
  options: RentalFilterOption[]
}

export interface RentalTabConfig {
  defaultSort: string
  /** true 면 어떤 정렬을 골라도 수령 지연 건을 맨 위에 고정(배송중 — CSV '지연건 최상단 고정'). DB p_sort 'pin:' 접두어 */
  pinDelayed?: boolean
  sorts: RentalSortOption[]
  filter?: RentalFilterConfig
}

const S = {
  createdDesc: { value: 'created_desc', label: '등록 최신순', rpc: 'created_desc', column: 'created', dir: 'desc' },
  createdAsc: { value: 'created_asc', label: '오래된 순', rpc: 'created_asc', column: 'created', dir: 'asc' },
  changedDesc: (label: string): RentalSortOption => ({ value: 'changed_desc', label, rpc: 'changed_desc', column: 'status', dir: 'desc' }),
  changedAsc: { value: 'changed_asc', label: '오래된 순', rpc: 'changed_asc', column: 'status', dir: 'asc' },
} as const satisfies Record<string, RentalSortOption | ((label: string) => RentalSortOption)>

const CRAZY: RentalFilterOption = { value: 'crazydelivery', label: '크레이지배송', match: ['crazydelivery'] }
const VISIT: RentalFilterOption = { value: 'visit', label: '방문픽업', match: ['visit', 'locker'] }
const QUICK: RentalFilterOption = { value: 'quick', label: '퀵서비스', match: ['quick'] }

export const RENTAL_TAB_CONFIG: Record<RentalTabKey, RentalTabConfig> = {
  draft: {
    defaultSort: 'created_desc',
    sorts: [S.createdDesc, S.createdAsc],
  },
  hold: {
    defaultSort: 'start_asc',
    sorts: [
      { value: 'start_asc', label: '대여 시작일 임박순', rpc: 'start_asc', column: 'period', dir: 'asc' },
      { value: 'created_desc', label: '최신 순', rpc: 'created_desc', column: 'created', dir: 'desc' },
      { value: 'created_asc', label: '오래된 순', rpc: 'created_asc', column: 'created', dir: 'asc' },
    ],
  },
  contract_pending: {
    defaultSort: 'start_asc',
    sorts: [
      { value: 'start_asc', label: '대여 시작일 임박순', rpc: 'start_asc', column: 'period', dir: 'asc' },
      S.changedDesc('예약 전환 최신 순'),
      S.changedAsc,
    ],
    filter: {
      kind: 'payment', label: '결제 상태', multi: false,
      options: [
        { value: 'unissued', label: '미발행', match: [] },
        { value: 'signed', label: '서명 완료', match: [] },
        { value: 'paying', label: '결제 진행 중', match: [] },
      ],
    },
  },
  confirmed: {
    defaultSort: 'pickup_asc',
    sorts: [
      { value: 'pickup_asc', label: '수령(출고) 예정일시순', rpc: 'pickup_asc', column: 'period', dir: 'asc' },
      S.changedDesc('계약완료 전환 최신 순'),
      S.changedAsc,
    ],
    filter: { kind: 'pickup', label: '출고 옵션', multi: true, options: [CRAZY, VISIT, QUICK] },
  },
  shipped: {
    defaultSort: 'delay_pickup_asc',
    pinDelayed: true,
    sorts: [{ value: 'delay_pickup_asc', label: '지연 우선 · 수령 예정일순', rpc: 'delay_pickup_asc', column: 'period', dir: 'asc' }],
    filter: { kind: 'pickup', label: '출고 옵션', multi: true, options: [CRAZY, QUICK] },
  },
  in_use: {
    defaultSort: 'delay_return_asc',
    sorts: [
      { value: 'delay_return_asc', label: '반납 지연 우선 · 반납 예정일시순', rpc: 'delay_return_asc', column: 'period', dir: 'asc' },
      S.changedDesc('대여중 전환 최신 순'),
      S.changedAsc,
    ],
    filter: { kind: 'return', label: '반납 옵션', multi: true, options: [CRAZY, VISIT, QUICK] },
  },
  returning: {
    // 반납 전환 최신순 + 같은 반납일(전환일) 안에서 방식순(크레이지배송 → 방문픽업 → 퀵서비스) — Stephen 확정(2026-11-21)
    defaultSort: 'changed_group_desc',
    sorts: [
      { value: 'changed_group_desc', label: '반납 전환 최신 순 · 같은 반납일 방식순', rpc: 'changed_group_desc', column: 'status', dir: 'desc' },
      { value: 'changed_group_asc', label: '반납 전환 오래된 순 · 같은 반납일 방식순', rpc: 'changed_group_asc', column: 'status', dir: 'asc' },
      { value: 'return_group_asc', label: '반납 예정일 · 방식순', rpc: 'return_group_asc', column: 'period', dir: 'asc' },
      { value: 'return_stage', label: '반납 진행 단계순', rpc: 'changed_desc', column: 'status', dir: 'desc', returnStage: true },
    ],
    // 무인보관함 반납은 이번 범위 제외(추후 추가)
    filter: { kind: 'return', label: '반납 옵션', multi: true, options: [CRAZY, VISIT, QUICK] },
  },
  inspection: {
    // 기본 = 등록일 역순(최신 등록 먼저), 필터 없음 — Stephen 확정(2026-11-21)
    defaultSort: 'created_desc',
    sorts: [S.createdDesc, S.createdAsc],
  },
  completed: {
    defaultSort: 'changed_desc',
    sorts: [S.changedDesc('완료 전환 최신 순'), S.changedAsc],
  },
  cancelled_refunded: {
    defaultSort: 'changed_desc',
    sorts: [S.changedDesc('전환 최신 순'), S.changedAsc],
  },
}

/** 화면 칩(status 값 + 계약대기 여부) → 탭 키. 알 수 없는 값은 null(정렬 지정 없음 = 기존 동작). */
export function rentalTabKeyOf(status: string, contractPending: boolean): RentalTabKey | null {
  if (status === 'hold') return contractPending ? 'contract_pending' : 'hold'
  // `in` 은 constructor·__proto__ 같은 프로토타입 키도 통과시켜 주소창 값으로 로더가 500 나므로 hasOwn 으로 검사한다
  if (Object.hasOwn(RENTAL_TAB_CONFIG, status)) return status as RentalTabKey
  return null
}

const opt = (value: string, label: string, column: RentalSortColumn, dir: 'asc' | 'desc'): RentalSortOption => ({ value, label, rpc: value, column, dir })

/** 모든 탭에서 쓸 수 있는 컬럼 기본 정렬(탭 전용 정렬이 없는 컬럼에 쓰인다) — 키 이름은 DB get_rental_list p_sort(#842~#844)와 같다 */
export const GENERIC_COLUMN_SORTS: Record<RentalSortColumn, RentalSortOption[]> = {
  status: [opt('changed_desc', '전환 최신 순', 'status', 'desc'), opt('changed_asc', '전환 오래된 순', 'status', 'asc')],
  code: [opt('code_asc', '예약번호 오름차순', 'code', 'asc'), opt('code_desc', '예약번호 내림차순', 'code', 'desc')],
  customer: [opt('customer_asc', '고객명 가나다순', 'customer', 'asc'), opt('customer_desc', '고객명 역순', 'customer', 'desc')],
  product: [opt('product_asc', '상품명 가나다순', 'product', 'asc'), opt('product_desc', '상품명 역순', 'product', 'desc')],
  productCode: [opt('pcode_asc', '상품코드 오름차순', 'productCode', 'asc'), opt('pcode_desc', '상품코드 내림차순', 'productCode', 'desc')],
  period: [opt('start_asc', '대여 시작일 임박순', 'period', 'asc'), opt('start_desc', '대여 시작일 먼 순', 'period', 'desc')],
  pickupMethod: [opt('pickup_method_asc', '수령방식순(크레이지배송 먼저)', 'pickupMethod', 'asc'), opt('pickup_method_desc', '수령방식 역순', 'pickupMethod', 'desc')],
  returnMethod: [opt('return_method_asc', '반납방식순(크레이지배송 먼저)', 'returnMethod', 'asc'), opt('return_method_desc', '반납방식 역순', 'returnMethod', 'desc')],
  amount: [opt('amount_asc', '결제금액 낮은 순', 'amount', 'asc'), opt('amount_desc', '결제금액 높은 순', 'amount', 'desc')],
  contract: [opt('contract_asc', '계약 미발행 먼저', 'contract', 'asc'), opt('contract_desc', '계약 서명완료 먼저', 'contract', 'desc')],
  created: [opt('created_desc', '신청일 최신 순', 'created', 'desc'), opt('created_asc', '신청일 오래된 순', 'created', 'asc')],
}

/** 탭 전용 대여기간 정렬 뒤에 붙는 반대 방향 */
const PERIOD_REVERSE: Partial<Record<RentalTabKey, RentalSortOption>> = {
  confirmed: opt('start_desc', '수령 예정일 먼 순', 'period', 'desc'),
  shipped: opt('start_desc', '수령 예정일 먼 순', 'period', 'desc'),
  in_use: opt('end_desc', '반납 예정일 먼 순', 'period', 'desc'),
  returning: opt('end_desc', '반납 예정일 먼 순', 'period', 'desc'),
}

/** 한 컬럼 헤더가 순환하는 정렬 옵션 — 탭 전용 옵션이 있으면 그것(대여기간은 반대 방향 추가), 없으면 컬럼 기본 정렬 */
export function sortOptionsForColumn(tab: RentalTabKey, column: RentalSortColumn): RentalSortOption[] {
  const own = RENTAL_TAB_CONFIG[tab].sorts.filter((s) => s.column === column)
  if (own.length === 0) return GENERIC_COLUMN_SORTS[column]
  const rev = column === 'period' ? PERIOD_REVERSE[tab] : undefined
  return rev && !own.some((o) => o.value === rev.value) ? [...own, rev] : own
}

/** 이 탭에서 URL(?sort=)로 받을 수 있는 모든 정렬 옵션(탭 전용 + 모든 컬럼) */
function allSortOptions(tab: RentalTabKey): RentalSortOption[] {
  const cols = Object.keys(GENERIC_COLUMN_SORTS) as RentalSortColumn[]
  const list = [...RENTAL_TAB_CONFIG[tab].sorts, ...cols.flatMap((c) => sortOptionsForColumn(tab, c))]
  return list.filter((o, i) => list.findIndex((x) => x.value === o.value) === i)
}

/** get_rental_list p_sort 로 보낼 값 — 지연건 고정 탭(배송중)은 기본 정렬 외 정렬에 'pin:' 을 붙인다(기본 정렬은 이미 지연 우선) */
export function rpcSortFor(tab: RentalTabKey, option: RentalSortOption | null): string | null {
  if (!option) return null
  return RENTAL_TAB_CONFIG[tab].pinDelayed && option.rpc !== 'delay_pickup_asc' ? `pin:${option.rpc}` : option.rpc
}

/** 정렬 값으로 옵션 찾기(탭 전용 + 모든 컬럼) — 화면이 현재 정렬 이름·방향을 표시할 때 쓴다 */
export function findRentalSortOption(tab: RentalTabKey, value: string | null | undefined): RentalSortOption | null {
  return allSortOptions(tab).find((o) => o.value === value) ?? null
}

/** ?sort= 값을 탭 옵션으로 검증 — 없거나 이 탭 옵션이 아니면 탭 기본 정렬. */
export function resolveRentalSort(tab: RentalTabKey, raw: string | null | undefined): RentalSortOption {
  const cfg = RENTAL_TAB_CONFIG[tab]
  return allSortOptions(tab).find((s) => s.value === raw) ?? cfg.sorts.find((s) => s.value === cfg.defaultSort) ?? cfg.sorts[0]
}

/** 컬럼 헤더를 눌렀을 때 적용할 정렬 — 지금 정렬이 그 컬럼 것이면 다음 옵션(끝이면 처음), 아니면 그 컬럼의 첫 옵션 */
export function nextSortForColumn(tab: RentalTabKey, current: string | null | undefined, column: RentalSortColumn): RentalSortOption | null {
  const opts = sortOptionsForColumn(tab, column)
  if (opts.length === 0) return null
  const idx = opts.findIndex((o) => o.value === current)
  return idx < 0 ? opts[0] : opts[(idx + 1) % opts.length]
}

export interface ResolvedRentalFilter {
  /** 화면에서 선택된 옵션 값(검증된 것만) */
  selected: string[]
  pickup: string[] | null
  return: string[] | null
  payment: string | null
}

/** ?filter=a,b 값을 탭 필터 옵션으로 검증하고 get_rental_list 인자로 변환 */
export function resolveRentalFilter(tab: RentalTabKey, raw: string | null | undefined): ResolvedRentalFilter {
  const empty: ResolvedRentalFilter = { selected: [], pickup: null, return: null, payment: null }
  const cfg = RENTAL_TAB_CONFIG[tab].filter
  if (!cfg || !raw) return empty
  const allowed = new Map(cfg.options.map((o) => [o.value, o]))
  let picked = [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => allowed.has(v)))]
  if (!cfg.multi) picked = picked.slice(0, 1)
  if (picked.length === 0) return empty
  if (cfg.kind === 'payment') return { ...empty, selected: picked, payment: picked[0] }
  const methods = [...new Set(picked.flatMap((v) => allowed.get(v)?.match ?? []))]
  return cfg.kind === 'pickup'
    ? { ...empty, selected: picked, pickup: methods }
    : { ...empty, selected: picked, return: methods }
}

/** 신청대기 '지연' 표시 — 대여 시작일(KST)이 오늘보다 앞선 건 */
export function isApplicationOverdue(rentalStart: string | null | undefined, now: Date = new Date()): boolean {
  const day = (rentalStart ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const today = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  return day < today
}
