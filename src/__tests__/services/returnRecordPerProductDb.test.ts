import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createTestProduct } from '../helpers/createTestProduct'

/**
 * 반납 기록은 상품(예약)별 필수 — 검수 승인은 모든 상품에 기록(고객 제출 또는 관리자 대리 등록)이 있어야 한다 (Migration #813, Stage 라이브)
 *  M1 상품 2개 주문: 기록이 하나도 없으면 return_records_missing 이 둘 다 돌려주고 승인이 거절된다
 *  M2 한 상품만 관리자 대리 등록하면 나머지 상품 때문에 여전히 거절된다
 *  M3 두 상품 모두 기록(고객 제출 + 관리자 등록 섞여도 무방)이 있으면 승인된다
 *  M4 소급 면제(return_record_exempt)된 예약은 기록이 없어도 대상에서 빠진다
 *  M5 주문에 묶이지 않은 예약 1건도 기록이 없으면 거절된다
 *  M6 검수 이슈 해소(완료 처리) 경로도 기록이 없는 상품이 있으면 거절된다(#815)
 *  M7 검수 상태를 직접 승인으로 바꿔도 기록 없는 상품이 있으면 완료 전환이 트리거에서 막힌다(#816)
 *  M8 반납등록 미션 포인트는 주문당 1회 — 같은 주문의 다른 예약이 이미 받았으면 다시 지급하지 않는다(#816)
 *  M9 같은 제출의 같은 사진 경로는 두 번 저장되지 않는다(#816 유일 인덱스)
 * 시험 데이터는 자기가 만든 것만 지운다.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function createUser(): Promise<string> {
  const { data: u, error } = await admin.auth.admin.createUser({
    email: `tdd-retrec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  cleanups.push(async () => {
    const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
    const sids = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
    if (sids.length) await admin.from('chat_messages').delete().in('session_id', sids)
    await admin.from('chat_sessions').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId).catch(() => undefined)
  })
  return userId
}

async function createReturnedReservation(userId: string, label: string, orderId: number | null): Promise<number> {
  const product = await createTestProduct(admin, label)
  cleanups.push(() => product.cleanup())
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 반납완료 상태 예약 행이 필요하고 예약 배정 RPC는 이 검증과 무관
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: product.childId, start_date: today, end_date: today, status: 'hold', pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '18:00' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('reservation_return_admin_entries').delete().eq('reservation_id', id)
    await admin.from('reservation_return_submissions').delete().eq('reservation_id', id)
    await admin.from('order_items').delete().eq('reservation_id', id)
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  const { error: ue } = await admin.from('rental_reservations').update({ status: 'returned' }).eq('id', id)
  if (ue) throw new Error(`예약 상태 변경 실패: ${ue.message}`)
  if (orderId != null) {
    const { error: oe } = await admin.from('order_items').insert({ order_id: orderId, reservation_id: id, product_id: product.childId, unit_price: 0, line_total: 0 })
    if (oe) throw new Error(`order_items 생성 실패: ${oe.message}`)
  }
  return id
}

async function createOrder(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('orders')
    .insert({ order_key: `tdd-retrec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, user_id: userId, total_amount: 0, final_amount: 0 })
    .select('id')
    .single()
  if (error || !data) throw new Error(`주문 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('order_items').delete().eq('order_id', id)
    await admin.from('orders').delete().eq('id', id)
  })
  return id
}

async function missing(id: number): Promise<number[]> {
  const { data, error } = await admin.rpc('return_records_missing', { p_reservation_id: id })
  expect(error).toBeNull()
  return ((data ?? []) as unknown[]).map((v) => Number(v))
}

async function approve(id: number): Promise<{ ok?: boolean; error?: string; missing_ids?: number[] }> {
  const adminUser = await createUser()
  const { data, error } = await admin.rpc('approve_return_inspection', { p_reservation_id: id, p_admin_id: adminUser })
  expect(error).toBeNull()
  return data as { ok?: boolean; error?: string; missing_ids?: number[] }
}

async function addAdminEntry(id: number): Promise<void> {
  const { error } = await admin.from('reservation_return_admin_entries').insert({ reservation_id: id, memo: 'tdd', checklist: [], media: [] })
  expect(error).toBeNull()
}

async function addSubmission(id: number): Promise<void> {
  const { error } = await admin.from('reservation_return_submissions').insert({ reservation_id: id, method: 'visit', checklist: [] })
  expect(error).toBeNull()
}

describe('반납 기록 상품별 필수 (return_records_missing · approve_return_inspection)', { timeout: 60000 }, () => {
  it('M1 기록이 하나도 없으면 두 상품 모두 미등록, 승인 거절', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    expect((await missing(a)).sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y))
    const r = await approve(a)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('등록되지 않은 상품')
  })

  it('M2 한 상품만 대리 등록하면 나머지 때문에 여전히 거절', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    await addAdminEntry(a)
    expect(await missing(a)).toEqual([b])
    expect((await approve(a)).ok).toBe(false)
  })

  it('M3 모두 기록이 있으면 승인(고객 제출·관리자 등록 혼합)', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    await addAdminEntry(a)
    await addSubmission(b)
    expect(await missing(a)).toEqual([])
    const r = await approve(a)
    expect(r.ok).toBe(true)
  })

  it('M4 소급 면제된 예약은 기록이 없어도 대상에서 빠진다', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    await addAdminEntry(a)
    await admin.from('rental_reservations').update({ return_record_exempt: true }).eq('id', b)
    expect(await missing(a)).toEqual([])
  })

  it('M5 주문에 묶이지 않은 예약도 기록이 없으면 거절', async () => {
    const u = await createUser()
    const a = await createReturnedReservation(u, 'recSolo', null)
    expect(await missing(a)).toEqual([a])
    expect((await approve(a)).ok).toBe(false)
  })

  it('M6 이슈 해소(완료 처리)도 기록 없는 상품이 있으면 거절, 기록이 모두 있으면 통과', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    await addAdminEntry(a)
    const { error: ie } = await admin.from('rental_reservations').update({ inspection_status: 'issue' }).eq('id', a)
    expect(ie).toBeNull()
    const adminUser = await createUser()
    const blocked = await admin.rpc('resolve_return_inspection_issue', { p_reservation_id: a, p_admin_id: adminUser, p_note: 'tdd' })
    expect(blocked.error).toBeNull()
    expect((blocked.data as { ok?: boolean }).ok).toBe(false)
    await addSubmission(b)
    const ok = await admin.rpc('resolve_return_inspection_issue', { p_reservation_id: a, p_admin_id: adminUser, p_note: 'tdd' })
    const okData = ok.data as { ok?: boolean; completed_ids?: number[] }
    expect(okData.ok).toBe(true)
    // #727 정책 유지 확인 — 실제로 완료된 예약 id 를 돌려줘야 대여완료 포인트가 적립된다(#815 가 #725 본문으로 덮어써 이 값이 사라졌던 회귀 방지)
    expect(Array.isArray(okData.completed_ids)).toBe(true)
    expect(okData.completed_ids).toContain(a)
    const { data: done } = await admin.from('rental_reservations').select('id, status').in('id', [a, b])
    expect(((done ?? []) as { id: number; status: string }[]).find((r) => r.id === a)?.status).toBe('completed')
  })

  it('M7 검수 상태를 직접 pass 로 바꿔도 기록 없는 상품이 있으면 완료 전환 거절(트리거)', async () => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    await createReturnedReservation(u, 'recB', order)
    await addAdminEntry(a)
    const { error: pe } = await admin.from('rental_reservations').update({ inspection_status: 'pass' }).eq('id', a)
    expect(pe).toBeNull()
    const { error } = await admin.from('rental_reservations').update({ status: 'completed' }).eq('id', a)
    expect(error?.message ?? '').toContain('RETURN_RECORD_REQUIRED')
  })

  it('M8 미션 포인트는 주문당 1회 — 같은 주문 두 번째 예약은 already_granted', async (ctx) => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    cleanups.push(async () => { await admin.from('point_transactions').delete().eq('user_id', u) })
    const first = await admin.rpc('award_return_register_mission_points', { p_reservation_id: a })
    expect(first.error).toBeNull()
    const f = first.data as { success?: boolean; already_granted?: boolean; error?: string }
    // 규칙이 꺼져 있거나 프로필이 없는 환경이면 지급 자체가 안 되므로 '통과'가 아니라 '건너뜀'으로 표시한다
    if (!f.success) return ctx.skip()
    expect(f.already_granted).toBeFalsy()
    const second = await admin.rpc('award_return_register_mission_points', { p_reservation_id: b })
    expect((second.data as { already_granted?: boolean }).already_granted).toBe(true)
  })

  it('M9 같은 제출의 같은 사진 경로는 한 번만 저장된다(유일 인덱스)', async () => {
    const u = await createUser()
    const a = await createReturnedReservation(u, 'recMedia', null)
    await addSubmission(a)
    const { data: sub } = await admin.from('reservation_return_submissions').select('id').eq('reservation_id', a).single()
    const submissionId = (sub as { id: number }).id
    const row = { submission_id: submissionId, reservation_id: a, item_key: 'locker', storage_path: `${a}/locker/00000000-0000-0000-0000-000000000000.jpg`, kind: 'photo', sort_order: 0 }
    const r1 = await admin.from('reservation_return_media').upsert([row], { onConflict: 'submission_id,storage_path', ignoreDuplicates: true })
    const r2 = await admin.from('reservation_return_media').upsert([row], { onConflict: 'submission_id,storage_path', ignoreDuplicates: true })
    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()
    const { count } = await admin.from('reservation_return_media').select('id', { count: 'exact', head: true }).eq('submission_id', submissionId)
    expect(count).toBe(1)
  })

  it('M8b 같은 주문의 두 예약을 동시에 호출해도 포인트는 한 번만 지급된다(주문 단위 잠금)', async (ctx) => {
    const u = await createUser()
    const order = await createOrder(u)
    const a = await createReturnedReservation(u, 'recA', order)
    const b = await createReturnedReservation(u, 'recB', order)
    cleanups.push(async () => { await admin.from('point_transactions').delete().eq('user_id', u) })
    const [r1, r2] = await Promise.all([
      admin.rpc('award_return_register_mission_points', { p_reservation_id: a }),
      admin.rpc('award_return_register_mission_points', { p_reservation_id: b }),
    ])
    const d = [r1.data, r2.data] as { success?: boolean; already_granted?: boolean; amount?: number }[]
    if (!d.some((x) => x.success && !x.already_granted)) return ctx.skip()
    expect(d.filter((x) => x.success && !x.already_granted && (x.amount ?? 0) > 0)).toHaveLength(1)
    const { count } = await admin.from('point_transactions').select('id', { count: 'exact', head: true }).eq('user_id', u).eq('ref_type', 'return_register_mission')
    expect(count).toBe(1)
  })
})
