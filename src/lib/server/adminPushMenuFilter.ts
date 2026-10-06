// adminPushMenuFilter.ts — 관리자 푸시 수신자에 "계정별 메뉴 권한 OFF" 반영 (메뉴권한 서버 집행 1단계 1h, 2026-10-05)
//
// get_admin_push_recipients RPC(cms_role 보유 + 알림 설정 ON)는 본문을 바꾸지 않고, 받은 수신자 목록에서
// 해당 이벤트의 메뉴 권한이 OFF(cms_menu_permissions.allowed=false)인 계정만 앱 코드에서 제외한다(DB 마이그레이션 없음).
// 좁히기 전용: allowed=true 오버라이드는 수신자를 늘리지 않는다.
// 전제: RPC가 돌려주는 수신자 id(user_profiles.id)와 cms_menu_permissions.user_id(auth.users.id)는 같은 값이다(handle_new_user가 id=NEW.id로 생성 — notification_tokens 경로도 같은 가정).
// ⚠️ 조회 실패는 fail-open(전원 유지) — 푸시는 "발송 누락"이 "과다 발송"보다 위험하다. 화면·API·액션 게이트(requireMenuAccess)는 fail-closed로 별개 정책.
import type { SupabaseClient } from '@supabase/supabase-js'

/** 푸시 이벤트 키 → 그 알림을 받으려면 필요한 메뉴 키(매핑 없는 이벤트는 필터 없음) */
export const ADMIN_PUSH_EVENT_MENU_KEYS: Record<string, string | undefined> = {
  new_session: 'consulting.chat',
  urgent_chat_message: 'consulting.chat',
  // 2-B(Stephen 권장안 2026-10-06): 예약·결제·서명 알림은 예약대여현황, 본인증명 승인요청은 고객목록 권한을 따른다
  new_reservation: 'rental.reservation',
  payment_completed: 'rental.reservation',
  contract_signed: 'rental.reservation',
  identity_review: 'customers.list',
}

export async function filterAdminPushRecipientsByMenu(
  supabase: SupabaseClient,
  eventKey: string,
  recipientIds: string[],
): Promise<string[]> {
  const menuKey = ADMIN_PUSH_EVENT_MENU_KEYS[eventKey]
  if (!menuKey || recipientIds.length === 0) return recipientIds
  try {
    const { data, error } = await supabase
      .from('cms_menu_permissions')
      .select('user_id')
      .eq('menu_key', menuKey)
      .eq('allowed', false)
      .in('user_id', recipientIds)
    if (error || !data) {
      console.error('[adminPushMenuFilter] 메뉴권한 조회 실패 — 필터 없이 발송(fail-open):', error?.message ?? 'no data')
      return recipientIds
    }
    const blocked = new Set((data as { user_id: string }[]).map((r) => r.user_id))
    return recipientIds.filter((id) => !blocked.has(id))
  } catch (e) {
    console.error('[adminPushMenuFilter] 메뉴권한 조회 예외 — 필터 없이 발송(fail-open):', e instanceof Error ? e.message : e)
    return recipientIds
  }
}
