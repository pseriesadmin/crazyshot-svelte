import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createTestProduct } from '../helpers/createTestProduct'

/**
 * 반납 안내 알림은 "주문(예약코드) 1개당 1번"만 나간다 — 상품이 여러 개여도 상품별로 쪼개 보내지 않는다 (Migration #812, Stage 라이브)
 *
 *  claim_return_notice_targets (return-notice 크론, 10분)
 *   C1 상품 3개짜리 주문 → 대표 1건만 돌려주고, 안내문 상품명은 "A 외 2개 상품"
 *   C2 대표를 뽑은 순간 같은 주문의 나머지 예약도 발송 기록이 남아 다시 뽑히지 않는다(재호출 0건)
 *   C3 서로 다른 주문 2개는 각각 1건씩(주문끼리 묶이지 않는다)
 *   C4 주문에 묶이지 않은 예약은 기존처럼 1건 + 상품명 그대로
 *   C5 같은 주문의 형제가 이미 이 단계 기록을 가졌으면 늦게 대상이 된 예약도 다시 보내지 않는다
 *   C6 같은 주문이라도 반납 대상이 아닌 상태(이미 반납완료)의 예약은 묶음 건수에서 빠진다
 *  get_return_remind_targets (return-remind 크론, 매일 09:00)
 *   R1 상품 3개짜리 주문 → 대표 1건만, 상품명 "A 외 2개 상품"
 *   R2 대표의 반납 예정 채팅카드가 나간 뒤에는 같은 주문의 형제가 다시 뽑히지 않는다
 *   R3 주문에 묶이지 않은 예약은 기존처럼 1건
 * 시험 데이터는 자기가 만든 것만 지운다. 클레임 함수는 Stage의 다른 대상도 선점할 수 있어 결과는 항상 자기 예약 id로 걸러 본다.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

interface Fixture {
  userId: string
  reservationIds: number[]
  productName: string
}

/** KST 현재 시각 기준: 오늘 날짜와 "지금" 시각 — 반납 1시간 전 안내 창(±1시간) 안에 들게 한다 */
function kstNow(): { date: string; time: string } {
  const k = new Date(Date.now() + 9 * 3600_000).toISOString()
  return { date: k.slice(0, 10), time: k.slice(11, 16) }
}

