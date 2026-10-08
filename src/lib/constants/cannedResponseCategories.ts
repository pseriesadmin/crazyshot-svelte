// 빠른답변(캔드 리스폰스) 분류 — 기본 6개(시스템) + 관리자가 설정에서 추가하는 분류
// 기본 분류는 코드가 의미를 알고 있다(파손·CS = 민감 분류). 추가 분류는 DB(canned_response_categories, Migration #681)에 저장된다.
// 목록은 서버가 읽어 화면에 내려주며, 이 파일의 순수 함수는 서버·화면 어디서든 쓴다.

export interface CannedCategory {
  /** DB에 저장되는 키. 기본 분류는 고정 영문, 추가 분류는 c1, c2… */
  value: string
  label: string
  sort_order: number
  /** 기본(시스템) 분류 — 삭제 불가, 키 변경 불가(이름·순서·노출만 변경) */
  is_system: boolean
  is_active: boolean
  /** 민감 분류: 이 분류의 빠른답변이 자동으로 나가면 상담원에게 알린다(기본: 파손·CS) */
  human_only: boolean
  /** 크레이지챗 AI가 답해도 되는 분류(민감 분류는 불가, 켜짐 변경은 슈퍼마스터 전용) */
  ai_allowed: boolean
}

export const DEFAULT_CANNED_CATEGORIES: readonly CannedCategory[] = [
  { value: 'return', label: '반납', sort_order: 1, is_system: true, is_active: true, human_only: false, ai_allowed: false },
  { value: 'payment', label: '결제', sort_order: 2, is_system: true, is_active: true, human_only: false, ai_allowed: false },
  { value: 'reservation', label: '예약', sort_order: 3, is_system: true, is_active: true, human_only: false, ai_allowed: false },
  { value: 'damage', label: '파손', sort_order: 4, is_system: true, is_active: true, human_only: true, ai_allowed: false },
  { value: 'general', label: '기타', sort_order: 5, is_system: true, is_active: true, human_only: false, ai_allowed: false },
  { value: 'cs', label: 'CS', sort_order: 6, is_system: true, is_active: true, human_only: true, ai_allowed: false },
]

/** 하위 호환: 기본 6개 기준 목록(기존 코드가 목록을 아직 받지 못하는 곳용) */
export const CANNED_RESPONSE_CATEGORIES = DEFAULT_CANNED_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))

export type CannedResponseCategory = string

export const VALID_CATEGORIES: string[] = DEFAULT_CANNED_CATEGORIES.map((c) => c.value)

export const MAX_CATEGORY_LABEL_LENGTH = 10

/** 목록을 주면 그 목록(추가 분류·바뀐 이름 포함)으로, 안 주면 기본 6개로 이름을 찾는다. 없으면 '기타' */
export function getCategoryLabel(value: string | null | undefined, list: readonly CannedCategory[] = DEFAULT_CANNED_CATEGORIES): string {
  if (!value) return '기타'
  return list.find((c) => c.value === value)?.label ?? '기타'
}

/** 추가 분류의 키 — 기존 목록에서 아직 안 쓴 c1, c2… 중 가장 작은 번호 다음 값 */
export function makeCategoryKey(list: readonly CannedCategory[]): string {
  const used = new Set(list.map((c) => c.value))
  let max = 0
  for (const c of list) {
    const m = /^c(\d+)$/.exec(c.value)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

const squash = (s: string): string => s.replace(/\s+/g, '').toLowerCase()

/** 분류 이름 검증: 앞뒤 공백 정리 후 1~10자, 다른 분류와 중복 금지(공백·대소문자 무시). selfValue는 수정 중인 자기 자신 */
export function validateCategoryLabel(raw: string, list: readonly CannedCategory[], selfValue?: string): { ok: true; label: string } | { ok: false; error: string } {
  const label = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!label) return { ok: false, error: '분류 이름을 입력해 주세요.' }
  if (label.length > MAX_CATEGORY_LABEL_LENGTH) return { ok: false, error: `분류 이름은 ${MAX_CATEGORY_LABEL_LENGTH}자 이내로 입력해 주세요.` }
  if (list.some((c) => c.value !== selfValue && squash(c.label) === squash(label))) return { ok: false, error: '이미 있는 분류 이름입니다.' }
  return { ok: true, label }
}

export function sortCategories(list: readonly CannedCategory[], opts: { activeOnly?: boolean } = {}): CannedCategory[] {
  return [...list]
    .filter((c) => (opts.activeOnly ? c.is_active : true))
    .sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value))
}

