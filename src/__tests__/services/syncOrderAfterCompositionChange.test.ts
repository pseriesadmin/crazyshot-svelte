import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * sync_order_after_composition_change RPC — TDD (Migration #497)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §6
 *
 * 배경:
 *   CMS 재고구성 '+ 추가' / '✕ 삭제' 시 발생하는 두 가지 버그:
 *   ① cms_add_reservation_product_unit 의 line_total 이 raw 24h price 를 쓰고 있어
 *      12h-block 요금·옵션요금이 무시됨
 *   ② 추가·삭제 후 order.total_amount / final_amount 가 재계산되지 않음
 *   ③ 형제 reservation_code 들이 canonical(MIN id) 코드로 동기화되지 않음
 *
 * 완료기준(B-START 3항목):
 *   정상동작: 추가·삭제 후 order 금액 전체 재계산 + reservation_code canonical 동기화
 *   막아야할것: coupon_discount_amount 재계산 누락, delivery_fee/points 무시
 *   실패했을때: sync_order_after_composition_change 를 직접 호출해도 에러 없이 no-op(빈 주문)
 *
 * EC-1: cms_add_reservation_product_unit → line_total = compute_reservation_line_amount 기반 +
 *        order total_amount 재계산
 * EC-2: cms_remove_reservation_product_unit → order total_amount 재계산
 * EC-3: cms_add 후 모든 형제 reservation_code = MIN(id) 형제 코드로 동기화
 * EC-4: delivery_fee / selected_points 가 final_amount 산식에 보존됨
 * Edge: sync_order_after_composition_change 를 order_items 없는 주문에 직접 호출 → 성공·no-op
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn()
  }
})

/** 날짜 충돌(rental_reservations_product_dates_excl) 회피: 극히 먼 미래 사용 */
function randomFutureDateRange(offsetDays = 0): { start: string; end: string } {
  const base = new Date(Date.UTC(2099, 0, 1))
  const start = new Date(base.getTime() + (offsetDays + Math.floor(Math.random() * 50)) * 86400000)
  const end = new Date(start.getTime() + 3 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

/**
 * 자식이 최소 1개 있는 활성 부모 상품 ID 반환.
 * cms_add_reservation_product_unit 은 부모 product_id 를 받아 자식 재고를 원자배정하므로
 * 부모에 활성 자식이 없으면 "재고 없음" 오류가 발생한다.
 */
async function ensureParentProductWithChild(): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .select('parent_product_id')
    .not('parent_product_id', 'is', null)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .single()
  if (error || !data) throw new Error(`활성 자식 상품 조회 실패: ${error?.message}`)
  return data.parent_product_id as string
}

/**
 * 활성 부모 상품 ID 목록 반환 (단순 조회 — 자식 유무 미보장).
 * createHoldReservation 직접 INSERT 용도로만 사용.
 */
async function ensureTestProducts(count: number): Promise<string[]> {
  const { data, error } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .limit(count)
  if (error || !data || data.length < count) {
    throw new Error(`테스트용 product ${count}개 조회 실패: ${error?.message}`)
  }
  return data.map((p) => p.id as string)
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-sync-comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  cleanups.push(() =>
    admin.auth.admin.deleteUser(data.user.id).then(() => undefined).catch(() => undefined),
  )
  return data.user.id
}

/** hold 예약 직접 INSERT (테스트 픽스처 전용 — product_id 는 부모 또는 자식 무방) */
async function createHoldReservation(
  userId: string,
  productId: string,
  dateRange: { start: string; end: string },
): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    productId,
      start_date:    dateRange.start,
      end_date:      dateRange.end,
      status:        'hold',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`hold reservation 생성 실패: ${error?.message}`)
  const id = data.id as number
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  return id
}

/**
 * create_reservation_order RPC 호출 + 생성된 order_id 반환.
 * cleanup: order_items(전달된 reservationIds) + orders 행 등록.
 */
