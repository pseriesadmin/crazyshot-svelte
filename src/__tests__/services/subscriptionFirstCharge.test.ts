import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null

/**
 * 구독 첫 결제 정합성 (Migration 699) — Stage 실DB 라이브 테스트
 *
 * 배경(2026-10-12 최종 검증에서 Production 실데이터로 확인된 결함 2건):
 *   ① 가입 시 다음 청구일이 이미 "한 달 뒤"로 잡히는데, 가입 직후 첫 결제 성공을 기록하면서
 *      한 달을 또 더해 두 번째 청구일이 두 달 뒤로 밀렸다(한 달치 매출 누락).
 *   ② 첫 결제가 실패해도 구독이 active로 남아 한 달간 혜택을 받고, 재가입도 막혔다.
 *
 * 정책:
 *   - 첫 결제 성공은 다음 청구일을 더 밀지 않는다(가입 시 잡힌 날짜 유지).
 *     단, 이미 청구일이 도래한 구독(next_billing_date <= 오늘)은 첫 성공이어도 평소처럼 한 달 전진한다
 *     (매일 재청구되는 루프 방지).
 *   - 성공 이력이 한 번도 없는 구독의 결제 실패는 즉시 expired로 전환한다(혜택 중단 + 재가입 가능).
 *   - 성공 이력이 있는 구독의 실패는 기존대로 3회 연속 실패 시 expired.
 */

type RpcResult = { data: Record<string, unknown> | null; error: { code: string; message: string } | null }
const rpc = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args)

let planId: number
let userIds: string[] = []

const ymd = (d: Date): string => d.toISOString().slice(0, 10)

async function readSub(id: number): Promise<{ status: string; next_billing_date: string; fail_count: number }> {
  const { data } = await adminClient!
    .from('user_subscriptions')
    .select('status, next_billing_date, fail_count')
    .eq('id', id)
    .single()
  return data as { status: string; next_billing_date: string; fail_count: number }
}