/** AI가 답해도 되는 분류 키(활성 + 허용 표시 + 민감 아님), 순서대로 */
export function aiAllowedKeys(list: readonly CannedCategory[]): string[] {
  return sortCategories(list).filter((c) => c.is_active && c.ai_allowed && !c.human_only).map((c) => c.value)
}

/** 민감 분류 키 목록(비활성이어도 안전 쪽으로 유지) */
export function sensitiveKeys(list: readonly CannedCategory[]): string[] {
  return sortCategories(list).filter((c) => c.human_only).map((c) => c.value)
}

// ── 설정 변경 계획(서버 API가 그대로 집행한다) ───────────────────────────────────
export type CategoryChange =
  | { type: 'add'; label: string; human_only?: boolean }
  | { type: 'update'; value: string; label?: string; is_active?: boolean; human_only?: boolean; ai_allowed?: boolean; sort_order?: number }
  | { type: 'delete'; value: string }
  /** 드래그로 바꾼 전체 순서(모든 분류를 한 번씩) */
  | { type: 'reorder'; order: string[] }

export type CategoryPlan =
  | { ok: true; action: 'insert'; row: CannedCategory }
  | { ok: true; action: 'update'; value: string; patch: Partial<Pick<CannedCategory, 'label' | 'is_active' | 'human_only' | 'ai_allowed' | 'sort_order'>> }
  | { ok: true; action: 'delete'; value: string }
  | { ok: true; action: 'reorder'; sorted: { value: string; sort_order: number }[] }
  | { ok: false; error: string }

/** 분류 설정 변경의 허용 규칙: 기본 분류는 이름·순서만, 추가 분류는 전부, 삭제는 추가 분류가 미사용일 때만 */
export function planCategoryChange(list: readonly CannedCategory[], change: CategoryChange, ctx: { usage?: number } = {}): CategoryPlan {
  if (change.type === 'add') {
    const v = validateCategoryLabel(change.label, list)
    if (!v.ok) return v
    const sort_order = Math.max(0, ...list.map((c) => c.sort_order)) + 1
    return { ok: true, action: 'insert', row: { value: makeCategoryKey(list), label: v.label, sort_order, is_system: false, is_active: true, human_only: change.human_only === true, ai_allowed: false } }
  }
  if (change.type === 'reorder') {
    const have = new Set(list.map((c) => c.value))
    const seen = new Set(change.order)
    if (change.order.length !== have.size || seen.size !== change.order.length || change.order.some((v) => !have.has(v))) {
      return { ok: false, error: '순서 목록이 올바르지 않습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' }
    }
    return { ok: true, action: 'reorder', sorted: change.order.map((value, i) => ({ value, sort_order: i + 1 })) }
  }
  const target = list.find((c) => c.value === change.value)
  if (!target) return { ok: false, error: '없는 분류입니다.' }
  if (change.type === 'delete') {
    if (target.is_system) return { ok: false, error: '기본 분류는 삭제할 수 없습니다.' }
    if ((ctx.usage ?? 0) > 0) return { ok: false, error: `이 분류를 쓰는 빠른답변이 ${ctx.usage}건 있어 삭제할 수 없습니다. 먼저 다른 분류로 옮겨 주세요.` }
    return { ok: true, action: 'delete', value: target.value }
  }
  const patch: Partial<Pick<CannedCategory, 'label' | 'is_active' | 'human_only' | 'ai_allowed' | 'sort_order'>> = {}
  if (change.label !== undefined) {
    const v = validateCategoryLabel(change.label, list, target.value)
    if (!v.ok) return v
    patch.label = v.label
  }
  if (change.sort_order !== undefined) {
    if (!Number.isInteger(change.sort_order) || change.sort_order < 0) return { ok: false, error: '순서 값이 올바르지 않습니다.' }
    patch.sort_order = change.sort_order
  }
  if (change.is_active !== undefined) {
    if (target.is_system && change.is_active === false) return { ok: false, error: '기본 분류는 숨길 수 없습니다.' }
    patch.is_active = change.is_active
  }
  if (change.human_only !== undefined) {
    if (target.is_system && change.human_only !== target.human_only) return { ok: false, error: '기본 분류의 민감 여부는 바꿀 수 없습니다.' }
    patch.human_only = change.human_only
  }
  const willBeSensitive = patch.human_only ?? target.human_only
  if (change.ai_allowed !== undefined) {
    if (change.ai_allowed && willBeSensitive) return { ok: false, error: '민감 분류는 AI가 답하도록 허용할 수 없습니다.' }
    patch.ai_allowed = change.ai_allowed
  } else if (willBeSensitive && target.ai_allowed) {
    patch.ai_allowed = false
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: '바꿀 내용이 없습니다.' }
  return { ok: true, action: 'update', value: target.value, patch }
}
