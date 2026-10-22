/**
 * TDD: pointExpireDueFifo.test.ts — 소멸 처리(expire_due_points)와 일반 적립 소멸 기한의 조합 (Migration #743)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 임시 사용자·거래는 이 파일이 만들고 반드시 삭제한다.
 *
 * 배경(sp3 BLOCKER-1): 소멸 거래(type=expire)가 소멸된 적립분이 아니라 "가장 오래된 적립분"을 깎는 것으로 재생돼,
 * 만료 순서가 적립 순서와 엇갈리면(긴 만료 적립이 더 오래된 경우) 같은 적립분이 매일 다시 소멸됐다.
 *
 * 기대:
 *  - 구독처럼 오래된 장기 적립 S + 나중 적립 G(만료됨) → expire_due_points 를 여러 번 실행해도 G 는 한 번만 소멸, 잔액은 S 만큼 유지.
 *  - 일부 사용(use)이 섞여도 같은 결과(재실행 멱등).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const REF = 't_fifo_743'

let userId = ''

async function profileUserId(authId: string): Promise<string> {
  const { data } = await admin.from('user_profiles').select('user_id').eq('id', authId).maybeSingle()
  return (data as { user_id?: string } | null)?.user_id ?? authId
}

async function newUser(points: number): Promise<{ authId: string; uid: string }> {
  const email = `tdd-fifo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const authId = data.user.id
  const { error: upErr } = await admin.from('user_profiles').update({ points }).eq('id', authId)
  if (upErr) throw new Error(`포인트 설정 실패: ${upErr.message}`)
  return { authId, uid: await profileUserId(authId) }
}

async function addEarn(uid: string, amount: number, createdAt: string, expiresAt: string, tag: string): Promise<void> {
  const { error } = await admin.from('point_transactions').insert({
    user_id: uid, type: 'earn', amount, balance_after: amount, description: `TDD ${tag}`,
    ref_type: REF, ref_id: tag, created_at: createdAt, expires_at: expiresAt,
  })
  if (error) throw new Error(`적립 삽입 실패: ${error.message}`)
}

async function addUse(uid: string, amount: number, createdAt: string): Promise<void> {
  const { error } = await admin.from('point_transactions').insert({
    user_id: uid, type: 'use', amount: -amount, balance_after: 0, description: 'TDD use',
    ref_type: REF, ref_id: `use-${createdAt}`, created_at: createdAt,
  })
  if (error) throw new Error(`사용 삽입 실패: ${error.message}`)
}

async function balance(authId: string): Promise<number> {
  const { data } = await admin.from('user_profiles').select('points').eq('id', authId).single()
  return (data as { points: number }).points
}

async function expireRows(uid: string): Promise<Array<{ amount: number; ref_id: string }>> {
  const { data } = await admin.from('point_transactions').select('amount, ref_id').eq('user_id', uid).eq('type', 'expire')
  return (data ?? []) as Array<{ amount: number; ref_id: string }>
}

const created: Array<{ authId: string; uid: string }> = []

beforeAll(() => {
  userId = ''
})

afterAll(async () => {
  for (const u of created) {
    await admin.from('point_transactions').delete().eq('user_id', u.uid).then(undefined, () => undefined)
    await admin.auth.admin.deleteUser(u.authId).then(undefined, () => undefined)
  }
  void userId
})

describe('expire_due_points — 만료 순서가 적립 순서와 엇갈려도 이중 소멸하지 않는다', () => {
  it('오래된 장기 적립 S(1000) + 나중 적립 G(500, 만료) → 3회 실행해도 G 한 번만 소멸, 잔액 1000', async () => {
    const u = await newUser(1500)
    created.push(u)
    await addEarn(u.uid, 1000, '2026-08-01T00:00:00Z', '2030-01-01T00:00:00Z', 'S')
    await addEarn(u.uid, 500, '2026-09-01T00:00:00Z', '2026-09-30T14:59:59Z', 'G')

    for (let i = 0; i < 3; i++) {
      const { error } = await admin.rpc('expire_due_points')
      expect(error).toBeNull()
    }

    const rows = await expireRows(u.uid)
    expect(rows.length).toBe(1)
    expect(rows[0].amount).toBe(-500)
    expect(await balance(u.authId)).toBe(1000)
  }, 90000)

  it('사용(use)이 섞여도 재실행 멱등 — S 일부 사용(300) 후 G 소멸', async () => {
    const u = await newUser(1200)
    created.push(u)
    await addEarn(u.uid, 1000, '2026-08-01T00:00:00Z', '2030-01-01T00:00:00Z', 'S')
    await addEarn(u.uid, 500, '2026-09-01T00:00:00Z', '2026-09-30T14:59:59Z', 'G')
    await addUse(u.uid, 300, '2026-09-10T00:00:00Z') // 가장 오래된 S 에서 차감 처리

    await admin.rpc('expire_due_points')
    const afterFirst = await balance(u.authId)
    await admin.rpc('expire_due_points')
    await admin.rpc('expire_due_points')

    expect(await balance(u.authId)).toBe(afterFirst)
    expect((await expireRows(u.uid)).length).toBe(1)
    expect(afterFirst).toBe(700) // 1200 - G 500 (사용 300은 이미 잔액에 반영된 상태)
  }, 90000)

  it('회귀: 만료된 적립 1건만 있는 평범한 경우 — 1회만 소멸, 재실행해도 불변', async () => {
    const u = await newUser(500)
    created.push(u)
    await addEarn(u.uid, 500, '2026-09-01T00:00:00Z', '2026-09-30T14:59:59Z', 'G')

    await admin.rpc('expire_due_points')
    await admin.rpc('expire_due_points')

    expect((await expireRows(u.uid)).length).toBe(1)
    expect(await balance(u.authId)).toBe(0)
  }, 90000)

  it('회귀: 만료 전 적립은 소멸하지 않는다', async () => {
    const u = await newUser(500)
    created.push(u)
    await addEarn(u.uid, 500, '2026-09-01T00:00:00Z', '2030-01-01T00:00:00Z', 'S')

    await admin.rpc('expire_due_points')

    expect((await expireRows(u.uid)).length).toBe(0)
    expect(await balance(u.authId)).toBe(500)
  }, 90000)
})
