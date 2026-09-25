// 쿠폰 선물 중복 방지 — 고객이 이미 보유(또는 사용)한 동일 쿠폰을 다시 선물하려 할 때
// 고객에게는 카드·푸시를 보내지 않고, 그 세션에 "관리자에게만 보이는"(admin_only) 경고 카드만 남긴다.
// (user_coupons는 (user_id, coupon_id) 유일 — 재선물은 어차피 배포되지 않으므로 알림만 막는다)
import type { SupabaseClient } from '@supabase/supabase-js'

export const COUPON_ALREADY_GIFTED_MESSAGE = '이미 선물한 쿠폰입니다.'

export async function isCouponAlreadyOwned(
  admin: SupabaseClient,
  userId: string,
  couponId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('user_coupons')
    .select('id')
    .eq('user_id', userId)
    .eq('coupon_id', couponId)
    .limit(1)
    .maybeSingle()
  return !!data
}

// 경고 카드 삽입(admin_only=true). 실패해도 null 반환(호출부 흐름 유지).
export async function insertDuplicateGiftWarning(
  admin: SupabaseClient,
  sessionId: string,
  discountLabel?: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      sender_type: 'admin',
      message_type: 'action_card',
      content: COUPON_ALREADY_GIFTED_MESSAGE,
      admin_only: true,
      is_read: false,
      action_payload: {
        type: 'coupon_duplicate_warning',
        ...(discountLabel ? { discount_label: discountLabel } : {}),
      },
    })
    .select()
    .single()
  if (error) return null
  await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId)
  return data as Record<string, unknown>
}
