// POST /api/webhooks/toss — 토스페이먼츠 웹훅 수신
// payment.md 패턴:
//   1. HMAC-SHA256 서명 검증
//   2. raw_webhook_logs 즉시 INSERT (service_role)
//   3. 즉시 200 OK 반환 (1초 이내 — Vercel 타임아웃 방지)
//   4. pg_cron이 백그라운드에서 processed=false 항목 처리 (다음 사이클)

import { createHmac } from 'crypto'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

function verifyTossSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string
): boolean {
  if (!signature) return false
  try {
    const computed = createHmac('sha256', secretKey)
      .update(rawBody)
      .digest('base64')
    return computed === signature
  } catch {
    return false
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) {
    // 키 미설정 → 웹훅 거부 (보안)
    return new Response('Server configuration error', { status: 500 })
  }

  // raw body를 텍스트로 먼저 읽어 서명 검증에 사용
  const rawBody = await request.text()
  const signature = request.headers.get('toss-payments-signature')

  // 1. HMAC-SHA256 서명 검증
  if (!verifyTossSignature(rawBody, signature, tossSecretKey)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. JSON 파싱
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const typedPayload = payload as Record<string, unknown>

  // 3. raw_webhook_logs INSERT (service_role — RLS 우회)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)

    // 비동기로 저장 (실패해도 200 반환 — 재전송 의존)
    admin
      .from('raw_webhook_logs')
      .insert({
        source:     'toss',
        event_type: (typedPayload.eventType as string) ?? null,
        payload:    typedPayload,
        signature:  signature,
        processed:  false,
      })
      .then(({ error }) => {
        if (error) {
          // 저장 실패 로그 (운영 모니터링용 — 토스가 재전송함)
          console.error('[webhook/toss] raw_webhook_logs insert failed:', error.message)
        }
      })
  }

  // 4. 즉시 200 OK (1초 이내 — Vercel + 토스 재전송 방지)
  return new Response('OK', { status: 200 })
}
