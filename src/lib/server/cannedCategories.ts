// cannedCategories.ts — 빠른답변 분류 목록 로더(서버 전용). DB(canned_response_categories) 우선, 실패·누락 시 기본 6개로 폴백한다.
import { DEFAULT_CANNED_CATEGORIES, sensitiveKeys, sortCategories, type CannedCategory } from '$lib/constants/cannedResponseCategories'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** DB 행 → 분류 목록. 기본 6개가 하나라도 빠졌으면 기본값으로 채운다(안전 폴백) */
export function mergeWithDefaults(rows: readonly Partial<CannedCategory>[] | null | undefined): CannedCategory[] {
  const out: CannedCategory[] = []
  const seen = new Set<string>()
  for (const r of rows ?? []) {
    if (!r || typeof r.value !== 'string' || typeof r.label !== 'string' || seen.has(r.value)) continue
    seen.add(r.value)
    out.push({
      value: r.value, label: r.label, sort_order: typeof r.sort_order === 'number' ? r.sort_order : 0,
      is_system: r.is_system === true, is_active: r.is_active !== false, human_only: r.human_only === true, ai_allowed: r.ai_allowed === true,
    })
  }
  for (const d of DEFAULT_CANNED_CATEGORIES) if (!seen.has(d.value)) out.push({ ...d })
  // 기본 분류의 민감 여부는 항상 코드 기준(DB 값이 어긋나도 파손·CS는 민감)
  return sortCategories(out.map((c) => {
    const d = DEFAULT_CANNED_CATEGORIES.find((x) => x.value === c.value)
    const human_only = d ? d.human_only : c.human_only
    return { ...c, ...(d ? { is_system: true } : {}), human_only, ai_allowed: human_only ? false : c.ai_allowed }
  }))
}

export async function loadCannedCategories(admin: AdminClient): Promise<CannedCategory[]> {
  try {
    const BASE = 'value, label, sort_order, is_system, is_active, human_only'
    let { data, error } = await admin.from('canned_response_categories').select(`${BASE}, ai_allowed`)
    // ai_allowed 컬럼이 아직 없는 환경(Migration #682 적용 전)은 기본 컬럼만으로 읽는다
    if (error) ({ data, error } = await admin.from('canned_response_categories').select(BASE))
    if (error) return mergeWithDefaults(null)
    return mergeWithDefaults(data as Partial<CannedCategory>[])
  } catch {
    return mergeWithDefaults(null)
  }
}

/** 새로 배정할 수 있는 분류인가(빈 값=분류 없음은 허용, 존재하고 활성인 분류만) */
export function isAssignableCategory(value: string | null | undefined, list: readonly CannedCategory[]): boolean {
  if (!value) return true
  return list.some((c) => c.value === value && c.is_active)
}

// 자동답변 경로용 민감 분류 키 — 60초 캐시, 실패 시 기본(파손·CS)
const SENSITIVE_TTL_MS = 60_000
let sensitiveCache: { keys: Set<string>; at: number } | null = null
export async function loadSensitiveCategoryKeys(admin: AdminClient, now: () => number = Date.now): Promise<Set<string>> {
  if (sensitiveCache && now() - sensitiveCache.at < SENSITIVE_TTL_MS) return sensitiveCache.keys
  const keys = new Set(sensitiveKeys(await loadCannedCategories(admin)))
  sensitiveCache = { keys, at: now() }
  return keys
}
export function resetSensitiveCategoryCache(): void { sensitiveCache = null }
