import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { chargeSubscription } from '$lib/server/subscriptions/chargeSubscription'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 20
const MAX_BATCHES = 25 // 최대 500건/실행 — Vercel 함수 시간제한 안전마진

interface ClaimedSubscription {
  id: number
  user_id: string
  plan_id: number
  billing_key: string
  monthly_price: number
  plan_name: string
}

// GET /api/cron/subscription-billing — Vercel Cron 전용(매일 1회, vercel.json crons 참고).
// 정기 재청구: claim_subscriptions_due_for_billing으로 청구 대상을 원자적으로 선점한 뒤
// chargeSubscription()(최초가입 결제와 공유하는 진입점)을 순차 호출한다.
export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed) — "시크릿 없으면 전체 허용"은 절대 금지
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  // 정기결제(빌링, mid=bill_crazyhevr) 전용 시크릿 키 — 단건결제(mid=crazysfc8s) 키와 별개
  const tossSecretKey = env.TOSS_BILLING_SECRET_KEY
  if (!serviceRoleKey || !tossSecretKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: { userSubscriptionId: number; error: string }[] = []

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_subscriptions_due_for_billing', {
      p_limit: BATCH_SIZE,
      p_stale_minutes: 10,
    })

    if (claimError) {
      errors.push({ userSubscriptionId: -1, error: claimError.message })
      break
    }

    const claimedRows = (claimed ?? []) as ClaimedSubscription[]
    if (claimedRows.length === 0) break

    for (const sub of claimedRows) {
      processed++
      // 한 건의 실패(Toss API 오류·네트워크 예외)가 나머지 배치 처리를 막지 않도록 개별 격리
      try {
        const result = await chargeSubscription(admin, {
          userSubscriptionId: sub.id,
          billingKey: sub.billing_key,
          customerKey: sub.user_id,
          amount: sub.monthly_price,
          orderName: `${sub.plan_name} 정기구독`,
          tossSecretKey,
        })
        if (result.success) succeeded++
        else {
          failed++
          errors.push({ userSubscriptionId: sub.id, error: result.error ?? '알 수 없는 오류' })
        }
      } catch (err) {
        failed++
        errors.push({
          userSubscriptionId: sub.id,
          error: err instanceof Error ? err.message : '알 수 없는 예외',
        })
      }
    }

    if (claimedRows.length < BATCH_SIZE) break // 마지막 배치(더 이상 청구 대상 없음)
  }

  return json({ processed, succeeded, failed, errors })
}
