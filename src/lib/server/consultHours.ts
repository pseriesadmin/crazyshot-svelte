/**
 * 상담 응대시간 안내 — cms_settings['consult_hours_notice'] = { message, start, end } (2026-11-10, Stephen 지시)
 * 값은 CMS "푸시알림 설정 > 상담 응대시간" 탭에서 manager 이상이 수정하고, 고객 채팅창이 노출 시간대에만 문구를 보여준다.
 * 문구가 비어 있으면 설정을 삭제한다(= 노출 없음).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseConsultHours, type ConsultHours } from '$lib/utils/consultHours'

export const CONSULT_HOURS_KEY = 'consult_hours_notice'

export async function getConsultHours(admin: SupabaseClient): Promise<ConsultHours | null> {
  try {
    const { data } = await admin.from('cms_settings').select('value').eq('key', CONSULT_HOURS_KEY).maybeSingle()
    return parseConsultHours((data as { value?: unknown } | null)?.value)
  } catch {
    return null // 조회 실패는 "설정 없음" — 채팅 자체를 막지 않는다
  }
}
