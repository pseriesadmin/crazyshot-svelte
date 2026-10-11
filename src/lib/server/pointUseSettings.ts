import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_POINT_USE_RULES, parsePointUseRules, type PointUseRules } from '$lib/utils/pointUseRules'

/**
 * 포인트 사용 규칙(CMS 설정) 조회 — get_point_use_settings RPC(Migration #639, anon/authenticated 읽기 가능).
 * 조회 실패 시에도 결제 흐름을 막지 않도록 기본 규칙(규칙 도입 전 동작)으로 폴백한다 — 서버는 어차피 주문 저장 시
 * 같은 규칙으로 다시 보정하므로(normalize_point_use) 화면이 기본값으로 보여도 우회가 되지 않는다.
 */
export async function loadPointUseRules(supabase: SupabaseClient): Promise<PointUseRules> {
  try {
    const { data, error } = await supabase.rpc('get_point_use_settings')
    if (error) {
      console.error('[pointUseSettings] get_point_use_settings 실패:', error.message)
      return { ...DEFAULT_POINT_USE_RULES }
    }
    return parsePointUseRules(data)
  } catch (err) {
    console.error('[pointUseSettings] 예외:', err instanceof Error ? err.message : err)
    return { ...DEFAULT_POINT_USE_RULES }
  }
}
