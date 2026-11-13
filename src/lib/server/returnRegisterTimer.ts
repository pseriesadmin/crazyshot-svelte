/**
 * 반납정보 등록요청 '발송 시간' — cms_settings['return_registration_timer'] = { visit, quick, locker } (2026-11-13, Stephen 지시)
 * 값은 CMS "푸시알림 설정 > 반납 접수 요청" 행에서 manager 이상이 수정하고, 크론(/api/cron/return-notice)이 읽어 발송한다.
 * 세 칸 모두 비면 설정 행을 삭제한다(= 방문·퀵·무인함 등록요청 없음).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EMPTY_RETURN_REGISTER_TIMER, RETURN_REGISTER_TIMER_KEY, parseReturnRegisterTimer, type ReturnRegisterTimer } from '$lib/utils/returnRegisterTimer'

export async function getReturnRegisterTimer(admin: SupabaseClient): Promise<ReturnRegisterTimer> {
  try {
    const { data } = await admin.from('cms_settings').select('value').eq('key', RETURN_REGISTER_TIMER_KEY).maybeSingle()
    return parseReturnRegisterTimer((data as { value?: unknown } | null)?.value)
  } catch {
    return { ...EMPTY_RETURN_REGISTER_TIMER } // 조회 실패는 "보내지 않음" — 기존 반납 안내에는 영향 없음
  }
}
