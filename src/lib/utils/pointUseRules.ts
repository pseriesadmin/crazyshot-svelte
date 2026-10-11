/**
 * 포인트 사용 규칙 — 화면용 정본 계산 (2026-10-04)
 *
 * 서버 정본: SQL 함수 public.normalize_point_use (Migration #639). 이 유틸은 같은 순서를 그대로 따른다.
 *   OFF면 0 → 보유 포인트·결제금액 상한 → 최대 사용 비율 상한 → 사용 단위 내림 → 최소 사용 포인트 미만이면 0
 * 두 곳은 항상 함께 바꿀 것(서버는 화면 값을 믿지 않고 같은 규칙으로 다시 보정한다).
 */
export interface PointUseRules {
  useEnabled: boolean
  minUsePoints: number
  useUnit: number
  /** 결제금액 대비 최대 사용 비율(%) 0~100 */
  maxUseRatio: number
}

/** 설정이 없을 때의 기본값 = 규칙이 도입되기 전의 동작 */
export const DEFAULT_POINT_USE_RULES: PointUseRules = {
  useEnabled: true,
  minUsePoints: 0,
  useUnit: 1,
  maxUseRatio: 100,
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** get_point_use_settings RPC 응답(스네이크 케이스) → PointUseRules. 잘못된 값은 기본값/범위로 보정 */
export function parsePointUseRules(raw: unknown): PointUseRules {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POINT_USE_RULES }
  const r = raw as Record<string, unknown>
  return {
    useEnabled: r.use_enabled === false ? false : true,
    minUsePoints: Math.max(0, toInt(r.min_use_points, 0)),
    useUnit: Math.max(1, toInt(r.use_unit, 1)),
    maxUseRatio: Math.min(100, Math.max(0, toInt(r.max_use_ratio, 100))),
  }
}

export interface PointUseInput {
  /** 사용자가 쓰려는 포인트 */
  requested: number
  /** 보유 포인트 */
  balance: number
  /** 포인트 적용 전 결제금액(멤버십·쿠폰 반영 후, 배송비 포함) */
  payable: number
}

/** 허용되는 포인트 사용량 */
export function normalizePointUse(rules: PointUseRules, input: PointUseInput): number {
  if (!rules.useEnabled) return 0
  let cap = Math.max(0, Math.trunc(Number(input.requested) || 0))
  if (cap === 0) return 0
  const balance = Math.max(0, Math.trunc(Number(input.balance) || 0))
  const pay = Math.max(0, Math.floor(Number(input.payable) || 0))
  cap = Math.min(cap, balance, pay)
  if (rules.maxUseRatio < 100) cap = Math.min(cap, Math.floor((pay * rules.maxUseRatio) / 100))
  if (rules.useUnit > 1) cap = Math.floor(cap / rules.useUnit) * rules.useUnit
  if (cap < rules.minUsePoints) return 0
  return cap
}

/** "모두 사용" 등에 쓰는 최대 사용 가능 포인트(요청량 무제한 기준) */
export function maxUsablePoints(rules: PointUseRules, balance: number, payable: number): number {
  return normalizePointUse(rules, { requested: Number.MAX_SAFE_INTEGER, balance, payable })
}

/** 고객 화면 안내 문구 목록(해당하는 규칙만) */
export function describePointUseRules(rules: PointUseRules): string[] {
  if (!rules.useEnabled) return ['현재 포인트를 사용할 수 없어요.']
  const notes: string[] = []
  if (rules.minUsePoints > 0) notes.push(`${rules.minUsePoints.toLocaleString('ko-KR')}P 이상부터 사용할 수 있어요.`)
  if (rules.useUnit > 1) notes.push(`${rules.useUnit.toLocaleString('ko-KR')}P 단위로 사용할 수 있어요.`)
  if (rules.maxUseRatio < 100) notes.push(`결제 금액의 최대 ${rules.maxUseRatio}%까지 사용할 수 있어요.`)
  return notes
}
