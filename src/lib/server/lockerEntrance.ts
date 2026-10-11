/**
 * 무인보관함 "중앙현관 비밀번호" — cms_settings['locker_entrance_password'].password (2026-10-11, Stephen 확정)
 * 채팅카드(DB 함수 send_rental_chat_notification)·문자(buildLockerGuideSms)·푸시 안내문장 변수가 모두 이 값을 읽는다.
 * 값이 비어 있으면 안내에서 그 줄/변수를 비운다. 값은 CMS "푸시알림 설정" 화면에서 manager 이상이 수정한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const LOCKER_ENTRANCE_KEY = 'locker_entrance_password'

export async function getLockerEntrancePassword(admin: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await admin.from('cms_settings').select('value').eq('key', LOCKER_ENTRANCE_KEY).maybeSingle()
    const raw = (data as { value?: { password?: unknown } | null } | null)?.value?.password
    const pw = typeof raw === 'string' ? raw.trim() : ''
    return pw === '' ? null : pw
  } catch {
    return null // 조회 실패는 "설정 없음"으로 취급 — 안내 발송 자체를 막지 않는다
  }
}
