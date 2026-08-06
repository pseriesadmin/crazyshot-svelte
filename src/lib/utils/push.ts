// src/lib/utils/push.ts
// 클라이언트 FCM 토큰 로컬 추적 + 로그아웃 시 해지 헬퍼
import { supabase } from '$lib/services/supabase'
import { callTypedRpc } from '$lib/utils/rpc'

export const PUSH_TOKEN_STORAGE_KEY = 'cs-push-token-registered'

// 로그아웃 흐름에서 호출 — 실패해도 로그아웃 자체를 막지 않음
export async function unregisterCurrentPushToken(): Promise<void> {
  if (typeof window === 'undefined') return
  const token = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)
  if (!token) return

  try {
    await callTypedRpc(supabase, 'unregister_push_token', { p_token: token })
  } catch {
    // 무시 — 로그아웃은 계속 진행
  }
  window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY)
}
