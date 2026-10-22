/**
 * TDD: pointEarnExpiryDays.test.ts — 포인트 자동 소멸 기한(적립일로부터 N일) (Migration #742)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 설정·거래 fixture는 이 파일이 만들고 반드시 원복/삭제한다.
 *
 * 기대:
 *  - 설정(point_use_settings.expiry_days) 0 = 소멸 없음 → 신규 적립의 expires_at 은 NULL.
 *  - N일 설정 → 신규 적립(type=earn)의 expires_at = 적립일(KST) + N일 23:59:59 KST.
 *  - 이미 expires_at 이 있는 적립(구독 혜택 등)은 덮어쓰지 않는다.
 *  - 관리자 직접 지급(admin_grant)은 대상이 아니다.
 *  - 범위(0~3650) 밖 값은 DB가 거부하고, 설정 쓰기는 service_role 전용이다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const TEST_REF = 't_exp_742'

let settingsId: string
let originalDays: number
let userId: string

async function setDays(days: number): Promise<void> {
  const { error } = await admin.from('point_use_settings').update({ expiry_days: days }).eq('id', settingsId)
  if (error) throw new Error(`설정 변경 실패: ${error.message}`)
}

async function insertTx(
  type: 'earn' | 'admin_grant',
  createdAt: string,
  extra: { expires_at?: string } = {},
): Promise<string | null> {
  const { data, error } = await admin
    .from('point_transactions')
    .insert({
      user_id: userId,
      type,
      amount: 10,
      balance_after: 10,
      description: 'TDD 소멸 기한',
      ref_type: TEST_REF,
      ref_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: createdAt,
      ...extra,
    })
    .select('expires_at')
    .single()
  if (error) throw new Error(`거래 삽입 실패: ${error.message}`)
  return (data as { expires_at: string | null }).expires_at
}

beforeAll(async () => {
  const { data: s } = await admin.from('point_use_settings').select('id, expiry_days').limit(1).single()
  const row = s as { id: string; expiry_days: number }
  settingsId = row.id
  originalDays = row.expiry_days
  const { data: u } = await admin.from('user_profiles').select('user_id').limit(1).single()
  userId = (u as { user_id: string }).user_id
}, 60000)

afterAll(async () => {
  await setDays(originalDays).catch(() => undefined)
  await admin.from('point_transactions').delete().eq('ref_type', TEST_REF).then(undefined, () => undefined)
})

describe('자동 소멸 기한 — 적립 시점 expires_at 자동 부여', () => {
  it('0일(소멸 없음)이면 expires_at 은 NULL', async () => {
    await setDays(0)
    expect(await insertTx('earn', '2026-10-22T01:00:00Z')).toBeNull()
  })

  it('30일이면 적립일(KST) + 30일 23:59:59 KST (10/22 적립 → 11/21 말일)', async () => {
    await setDays(30)
    const exp = await insertTx('earn', '2026-10-22T01:00:00Z') // = 10/22 10:00 KST
    expect(exp).not.toBeNull()
    expect(new Date(exp as string).toISOString()).toBe('2026-11-21T14:59:59.000Z') // 11/21 23:59:59 KST
  })

  it('KST 자정 직후(UTC로는 전날) 적립도 KST 날짜 기준으로 계산', async () => {
    await setDays(30)
    const exp = await insertTx('earn', '2026-10-21T15:30:00Z') // = 10/22 00:30 KST
    expect(new Date(exp as string).toISOString()).toBe('2026-11-21T14:59:59.000Z')
  })

  it('1일이면 적립 다음 날 말일(10/22 적립 → 10/23 23:59:59 KST)', async () => {
    await setDays(1)
    const exp = await insertTx('earn', '2026-10-22T01:00:00Z')
    expect(new Date(exp as string).toISOString()).toBe('2026-10-23T14:59:59.000Z')
  })

  it('이미 expires_at 이 있는 적립(구독 혜택 등)은 덮어쓰지 않는다', async () => {
    await setDays(30)
    const exp = await insertTx('earn', '2026-10-22T01:00:00Z', { expires_at: '2030-01-01T00:00:00Z' })
    expect(new Date(exp as string).toISOString()).toBe('2030-01-01T00:00:00.000Z')
  })

  it('관리자 직접 지급(admin_grant)은 소멸 대상이 아니다', async () => {
    await setDays(30)
    expect(await insertTx('admin_grant', '2026-10-22T01:00:00Z')).toBeNull()
  })
})

describe('설정 변경은 소급하지 않는다 — 직후 적립부터만 적용', () => {
  async function expiryOf(ref: string): Promise<string | null> {
    const { data } = await admin.from('point_transactions').select('expires_at').eq('ref_type', TEST_REF).eq('ref_id', ref).single()
    return (data as { expires_at: string | null }).expires_at
  }

  it('0→30→90→0 으로 바꿔도 이미 쌓인 적립의 만료일은 그대로, 새 적립만 그 시점 설정을 따른다', async () => {
    const mk = async (ref: string, days: number): Promise<void> => {
      await setDays(days)
      const { error } = await admin.from('point_transactions').insert({
        user_id: userId, type: 'earn', amount: 10, balance_after: 10, description: 'TDD 소급',
        ref_type: TEST_REF, ref_id: ref, created_at: '2026-10-22T01:00:00Z',
      })
      if (error) throw new Error(error.message)
    }
    await mk('retro-A', 0)    // 소멸 없음일 때 적립 → 영구
    await mk('retro-B', 30)   // 30일 설정 중 적립
    await mk('retro-C', 90)   // 90일로 변경 후 적립
    await mk('retro-D', 0)    // 다시 0으로 변경 후 적립

    // 설정을 마지막으로 0으로 둔 지금도 이전 적립은 각자 적립 당시 설정대로 유지
    expect(await expiryOf('retro-A')).toBeNull()
    expect(new Date((await expiryOf('retro-B')) as string).toISOString()).toBe('2026-11-21T14:59:59.000Z') // 30일
    expect(new Date((await expiryOf('retro-C')) as string).toISOString()).toBe('2027-01-20T14:59:59.000Z') // 90일
    expect(await expiryOf('retro-D')).toBeNull()
  })
})

describe('설정 저장·권한', () => {
  it('upsert RPC(service_role)로 저장 → get_point_use_settings 에 expiry_days 반영, 다른 값은 유지', async () => {
    const { data: before } = await admin.rpc('get_point_use_settings')
    const b = before as { use_unit: number; max_use_ratio: number }
    const { error } = await admin.rpc('upsert_point_use_settings', { p_expiry_days: 90 })
    expect(error).toBeNull()
    const { data: after } = await admin.rpc('get_point_use_settings')
    const a = after as { expiry_days: number; use_unit: number; max_use_ratio: number }
    expect(a.expiry_days).toBe(90)
    expect(a.use_unit).toBe(b.use_unit)
    expect(a.max_use_ratio).toBe(b.max_use_ratio)
  })

  it('범위(0~3650) 밖 값은 DB가 거부', async () => {
    const { error } = await admin.rpc('upsert_point_use_settings', { p_expiry_days: 3651 })
    expect(error).not.toBeNull()
    const { error: neg } = await admin.rpc('upsert_point_use_settings', { p_expiry_days: -1 })
    expect(neg).not.toBeNull()
  })

  it('anon·일반 로그인 사용자는 upsert RPC 를 호출할 수 없다', async () => {
    await setDays(90)
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error } = await anon.rpc('upsert_point_use_settings', { p_expiry_days: 1 })
    expect(error).not.toBeNull()
    const { data } = await admin.from('point_use_settings').select('expiry_days').eq('id', settingsId).single()
    expect((data as { expiry_days: number }).expiry_days).toBe(90)
  })
})
