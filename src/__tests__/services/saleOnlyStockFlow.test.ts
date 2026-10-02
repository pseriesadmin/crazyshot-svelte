/**
 * TDD: saleOnlyStockFlow.test.ts — ④ 판매전용 재고 자동 비활성/복원 + 수동 비활성 보호 (Migration 553)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 생성·정리한다.
 *
 * S1~S5: 현행(#416/#417/#487) 특성 — 마이그레이션 전에도 통과해야 함
 * S6~S8, S10: 마커(products.auto_deactivated_reservation_id) 기반 — 마이그레이션 553 후 통과
 * (S7/S9의 toggleStatus 서버 액션은 saleOnlyToggleGuard.test.ts 단위 테스트)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []

let client: SupabaseClient
let userId = ''

beforeAll(async () => {
  const email = `tdd-salestock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  userId = data.user.id
  await approveTestCustomer(admin, userId)
  client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password })
  if (signErr) throw new Error(`로그인 실패: ${signErr.message}`)
}, 60000)

afterAll(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
  await admin.from('rental_reservations').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId)
}, 180000)

let rangeSeq = 0
function range(): { start: string; end: string } {
  const base = Date.UTC(2031, 0, 1) + (Math.floor(Math.random() * 300) + rangeSeq++ * 400) * 86400000
  const fmt = (d: number) => new Date(d).toISOString().slice(0, 10)
  return { start: fmt(base), end: fmt(base + 2 * 86400000) }
}

/** 부모+자식 1개(자식이 예약 배정 대상). saleOnly면 부모·자식 모두 sale_only=true. */
async function createProduct(saleOnly: boolean): Promise<{ parentId: string; childId: string }> {
  const tag = `[TDD-SALESTOCK] ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { data: p, error } = await admin.from('products')
    .insert({ name: tag, category: 'other', is_active: true, sale_only: saleOnly }).select('id').single()
  if (error || !p) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (p as { id: string }).id
  const { data: c, error: cErr } = await admin.from('products')
    .insert({ name: `${tag} 자식`, category: 'other', is_active: true, sale_only: saleOnly, parent_product_id: parentId })
    .select('id').single()
  if (cErr || !c) throw new Error(`자식 생성 실패: ${cErr?.message}`)
  const childId = (c as { id: string }).id
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('product_id', childId)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  return { parentId, childId }
}

async function hold(parentId: string, r = range()): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: parentId, p_start_date: r.start, p_end_date: r.end,
  })
  const row = (data as Array<{ success: boolean; reservation_id: number | null; error_message: string | null }> | null)?.[0]
  if (error || !row?.success || !row.reservation_id) throw new Error(`hold 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id
}

async function payAndConfirm(resId: number): Promise<boolean> {
  await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', resId)
  const { data, error } = await admin.rpc('try_confirm_reservation', { p_reservation_id: resId })
  if (error) throw new Error(`try_confirm 오류: ${error.message}`)
  return data === true
}

async function setStatus(resId: number, status: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc('update_reservation_status', { p_reservation_id: resId, p_new_status: status })
  if (error) throw new Error(`update_reservation_status 오류: ${error.message}`)
  return data as { ok: boolean; error?: string }
}

async function active(id: string): Promise<boolean> {
  const { data } = await admin.from('products').select('is_active').eq('id', id).single()
  return (data as { is_active: boolean }).is_active
}
async function marker(id: string): Promise<number | null> {
  const { data, error } = await admin.from('products').select('auto_deactivated_reservation_id').eq('id', id).single()
  if (error) throw new Error(`마커 조회 실패: ${error.message}`)
  return (data as { auto_deactivated_reservation_id: number | null }).auto_deactivated_reservation_id
}
async function resStatus(id: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('status').eq('id', id).single()
  return (data as { status: string }).status
}

describe('[TDD] 현행 특성 — 마이그레이션 553 전후 모두 통과', () => {
  it('S1 판매전용 결제완료 → try_confirm_reservation → confirmed + 재고 비활성', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    expect(await payAndConfirm(rid)).toBe(true)
    expect(await resStatus(rid)).toBe('confirmed')
    expect(await active(childId)).toBe(false)
  })

  it('S2 관리자 승인(update_reservation_status confirmed) → 재고 비활성', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    expect((await setStatus(rid, 'confirmed')).ok).toBe(true)
    expect(await active(childId)).toBe(false)
  })

  it('S3 confirmed 판매 예약 취소(환불 경로) → 재고 복원', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    await payAndConfirm(rid)
    expect((await setStatus(rid, 'cancelled')).ok).toBe(true)
    expect(await active(childId)).toBe(true)
  })

  it('S4 hold 상태 판매 예약 취소는 재고 상태 무변화(활성 유지)', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    expect(await active(childId)).toBe(true)
    await setStatus(rid, 'cancelled')
    expect(await active(childId)).toBe(true)
  })

  it('S5 대여 상품(sale_only=false) confirmed → cancelled 에서 is_active 무변화', async () => {
    const { parentId, childId } = await createProduct(false)
    const rid = await hold(parentId)
    await setStatus(rid, 'confirmed')
    expect(await active(childId)).toBe(true)
    await setStatus(rid, 'cancelled')
    expect(await active(childId)).toBe(true)
  })
})

describe('[TDD-RED] 수동 비활성 보호 — 마이그레이션 553 후 통과', () => {
  it('S6 자동 비활성 시 마커=예약id, 관리자가 수동 정리(마커 NULL, 끔 유지)한 뒤 취소해도 비활성 유지', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    await payAndConfirm(rid)
    expect(await marker(childId)).toBe(rid)
    // toggleStatus 수동 결정 결과와 동일한 상태(마커 정리, 비활성 유지) — 액션 자체는 단위 테스트에서 검증
    await admin.from('products').update({ auto_deactivated_reservation_id: null }).eq('id', childId)
    await setStatus(rid, 'cancelled')
    expect(await active(childId)).toBe(false)
  })

  it('S6b 확정 직전에 관리자가 수동 비활성한 재고는 마커 없이 유지, 취소해도 복원 안 됨', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    await admin.from('products').update({ is_active: false }).eq('id', childId)
    await setStatus(rid, 'confirmed')
    expect(await marker(childId)).toBeNull()
    await setStatus(rid, 'cancelled')
    expect(await active(childId)).toBe(false)
  })

  it('S8 마커가 있는 재고는 취소 시 복원되고 마커 NULL', async () => {
    const { parentId, childId } = await createProduct(true)
    const rid = await hold(parentId)
    await payAndConfirm(rid)
    expect(await marker(childId)).toBe(rid)
    await setStatus(rid, 'cancelled')
    expect(await active(childId)).toBe(true)
    expect(await marker(childId)).toBeNull()
  })

  it('S10 다른 예약이 자동 비활성한 재고는 이 예약 취소로 건드리지 않음(마커 예약id 불일치)', async () => {
    const { parentId, childId } = await createProduct(true)
    const r1 = await hold(parentId)
    const r2 = await hold(parentId) // 다른 기간 — 둘 다 hold
    await setStatus(r1, 'confirmed')
    expect(await marker(childId)).toBe(r1)
    await setStatus(r2, 'cancelled')
    expect(await active(childId)).toBe(false)
    expect(await marker(childId)).toBe(r1)
  })

  it('S9 대여(일반) 재고 확정 시 마커 없음', async () => {
    const { parentId, childId } = await createProduct(false)
    const rid = await hold(parentId)
    await setStatus(rid, 'confirmed')
    expect(await marker(childId)).toBeNull()
  })
})