async function createSub(userId: string): Promise<number> {
  const { data, error } = await rpc('create_user_subscription', {
    p_user_id: userId,
    p_plan_id: planId,
    p_billing_key: `billing_FIRST_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    p_billing_cycle_day: 1,
  })
  expect(error).toBeNull()
  expect(data?.success).toBe(true)
  return data!.subscription_id as number
}

const succeeded = (id: number): Promise<RpcResult> =>
  rpc('record_subscription_charge_result', {
    p_user_subscription_id: id,
    p_status: 'succeeded',
    p_amount: 9900,
    p_toss_response: { mock: true },
  })

const failed = (id: number): Promise<RpcResult> =>
  rpc('record_subscription_charge_result', {
    p_user_subscription_id: id,
    p_status: 'failed',
    p_amount: 9900,
    p_toss_response: { mock: true },
  })

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가')

  const { data: plan, error: planError } = await adminClient
    .from('subscription_plans')
    .insert({ name: `__TEST_FIRSTCHARGE_${Date.now()}`, monthly_price: 9900, status: 'active' })
    .select('id')
    .single()
  if (planError || !plan) throw new Error(`테스트 플랜 생성 실패: ${planError?.message}`)
  planId = (plan as { id: number }).id

  // 활성 구독이 없는 기존 프로필만 사용(create_user_subscription의 ALREADY_SUBSCRIBED 회피)
  const { data: activeRows } = await adminClient.from('user_subscriptions').select('user_id').eq('status', 'active')
  const busy = new Set(((activeRows ?? []) as { user_id: string }[]).map((r) => r.user_id))
  const { data: profiles } = await adminClient.from('user_profiles').select('id').limit(40)
  userIds = ((profiles ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !busy.has(id)).slice(0, 6)
  if (userIds.length < 6) throw new Error('활성 구독이 없는 테스트용 user_profiles가 6건 필요합니다')
})

afterAll(async () => {
  if (adminClient && planId) {
    await adminClient.from('subscription_payment_logs').delete().eq('plan_id', planId)
    await adminClient.from('user_subscriptions').delete().eq('plan_id', planId)
    await adminClient.from('subscription_plans').delete().eq('id', planId)
  }
})

describe('첫 결제 성공 — 다음 청구일 이중 가산 방지', () => {
  it('RED→GREEN: 가입 직후 첫 결제 성공은 가입 시 잡힌 다음 청구일을 그대로 유지한다', async () => {
    const id = await createSub(userIds[0])
    const created = await readSub(id)

    const { data, error } = await succeeded(id)
    expect(error).toBeNull()
    expect(data?.success).toBe(true)
    expect(data?.next_status).toBe('active')

    const after = await readSub(id)
    expect(after.next_billing_date).toBe(created.next_billing_date)
    expect(after.fail_count).toBe(0)
  })

  it('두 번째 성공(청구일 도래 후 정기 청구)은 평소처럼 한 달 전진한다', async () => {
    const id = await createSub(userIds[1])
    await succeeded(id) // 첫 결제

    const today = ymd(new Date())
    await adminClient!.from('user_subscriptions').update({ next_billing_date: today }).eq('id', id)

    const { data } = await succeeded(id) // 크론 재청구 재현
    expect(data?.success).toBe(true)

    const after = await readSub(id)
    const expected = new Date(`${today}T00:00:00Z`)
    expected.setUTCMonth(expected.getUTCMonth() + 1)
    expect(after.next_billing_date).toBe(ymd(expected))
  })

  it('가드: 성공 이력이 없어도 청구일이 이미 도래한 구독은 한 달 전진한다(매일 재청구 루프 방지)', async () => {
    const id = await createSub(userIds[2])
    const today = ymd(new Date())
    await adminClient!.from('user_subscriptions').update({ next_billing_date: today }).eq('id', id)

    await succeeded(id)

    const after = await readSub(id)
    expect(after.next_billing_date > today).toBe(true)
  })
})

describe('첫 결제 실패 — 구독이 활성으로 남지 않는다', () => {
  it('RED→GREEN: 성공 이력이 없는 구독의 결제 실패는 즉시 expired + 재가입 가능', async () => {
    const id = await createSub(userIds[3])

    const { data } = await failed(id)
    expect(data?.success).toBe(true)
    expect(data?.next_status).toBe('expired')

    const after = await readSub(id)
    expect(after.status).toBe('expired')
    expect(after.fail_count).toBe(1)

    // 같은 사용자가 다시 가입할 수 있다(ALREADY_SUBSCRIBED 아님)
    const retry = await rpc('create_user_subscription', {
      p_user_id: userIds[3],
      p_plan_id: planId,
      p_billing_key: `billing_FIRST_RETRY_${Date.now()}`,
      p_billing_cycle_day: 1,
    })
    expect(retry.data?.success).toBe(true)
  })

  it('성공 이력이 있는 구독의 실패는 기존대로 3회 연속 실패 시에만 expired', async () => {
    const id = await createSub(userIds[4])
    await succeeded(id)

    const first = await failed(id)
    expect(first.data?.next_status).toBe('active')
    const second = await failed(id)
    expect(second.data?.next_status).toBe('active')
    const third = await failed(id)
    expect(third.data?.next_status).toBe('expired')

    expect((await readSub(id)).fail_count).toBe(3)
  })

  it('청구 선점 표시(billing_claimed_at)는 첫 결제 실패 후에도 해제된다', async () => {
    const id = await createSub(userIds[5])
    await adminClient!.from('user_subscriptions').update({ billing_claimed_at: new Date().toISOString() }).eq('id', id)

    await failed(id)

    const { data } = await adminClient!.from('user_subscriptions').select('billing_claimed_at').eq('id', id).single()
    expect((data as { billing_claimed_at: string | null }).billing_claimed_at).toBeNull()
  })
})