async function linkToOrder(
  userId: string,
  reservationIds: number[],
  opts: { deliveryFee?: number; selectedPoints?: number } = {},
): Promise<number> {
  const { data, error } = await admin.rpc('create_reservation_order', {
    p_user_id:         userId,
    p_reservation_ids: reservationIds,
    p_delivery_fee:    opts.deliveryFee ?? 0,
    p_selected_points: opts.selectedPoints ?? 0,
  })
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`)
  const rows = data as Array<{ order_id: number; order_key: string; final_amount: number }>
  const orderId = rows[0].order_id

  cleanups.push(async () => {
    for (const rid of reservationIds) {
      await admin.from('order_items').delete().eq('reservation_id', rid)
    }
    await admin.from('orders').delete().eq('id', orderId)
  })
  return orderId
}

// ─────────────────────────────────────────────────────────────────────────────
describe('sync_order_after_composition_change — 재고구성 변경 후 주문 동기화 (Migration #497)', () => {

  // ── EC-1 ──────────────────────────────────────────────────────────────────
  it(
    'EC-1: cms_add_reservation_product_unit → 새 order_item line_total = compute_reservation_line_amount, order total_amount 재계산',
    async () => {
      const userId    = await createEphemeralUser()
      const parentId  = await ensureParentProductWithChild()
      const [prodId2] = await ensureTestProducts(1)
      const dr1       = randomFutureDateRange(0)
      const dr2       = randomFutureDateRange(200)

      // res1 은 prodId2(별도 상품), res2 는 parentId 를 기준으로 cms_add 시 배정됨
      const res1    = await createHoldReservation(userId, prodId2, dr1)
      // res2 — parentId 로 직접 hold 생성 (이 날짜 범위에 cms_add 가 새 자식을 배정할 것)
      const resBase = await createHoldReservation(userId, parentId, dr2)
      const orderId = await linkToOrder(userId, [res1, resBase])

      // 현재 order total (초기값 — create_reservation_order 결과)
      const { data: orderBefore } = await admin
        .from('orders')
        .select('total_amount')
        .eq('id', orderId)
        .single()
      const totalBefore = Number(orderBefore?.total_amount)

      // 🔴 RED: cms_add_reservation_product_unit 은 현재 sync 를 호출하지 않아
      //         order total_amount 가 갱신되지 않는다.
      const { data: addRaw, error: addErr } = await admin.rpc('cms_add_reservation_product_unit', {
        p_reservation_id: resBase,
        p_product_id:     parentId,
      })
      expect(addErr).toBeNull()
      const addResult = (
        addRaw as Array<{ success: boolean; new_reservation_id: number; error_message: string | null }>
      )[0]
      expect(addResult.success).toBe(true)
      const newResId = addResult.new_reservation_id

      cleanups.push(async () => {
        await admin.from('order_items').delete().eq('reservation_id', newResId)
        await admin.from('rental_reservations').delete().eq('id', newResId)
      })

      // 새 예약의 compute_reservation_line_amount 로 기대 line_total 산출
      const { data: lineRaw } = await admin.rpc('compute_reservation_line_amount', {
        p_reservation_id: newResId,
      })
      const line = (
        lineRaw as Array<{ rental_fee: number; options_fee: number; deposit: number }>
      )[0]
      const expectedLineTotal = Number(line.rental_fee) + Number(line.options_fee)

      // 새 order_item 의 line_total = compute 결과여야 함 (raw 24h price 가 아님)
      const { data: oi } = await admin
        .from('order_items')
        .select('line_total')
        .eq('reservation_id', newResId)
        .single()
      expect(Number(oi?.line_total)).toBe(expectedLineTotal)

      // order total_amount = 현재 order_items 합계여야 함 (sync 가 호출됐을 때만 충족)
      const { data: orderAfter } = await admin
        .from('orders')
        .select('total_amount')
        .eq('id', orderId)
        .single()
      const { data: allItems } = await admin
        .from('order_items')
        .select('line_total')
        .eq('order_id', orderId)
      const expectedTotal =
        (allItems ?? []).reduce((s, i) => s + Number(i.line_total), 0)

      expect(Number(orderAfter?.total_amount)).toBe(expectedTotal)
      // 새 item 이 추가됐으니 total 이 증가했어야 함 (sanity)
      expect(Number(orderAfter?.total_amount)).toBeGreaterThanOrEqual(totalBefore)
    },
    30_000,
  )

  // ── EC-2 ──────────────────────────────────────────────────────────────────
  it(
    'EC-2: cms_remove_reservation_product_unit → order total_amount 재계산',
    async () => {
      const userId = await createEphemeralUser()
      const [pId1, pId2] = await ensureTestProducts(2)
      const dr1 = randomFutureDateRange(400)
      const dr2 = randomFutureDateRange(600)

      const res1    = await createHoldReservation(userId, pId1, dr1)
      const res2    = await createHoldReservation(userId, pId2, dr2)
      const orderId = await linkToOrder(userId, [res1, res2])

      // 현재 order total (두 아이템 합계)
      const { data: orderBefore } = await admin
        .from('orders')
        .select('total_amount')
        .eq('id', orderId)
        .single()
      const totalBefore = Number(orderBefore?.total_amount)

      // 🔴 RED: cms_remove 는 현재 sync 를 호출하지 않아 order total_amount 가 갱신되지 않는다.
      const { data: removeRaw, error: removeErr } = await admin.rpc(
        'cms_remove_reservation_product_unit',
        { p_target_reservation_id: res2 },
      )
      expect(removeErr).toBeNull()
      const removeResult = (
        removeRaw as Array<{ success: boolean; error_message: string | null }>
      )[0]
      expect(removeResult.success).toBe(true)

      // order total_amount = 남은 order_items 합계여야 함
      const { data: orderAfter } = await admin
        .from('orders')
        .select('total_amount')
        .eq('id', orderId)
        .single()
      const { data: remainItems } = await admin
        .from('order_items')
        .select('line_total')
        .eq('order_id', orderId)
      const expectedTotal =
        (remainItems ?? []).reduce((s, i) => s + Number(i.line_total), 0)

      expect(Number(orderAfter?.total_amount)).toBe(expectedTotal)
      // 삭제 후 total 이 줄었어야 함 (sanity)
      expect(Number(orderAfter?.total_amount)).toBeLessThan(totalBefore)
    },
    30_000,
  )

  // ── EC-3 ──────────────────────────────────────────────────────────────────
  it(
    'EC-3: cms_add_reservation_product_unit 후 모든 형제 reservation_code = MIN(id) 형제 코드',
    async () => {
      const userId   = await createEphemeralUser()
      const parentId = await ensureParentProductWithChild()
      const dr       = randomFutureDateRange(800)

      const resBase = await createHoldReservation(userId, parentId, dr)
      await linkToOrder(userId, [resBase])

      // resBase 의 reservation_code 가 canonical 이 됨 (MIN id)
      const { data: baseRow } = await admin
        .from('rental_reservations')
        .select('id, reservation_code')
        .eq('id', resBase)
        .single()
      const canonicalCode = baseRow?.reservation_code as string
      expect(canonicalCode).toBeTruthy()

      // 🔴 RED: cms_add 는 sync 를 호출하지 않아 새 예약의 reservation_code 가 canonical 로
      //         동기화되지 않는다.
      const { data: addRaw, error: addErr } = await admin.rpc('cms_add_reservation_product_unit', {
        p_reservation_id: resBase,
        p_product_id:     parentId,
      })
      expect(addErr).toBeNull()
      const addResult = (
        addRaw as Array<{ success: boolean; new_reservation_id: number; error_message: string | null }>
      )[0]
      expect(addResult.success).toBe(true)
      const newResId = addResult.new_reservation_id

      cleanups.push(async () => {
        await admin.from('order_items').delete().eq('reservation_id', newResId)
        await admin.from('rental_reservations').delete().eq('id', newResId)
      })

      // 새 예약의 reservation_code = canonical (resBase 의 코드, MIN id)
      const { data: newRow } = await admin
        .from('rental_reservations')
        .select('reservation_code')
        .eq('id', newResId)
        .single()
      expect(newRow?.reservation_code).toBe(canonicalCode)
    },
    30_000,
  )

  // ── EC-4 ──────────────────────────────────────────────────────────────────
  it(
    'EC-4: sync 후 delivery_fee·selected_points·coupon_discount_amount 를 반영한 final_amount 올바름',
    async () => {
      const userId   = await createEphemeralUser()
      const parentId = await ensureParentProductWithChild()
      const dr       = randomFutureDateRange(1000)

      const resBase = await createHoldReservation(userId, parentId, dr)

      // delivery_fee=3000, selected_points=500 으로 주문 생성
      const orderId = await linkToOrder(userId, [resBase], {
        deliveryFee:    3000,
        selectedPoints: 500,
      })

      // 🔴 RED: cms_add 후 sync 가 호출되지 않아 final_amount 가 갱신되지 않는다.
      const { data: addRaw, error: addErr } = await admin.rpc('cms_add_reservation_product_unit', {
        p_reservation_id: resBase,
        p_product_id:     parentId,
      })
      expect(addErr).toBeNull()
      const addResult = (
        addRaw as Array<{ success: boolean; new_reservation_id: number; error_message: string | null }>
      )[0]
      expect(addResult.success).toBe(true)
      const newResId = addResult.new_reservation_id

      cleanups.push(async () => {
        await admin.from('order_items').delete().eq('reservation_id', newResId)
        await admin.from('rental_reservations').delete().eq('id', newResId)
      })

      // sync 후 order 상태 확인
      const { data: order } = await admin
        .from('orders')
        .select(
          'total_amount, discount_amount, coupon_discount_amount, final_amount, selected_points, delivery_fee',
        )
        .eq('id', orderId)
        .single()

      const total         = Number(order?.total_amount)
      const discount      = Number(order?.discount_amount)
      const couponDiscount = Number(order?.coupon_discount_amount)
      const points        = Number(order?.selected_points)
      const deliveryFee   = Number(order?.delivery_fee)
      const expectedFinal = Math.max(total - discount - couponDiscount - points + deliveryFee, 0)

      // coupon 미선택 → coupon_discount_amount = 0
      expect(couponDiscount).toBe(0)
      // delivery_fee / points 보존
      expect(deliveryFee).toBe(3000)
      expect(points).toBe(500)
      // final_amount = GREATEST(total - discount - 0 - 500 + 3000, 0)
      expect(Number(order?.final_amount)).toBe(expectedFinal)
    },
    30_000,
  )

  // ── Edge ──────────────────────────────────────────────────────────────────
  it(
    'Edge: sync_order_after_composition_change 를 order_items 없는 주문에 직접 호출 → 성공·total=0',
    async () => {
      const userId = await createEphemeralUser()

      // order_items 없는 주문을 직접 INSERT
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const { data: orderRow, error: oErr } = await admin
        .from('orders')
        .insert({
          order_key:       `TEST-EDGE-SYNC-${Date.now()}`,
          user_id:         userId,
          total_amount:    9999,
          discount_amount: 0,
          final_amount:    9999,
          status:          'pending',
        })
        .select('id')
        .single()
      expect(oErr).toBeNull()
      const orderId = orderRow!.id as number

      cleanups.push(async () => {
        await admin.from('orders').delete().eq('id', orderId)
      })

      // 🔴 RED: sync_order_after_composition_change RPC 가 아직 존재하지 않는다.
      const { data: syncRaw, error: syncErr } = await admin.rpc(
        'sync_order_after_composition_change',
        { p_order_id: orderId },
      )
      expect(syncErr).toBeNull()

      const syncResult = (
        syncRaw as Array<{ success: boolean; error_message: string | null }>
      )[0]
      expect(syncResult.success).toBe(true)

      // 아이템 없음 → total = 0, final = 0
      const { data: order } = await admin
        .from('orders')
        .select('total_amount, final_amount')
        .eq('id', orderId)
        .single()
      expect(Number(order?.total_amount)).toBe(0)
      expect(Number(order?.final_amount)).toBe(0)
    },
    30_000,
  )
})