async function createUser(): Promise<string> {
  const { data: u, error } = await admin.auth.admin.createUser({
    email: `tdd-retorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
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

interface ReservationOpts {
  returnDate: string
  returnTime: string
  status?: string
  returnMethod?: string
  /** 같은 주문으로 묶을 order id (없으면 주문에 묶지 않음) */
  orderId?: number | null
}

async function createReservation(userId: string, label: string, opts: ReservationOpts): Promise<{ id: number; productName: string }> {
  const product = await createTestProduct(admin, label)
  cleanups.push(() => product.cleanup())
  const { data: parent } = await admin.from('products').select('name').eq('id', product.parentId).single()
  const start = new Date(new Date(`${opts.returnDate}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
  // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 상태·반납일이 지정된 예약 행이 필요하고 예약 배정 RPC는 이 검증과 무관
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId, product_id: product.childId, start_date: start, end_date: opts.returnDate,
      status: 'hold', pickup_method: 'visit', return_method: opts.returnMethod ?? 'visit', pickup_time: '10:00', return_time: opts.returnTime,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('return_notice_logs').delete().eq('reservation_id', id)
    await admin.from('order_items').delete().eq('reservation_id', id)
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  const target = opts.status ?? 'in_use'
  const { error: ue } = await admin.from('rental_reservations').update({ status: target }).eq('id', id)
  if (ue) throw new Error(`예약 상태 변경 실패: ${ue.message}`)
  if (opts.orderId != null) {
    const { error: oe } = await admin.from('order_items').insert({
      order_id: opts.orderId, reservation_id: id, product_id: product.childId, unit_price: 0, line_total: 0,
    })
    if (oe) throw new Error(`order_items 생성 실패: ${oe.message}`)
  }
  return { id, productName: (parent as { name: string }).name }
}

async function createOrder(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('orders')
    .insert({ order_key: `tdd-retorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, user_id: userId, total_amount: 0, final_amount: 0 })
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

/** 한 주문에 상품 n개(예약 n건) */
async function makeOrderWith(n: number, opts: Omit<ReservationOpts, 'orderId'>, statuses?: string[]): Promise<Fixture> {
  const userId = await createUser()
  const orderId = await createOrder(userId)
  const ids: number[] = []
  let first = ''
  for (let i = 0; i < n; i++) {
    const r = await createReservation(userId, `retorder${i}`, { ...opts, status: statuses?.[i], orderId })
    ids.push(r.id)
    if (i === 0) first = r.productName
  }
  return { userId, reservationIds: ids, productName: first }
}

interface ClaimRow { reservation_id: number; stage: string; product_name: string | null }

async function claimFor(ids: number[]): Promise<ClaimRow[]> {
  const { data, error } = await admin.rpc('claim_return_notice_targets', { p_limit: 200 })
  expect(error).toBeNull()
  return ((data ?? []) as ClaimRow[]).filter((r) => ids.includes(Number(r.reservation_id)))
}

async function logCount(ids: number[]): Promise<number> {
  const { count } = await admin.from('return_notice_logs').select('*', { count: 'exact', head: true }).in('reservation_id', ids)
  return count ?? 0
}

describe('반납 안내 — 주문당 1번 (claim_return_notice_targets)', () => {
  it('C1·C2 상품 3개짜리 주문: 대표 1건 + "외 2개 상품", 형제도 기록되어 재호출 시 0건', async () => {
    const now = kstNow()
    const fx = await makeOrderWith(3, { returnDate: now.date, returnTime: now.time })
    const rows = await claimFor(fx.reservationIds)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].reservation_id)).toBe(Math.min(...fx.reservationIds))
    expect(rows[0].stage).toBe('locker_2h')
    expect(rows[0].product_name).toBe(`${fx.productName} 외 2개 상품`)
    expect(await logCount(fx.reservationIds)).toBe(3)
    expect(await claimFor(fx.reservationIds)).toHaveLength(0)
  }, 90_000)

  it('C3 서로 다른 주문 2개는 각각 1건씩', async () => {
    const now = kstNow()
    const a = await makeOrderWith(2, { returnDate: now.date, returnTime: now.time })
    const b = await makeOrderWith(1, { returnDate: now.date, returnTime: now.time })
    const rows = await claimFor([...a.reservationIds, ...b.reservationIds])
    expect(rows).toHaveLength(2)
    const byRes = new Map(rows.map((r) => [Number(r.reservation_id), r]))
    expect(byRes.get(Math.min(...a.reservationIds))?.product_name).toBe(`${a.productName} 외 1개 상품`)
    expect(byRes.get(b.reservationIds[0])?.product_name).toBe(b.productName)
  }, 90_000)

  it('C4 주문에 묶이지 않은 예약은 기존처럼 1건 + 상품명 그대로', async () => {
    const now = kstNow()
    const userId = await createUser()
    const r = await createReservation(userId, 'retsolo', { returnDate: now.date, returnTime: now.time, orderId: null })
    const rows = await claimFor([r.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].product_name).toBe(r.productName)
  }, 90_000)

  it('C5 형제가 이미 이 단계 기록을 가졌으면 다시 보내지 않는다', async () => {
    const now = kstNow()
    const fx = await makeOrderWith(3, { returnDate: now.date, returnTime: now.time })
    const { error } = await admin.from('return_notice_logs').insert({ reservation_id: fx.reservationIds[1], stage: 'locker_2h' })
    expect(error).toBeNull()
    expect(await claimFor(fx.reservationIds)).toHaveLength(0)
  }, 90_000)

  it('C6 반납 대상이 아닌 상태(반납완료)의 형제는 묶음 건수에서 빠진다', async () => {
    const now = kstNow()
    const fx = await makeOrderWith(3, { returnDate: now.date, returnTime: now.time }, ['in_use', 'in_use', 'returned'])
    const rows = await claimFor(fx.reservationIds)
    expect(rows).toHaveLength(1)
    expect(rows[0].product_name).toBe(`${fx.productName} 외 1개 상품`)
  }, 90_000)

  it('C7 대표 발송이 실패해 선점을 되돌리면 형제 기록도 풀려 다음 크론에서 다시 대상이 된다(안내 영구 누락 방지)', async () => {
    const now = kstNow()
    const fx = await makeOrderWith(3, { returnDate: now.date, returnTime: now.time })
    const first = await claimFor(fx.reservationIds)
    expect(first).toHaveLength(1)
    const rep = Number(first[0].reservation_id)
    expect(await logCount(fx.reservationIds)).toBe(3)

    const { error } = await admin.rpc('release_return_notice_claim', { p_reservation_id: rep, p_stage: 'locker_2h' })
    expect(error).toBeNull()
    expect(await logCount(fx.reservationIds)).toBe(0)

    const again = await claimFor(fx.reservationIds)
    expect(again).toHaveLength(1)
    expect(Number(again[0].reservation_id)).toBe(rep)
  }, 90_000)

  it('C8 되돌리기는 다른 주문의 기록을 지우지 않는다', async () => {
    const now = kstNow()
    const a = await makeOrderWith(2, { returnDate: now.date, returnTime: now.time })
    const b = await makeOrderWith(2, { returnDate: now.date, returnTime: now.time })
    const rows = await claimFor([...a.reservationIds, ...b.reservationIds])
    expect(rows).toHaveLength(2)
    const repA = Math.min(...a.reservationIds)
    await admin.rpc('release_return_notice_claim', { p_reservation_id: repA, p_stage: 'locker_2h' })
    expect(await logCount(a.reservationIds)).toBe(0)
    expect(await logCount(b.reservationIds)).toBe(2)
  }, 90_000)
})

describe('반납 예정 안내 — 주문당 1번 (get_return_remind_targets)', () => {
  /** 이 함수는 DB의 CURRENT_DATE(UTC)와 end_date 가 같은 예약을 본다 */
  async function utcToday(): Promise<string> {
    return new Date().toISOString().slice(0, 10)
  }

  interface RemindRow { reservation_id: number; product_name: string | null }
  async function remindFor(ids: number[]): Promise<RemindRow[]> {
    const { data, error } = await admin.rpc('get_return_remind_targets', { p_limit: 1000 })
    expect(error).toBeNull()
    return ((data ?? []) as RemindRow[]).filter((r) => ids.includes(Number(r.reservation_id)))
  }

  it('R1 상품 3개짜리 주문: 대표 1건 + "외 2개 상품"', async () => {
    const today = await utcToday()
    const fx = await makeOrderWith(3, { returnDate: today, returnTime: '10:00' })
    const rows = await remindFor(fx.reservationIds)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].reservation_id)).toBe(Math.min(...fx.reservationIds))
    expect(rows[0].product_name).toBe(`${fx.productName} 외 2개 상품`)
  }, 90_000)

  it('R2 대표의 채팅카드가 나간 뒤에는 같은 주문의 형제가 다시 뽑히지 않는다', async () => {
    const today = await utcToday()
    const fx = await makeOrderWith(3, { returnDate: today, returnTime: '10:00' })
    const rep = Math.min(...fx.reservationIds)
    const { error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: rep, p_notify_type: 'return_remind' })
    expect(error).toBeNull()
    expect(await remindFor(fx.reservationIds)).toHaveLength(0)
  }, 90_000)

  it('R3 주문에 묶이지 않은 예약은 기존처럼 1건 + 상품명 그대로', async () => {
    const today = await utcToday()
    const userId = await createUser()
    const r = await createReservation(userId, 'retsolo2', { returnDate: today, returnTime: '10:00', orderId: null })
    const rows = await remindFor([r.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].product_name).toBe(r.productName)
  }, 90_000)
})

describe('반납 안내 — 관리자 대리 등록도 등록으로 본다 (claim_return_notice_targets)', { timeout: 60000 }, () => {
  it('C9 방문 반납: 대여중이고 기록 없으면 안내 대상, 관리자가 CMS 대리 등록(반납요청)하면 안내 대상에서 빠진다', async () => {
    const now = kstNow()
    const userId = await createUser()
    const r = await createReservation(userId, 'adminreg', { returnDate: now.date, returnTime: now.time, returnMethod: 'visit' })
    // 기록 없음 → 대상(무인함 정보 등록 안내)
    const first = await claimFor([r.id])
    expect(first).toHaveLength(1)
    expect(first[0].stage).toBe('locker_2h')
    // 안내 기록을 지워 다시 대상으로 만든 뒤, 관리자 대리 등록(반납요청 전환 포함)
    await admin.from('return_notice_logs').delete().eq('reservation_id', r.id)
    const { error: ee } = await admin.from('reservation_return_admin_entries').insert({ reservation_id: r.id, memo: 'tdd', checklist: [], media: [] })
    expect(ee).toBeNull()
    cleanups.push(async () => { await admin.from('reservation_return_admin_entries').delete().eq('reservation_id', r.id) })
    const { error: ue } = await admin.from('rental_reservations').update({ status: 'return_requested' }).eq('id', r.id)
    expect(ue).toBeNull()
    expect(await claimFor([r.id])).toHaveLength(0)
  })
})
