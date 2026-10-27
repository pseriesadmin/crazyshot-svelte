/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ⓪ 두발히어로 연동 전용 스위치 라이브 검증 (Migration #772, Stage DB ezyvffjvuwmtuhpxdjrw — 2026-10-27, Stephen 지시)
 *  DB-1  새 대여 방식 행은 is_dhero_integration 기본값이 false 이고 장바구니 스위치(is_bulk_delivery)와 독립이다
 *  DB-2  켜고 끄는 함수: 비로그인(anon)은 실행 불가
 *  DB-3  로그인한 일반 고객(cms_role 없음)은 거절
 *  DB-4  파트너(manager 미만)는 거절 — 외부 연동 스위치라 매니저 이상만
 *  DB-5  매니저는 켜고 끌 수 있고, 두 번 호출하면 원래 값으로 돌아오며 is_bulk_delivery 는 그대로다
 * 기존 방식 행은 건드리지 않고 시험 전용 임시 행만 만들었다가 지운다.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin: any = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const userIds: string[] = []
const methodIds: string[] = []

afterAll(async () => {
  for (const id of methodIds) await admin.from('rental_method_options').delete().eq('id', id).then(undefined, () => undefined)
  for (const id of userIds) {
    await admin.from('user_profiles').delete().eq('id', id).then(undefined, () => undefined)
    await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
  }
}, 60000)

async function tempMethod(): Promise<string> {
  const key = `tdd-dhero-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const { data, error } = await admin
    .from('rental_method_options')
    .insert({ name: `시험방식-${key}`, method_key: key, display_order: 999 })
    .select('id, is_dhero_integration, is_bulk_delivery')
    .single()
  if (error || !data) throw new Error(`임시 방식 생성 실패: ${error?.message}`)
  methodIds.push(data.id)
  expect(data.is_dhero_integration).toBe(false) // DB-1
  expect(data.is_bulk_delivery).toBe(false)
  return data.id as string
}

async function userWithRole(role: 'partner' | 'manager' | null): Promise<any> {
  const email = `tdd-dhero-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = `Pw!${Math.random().toString(36).slice(2)}A1`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`계정 생성 실패: ${error?.message}`)
  const uid = data.user.id
  userIds.push(uid)
  if (role) {
    const up = await admin.from('user_profiles').update({ cms_role: role }).eq('id', uid).select('id')
    if (up.error) throw new Error(`등급 부여 실패: ${up.error.message}`)
    if (!up.data?.length) {
      const ins = await admin.from('user_profiles').insert({ id: uid, user_id: uid, email, cms_role: role })
      if (ins.error) throw new Error(`프로필 생성 실패: ${ins.error.message}`)
    }
  }
  const client: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(`로그인 실패: ${login.error.message}`)
  return client
}

describe('rental_method_options.is_dhero_integration (Migration #772)', () => {
  it('DB-1: 새 방식 행은 기본 꺼짐(연동·장바구니 스위치 모두)', async () => {
    await tempMethod() // 내부에서 기본값 단언
  })

  it('DB-2: 비로그인(anon)은 토글 함수를 실행할 수 없다', async () => {
    const id = await tempMethod()
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { error } = await anon.rpc('toggle_rental_method_dhero_integration', { p_id: id })
    expect(error).not.toBeNull()
    const { data } = await admin.from('rental_method_options').select('is_dhero_integration').eq('id', id).single()
    expect(data.is_dhero_integration).toBe(false)
  })

  it('DB-3·DB-4: 일반 고객과 파트너는 거절되고 값이 바뀌지 않는다', async () => {
    const id = await tempMethod()
    for (const role of [null, 'partner'] as const) {
      const client = await userWithRole(role)
      const { error } = await client.rpc('toggle_rental_method_dhero_integration', { p_id: id })
      expect(error?.message, `role=${role}`).toContain('unauthorized')
    }
    const { data } = await admin.from('rental_method_options').select('is_dhero_integration').eq('id', id).single()
    expect(data.is_dhero_integration).toBe(false)
  })

  it('DB-5: 매니저는 켜고 끌 수 있고 장바구니 스위치는 그대로다', async () => {
    const id = await tempMethod()
    const manager = await userWithRole('manager')
    const on = await manager.rpc('toggle_rental_method_dhero_integration', { p_id: id })
    expect(on.error).toBeNull()
    expect(on.data.is_dhero_integration).toBe(true)
    expect(on.data.is_bulk_delivery).toBe(false)
    const off = await manager.rpc('toggle_rental_method_dhero_integration', { p_id: id })
    expect(off.data.is_dhero_integration).toBe(false)
    // 없는 행은 not_found
    const missing = await manager.rpc('toggle_rental_method_dhero_integration', { p_id: '00000000-0000-0000-0000-000000000000' })
    expect(missing.error?.message).toContain('not_found')
  })
})
