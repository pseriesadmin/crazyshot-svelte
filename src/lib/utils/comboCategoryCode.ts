/**
 * comboCategoryCode.ts
 * 조합코드(combo) 분류코드를 TIER_ORDER(대→중→소)로 정렬 후 합산해 category_code_override를 빌드.
 *
 * 버그 수정 배경 (2026-08-12):
 *   - 기존 new/+page.server.ts 는 product_category_codes 를 depth 내림차순 limit(1)로
 *     단 한 개만 골라 p_code_id로 전달했다.
 *   - 반면 _AutoMappingTab.svelte / new/+page.svelte 의 미리보기 함수
 *     (comboCatCode / comboCatCodeStr) 는 콤보 전체 코드를 TIER_ORDER 순으로 합산한다.
 *   - 이 유틸이 두 곳 모두에서 동일 로직을 공유하도록 단일 소스로 추출.
 *
 * ⛔ 이 파일은 순수 유틸(side-effect 없음) — DB 호출, Supabase import 없음.
 */

export const COMBO_TIER_ORDER: Record<string, number> = { major: 0, middle: 1, minor: 2 }

/**
 * depth 값에서 code_tier를 유추 (code_tier 컬럼이 없는 레거시 데이터용 폴백).
 * Migration 84 백필 로직과 동일.
 */
function depthToTier(depth: number): string {
  if (depth === 0) return 'major'
  if (depth === 1) return 'middle'
  return 'minor'
}

export type ComboCode = {
  id: string
  code: string
  code_tier?: string | null
  depth?: number
}

/**
 * 콤보 코드 배열을 TIER_ORDER(대분류→중분류→소분류)로 정렬한다.
 * code_tier 가 있으면 우선 사용, 없으면 depth로 폴백.
 */
export function sortByTier(codes: ComboCode[]): ComboCode[] {
  return [...codes].sort((a, b) => {
    const tierA = a.code_tier ?? depthToTier(a.depth ?? 0)
    const tierB = b.code_tier ?? depthToTier(b.depth ?? 0)
    return (COMBO_TIER_ORDER[tierA] ?? 2) - (COMBO_TIER_ORDER[tierB] ?? 2)
  })
}

/**
 * 조합코드의 분류코드 문자열을 빌드한다.
 * TIER_ORDER(대→중→소) 정렬 후 code를 순서대로 합산해 대문자로 반환.
 *
 * 예) [{ code: 'SLR', code_tier: 'minor' }, { code: 'CAM', code_tier: 'major' }]
 *     → 'CAMSLR'
 */
export function buildComboCategoryCode(codes: ComboCode[]): string {
  return sortByTier(codes)
    .map(c => c.code)
    .filter(Boolean)
    .join('')
    .toUpperCase()
}

/**
 * TIER_ORDER 기준 가장 앞(대분류 = root) 코드를 반환한다.
 * p_code_id (code_rule 조회용)에 사용.
 */
export function getRootCode(codes: ComboCode[]): ComboCode | null {
  const sorted = sortByTier(codes)
  return sorted[0] ?? null
}
