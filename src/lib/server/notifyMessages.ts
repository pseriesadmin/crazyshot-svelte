// src/lib/server/notifyMessages.ts
// 고객 알림 안내문장(CMS 편집값) 조회 — push_notification_config.extra_config.message
// 비어 있거나 조회에 실패하면 null(= 코드의 기본 문구 사용, fail-open → 지금과 동일 동작).
import type { SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 30_000

let cache: { at: number; map: Map<string, string> } | null = null

/** extra_config(JSONB)에서 안내문장만 꺼낸다. 문자열이 아니거나 공백뿐이면 null. */
export function readMessageFromExtraConfig(extra: unknown): string | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null
  const raw = (extra as Record<string, unknown>).message
  if (typeof raw !== 'string') return null
  return raw.trim() === '' ? null : raw
}

/** 저장 직후 같은 서버 인스턴스의 캐시를 비운다(다른 인스턴스는 TTL 안에 자연 갱신). */
export function clearNotifyMessageCache(): void {
  cache = null
}

/**
 * 알림 유형의 편집된 안내문장. 설정 행 전체를 한 번 읽어 30초간 캐시한다(크론 배치의 반복 조회 방지).
 * 푸시 발송 경로(sendPushToUser)는 이미 설정 행을 읽으므로 이 함수를 거치지 않고 extra_config를 직접 쓴다.
 */
export async function getNotifyMessageOverride(admin: SupabaseClient, notifyType: string): Promise<string | null> {
  try {
    const now = Date.now()
    if (!cache || now - cache.at > TTL_MS) {
      const { data, error } = await admin.from('push_notification_config').select('notify_type, extra_config')
      if (error || !data) return null
      const map = new Map<string, string>()
      for (const row of data as { notify_type: string; extra_config: unknown }[]) {
        const msg = readMessageFromExtraConfig(row.extra_config)
        if (msg) map.set(row.notify_type, msg)
      }
      cache = { at: now, map }
    }
    return cache.map.get(notifyType) ?? null
  } catch {
    return null
  }
}
