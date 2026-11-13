/**
 * 무인보관함 안내 '추가 자동 발송 시간' — cms_settings['locker_guide_timer'] = { pickup, return } (2026-11-13, Stephen 지시)
 * 값은 CMS "푸시알림 설정 > 무인보관함 수령정보 안내 / 반납정보 제공안내" 행에서 manager 이상이 수정하고, 크론(/api/cron/locker-guide)이 읽어 추가 발송한다.
 * 두 칸 모두 비면 설정 행을 삭제한다(= 추가 발송 없음).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EMPTY_LOCKER_TIMER, LOCKER_TIMER_KEY, parseLockerGuideTimer, type LockerGuideTimer } from '$lib/utils/lockerGuideTimer'

export async function getLockerGuideTimer(admin: SupabaseClient): Promise<LockerGuideTimer> {
  try {
    const { data } = await admin.from('cms_settings').select('value').eq('key', LOCKER_TIMER_KEY).maybeSingle()
    return parseLockerGuideTimer((data as { value?: unknown } | null)?.value)
  } catch {
    return { ...EMPTY_LOCKER_TIMER } // 조회 실패는 "추가 발송 없음" — 기본 1시간 전 발송에는 영향 없음
  }
}
