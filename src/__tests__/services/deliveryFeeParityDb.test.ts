/**
 * TDD-RED: deliveryFeeParityDb.test.ts
 * 신청대기 예약 편집 RPC(edit_submitted_reservation_order, Migration 811)의 배송비 서버 계산 — TS calcShippingFee 와의 동치 시험 (S2 추가, 2026-11-12)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브. 같은 시나리오를 (a) TS 순수 함수(cartShippingFee.ts)와 (b) 편집 RPC 가 저장한 orders.delivery_fee 로 비교한다.
 * ⚠️ 이 파일은 Migration 811(private.calc_order_delivery_fee 포함)이 Stage 에 적용된 뒤에야 통과한다(적용 전에는 함수 부재 PGRST202 로 RED).
 * ⚠️ 전역 설정(rental_shipping_settings 첫 행·delivery_fee_discount_tiers 활성 행)을 시험 동안 임시로 바꾸고 afterEach 에서 원상 복구한다.
 *    시작 시 스냅샷을 os.tmpdir() JSON 에 기록하고 복구 뒤 대조한다(불일치 시 강제 복구 + 실패). 비정상 종료 시 수동 복구 절차는 SNAPSHOT_PATH 주석 참고. 같은 설정을 읽는 다른 시험 파일과 동시에 돌리지 말 것.
 *    Production(vnbpmvxruyciuuaermyh) 접속이면 즉시 throw.
 * S2 2차: TS 기대 소계는 서버 함수가 아니라 cartRentalFee 의 순수 함수(calcRentalFee)로 구하고, 배송 판정은 rental_method_options 행 + 장바구니 isShippingFeeMethod 규칙으로 한다.
 *
 * B-START
 *  - 정상: 편집 저장 시 배송비를 서버가 다시 계산한다 — 방문/방문 0원, 왕복·배송·반납 3-way, 우대 티어(경계 포함), 구독 무료배송, 상품별 플래그.
 *  - 막을 것: 고객이 배송비를 정하는 것(인자 자체가 없다), 편집 후 옛 배송비가 남는 것.
 *  - 실패 시: 계산 불가는 success=false·reason=DELIVERY_FEE_FAILED, 원본 불변.
 * 배송 방식 키는 Stage 의 rental_method_options(is_delivery_type=true, 'quick' 제외) 첫 행을 쓴다 — 없으면 해당 시험을 건너뛴다.
 * 시험으로 확인하지 못하는 것: 부모/자식 플래그 우선(자식 기본값 true) 외의 조합, 지역 제한이 켜진 환경(배송 주소 거절 가능), 설정 행 없음(전역 파괴), 휴무 연장 장기대여 경계(⑨ 하단 주석).
 */
import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from 'vitest'
import type { TestContext } from 'vitest'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'
import {
  calcShippingFee, calcShippingDiscountRate, applyShippingDiscount, isRoundTripShippingFee,
  type ShippingSettings, type ShippingFeeItem, type DeliveryFeeDiscountTier, type DiscountConditionItem,
} from '$lib/utils/cartShippingFee'
import { calcRentalDays, calcRentalFee } from '$lib/utils/cartRentalFee'

// 시간 제한 보정: 이 파일은 Stage 라이브 호출(사용자 생성·로그인·편집 RPC·요금 설정 변경/복구)을 여러 번 하므로 승계·'옵션 포함 줄' 티어 경계처럼 한 시험이 여러 시나리오를 도는 경우 기본 5000ms 를 넘는다.
vi.setConfig({ testTimeout: 60000 })

// ⛔ Production 오접속 가드 — 이 시험은 전역 요금 설정·우대 티어를 임시로 바꾼다. Production 이면 DB 에 접근하기 전에 즉시 중단한다.
if (PUBLIC_SUPABASE_URL.includes('vnbpmvxruyciuuaermyh')) {
  throw new Error('Production DB(vnbpmvxruyciuuaermyh) 에 연결된 환경입니다 — 이 시험은 Stage(ezyvffjvuwmtuhpxdjrw) 전용이라 실행하지 않습니다. .env.local 의 PUBLIC_SUPABASE_URL 을 확인하세요.')
}

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// 814 이후 고객 직접 호출은 막혀 있다 — service_role 로 _for_user 변형을 호출한다(p_user_id = 시험 사용자)
const FN = 'edit_submitted_reservation_order_for_user'

// ── 전역 설정 스냅샷·복구 안전장치 ─────────────────────────────────────────────
// 이 파일은 rental_shipping_settings(요금 6개 값)와 delivery_fee_discount_tiers(활성 여부)를 시험 동안 바꾼다.
//  · 시작 시 스냅샷을 os.tmpdir() 의 JSON 파일에 쓰고, 각 시험 뒤(afterEach)·전체 종료 뒤(afterAll)에 현재 값과 대조한다. 다르면 스냅샷으로 강제 복구하고 시험을 실패시킨다.
//  · 비정상 종료(프로세스 강제 종료 등)로 스냅샷 파일이 남아 있으면 다음 실행은 시작 단계에서 중단한다(오염된 값을 새 '원본'으로 오인하지 않기 위해).
//    수동 복구 절차: ① 파일을 연다(경로는 아래 SNAPSHOT_PATH, 오류 메시지에도 출력됨) ② settings 의 6개 값으로 rental_shipping_settings(id 일치 행)를 되돌린다
//    ③ tiers 의 각 id 를 is_active 값대로 되돌린다 ④ 이름이 없는 시험용 티어(min_rental_amount 가 시험값이고 스냅샷에 없는 id)가 남아 있으면 삭제 ⑤ 파일을 삭제한다. Stage 외 환경에서는 하지 않는다.
const SNAPSHOT_PATH = join(tmpdir(), 'crazyshot-deliveryFeeParity-snapshot.json')
const SETTING_KEYS = ['enable_round_trip', 'round_trip_fee', 'enable_delivery', 'delivery_fee', 'enable_return', 'return_fee'] as const
interface GlobalSnapshot {
  settingsId: string | null
  settings: Record<string, unknown> | null
  tiers: Array<{ id: string; is_active: boolean }>
}
const createdTierIds = new Set<string>()
let snapshot: GlobalSnapshot | null = null

async function readGlobalState(): Promise<GlobalSnapshot> {
  const { data: row } = await admin.from('rental_shipping_settings').select('id, enable_round_trip, round_trip_fee, enable_delivery, delivery_fee, enable_return, return_fee').limit(1).maybeSingle()
  const { data: tiers } = await admin.from('delivery_fee_discount_tiers').select('id, is_active').is('deleted_at', null)
  const r = row as (Record<string, unknown> & { id: string }) | null
  return {
    settingsId: r?.id ?? null,
    settings: r ? Object.fromEntries(SETTING_KEYS.map(k => [k, r[k]])) : null,
    tiers: ((tiers ?? []) as Array<{ id: string; is_active: boolean }>).filter(t => !createdTierIds.has(t.id)).sort((x, y) => x.id.localeCompare(y.id)),
  }
}
async function diffAgainstSnapshot(): Promise<string | null> {
  if (!snapshot) return null
  const now = await readGlobalState()
  const { data: leftover } = createdTierIds.size > 0 ? await admin.from('delivery_fee_discount_tiers').select('id').in('id', [...createdTierIds]) : { data: [] }
  const problems: string[] = []
  if (JSON.stringify(now.settings) !== JSON.stringify(snapshot.settings)) problems.push(`요금 설정 불일치 now=${JSON.stringify(now.settings)} snapshot=${JSON.stringify(snapshot.settings)}`)
  if (JSON.stringify(now.tiers) !== JSON.stringify(snapshot.tiers)) problems.push(`우대 티어 활성 상태 불일치 now=${JSON.stringify(now.tiers)} snapshot=${JSON.stringify(snapshot.tiers)}`)
  if ((leftover ?? []).length > 0) problems.push(`시험용 티어 ${(leftover ?? []).length}개가 남아 있음`)
  return problems.length > 0 ? problems.join(' / ') : null
}
async function forceRestoreFromSnapshot(): Promise<void> {
  if (!snapshot) return
  if (snapshot.settingsId && snapshot.settings) await admin.from('rental_shipping_settings').update(snapshot.settings).eq('id', snapshot.settingsId)
  for (const t of snapshot.tiers) await admin.from('delivery_fee_discount_tiers').update({ is_active: t.is_active }).eq('id', t.id)
  if (createdTierIds.size > 0) await admin.from('delivery_fee_discount_tiers').delete().in('id', [...createdTierIds])
}

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
  const diff = await diffAgainstSnapshot()
  if (diff) {
    await forceRestoreFromSnapshot()
    throw new Error(`전역 설정이 시험 후 원복되지 않아 스냅샷으로 강제 복구했습니다(${SNAPSHOT_PATH}): ${diff}`)
  }
}, 120000)
afterAll(async () => {
  const diff = await diffAgainstSnapshot()
  if (diff) {
    await forceRestoreFromSnapshot()
    throw new Error(`전체 종료 시 전역 설정이 스냅샷과 다릅니다(강제 복구함, 스냅샷 파일 보존: ${SNAPSHOT_PATH}): ${diff}`)
  }
  if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH)
}, 120000)

const slotBase = Date.now() % 1000
let slotCounter = 0
function nextRange(days = 2): { start: string; end: string } {
  slotCounter += 1
  const start = new Date(Date.UTC(2043, 0, 1) + (slotBase * 60 + slotCounter) * 7 * 86400000)
  const end = new Date(start.getTime() + days * 86400000)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return { start: f(start), end: f(end) }
}

// 방식 목록(활성·미삭제) — 장바구니 sdDeliveryOpts 와 같은 범위. 배송 판정은 키 이름이 아니라 이 행의 is_delivery_type 으로 한다.
interface MethodRow { method_key: string; is_delivery_type: boolean }
let methodRows = new Map<string, MethodRow>()
let deliveryKey: string | null = null
let quickKey: string | null = null
/** 장바구니 isDeliveryTypeMethod 와 같은 규칙 */
const isDeliveryTypeMethod = (m: string | null): boolean => !!m && methodRows.get(m)?.is_delivery_type === true
/** 장바구니 isShippingFeeMethod(isDeliveryTypeMethod && !isQuickMethod) 와 같은 규칙 */
const isShippingFeeMethod = (m: string | null): boolean => isDeliveryTypeMethod(m) && m !== 'quick'

beforeAll(async () => {
  if (existsSync(SNAPSHOT_PATH)) {
    throw new Error(`이전 실행이 비정상 종료되어 스냅샷 파일이 남아 있습니다: ${SNAPSHOT_PATH} — 파일 내용으로 Stage 의 요금 설정·우대 티어를 먼저 수동 복구한 뒤 파일을 삭제하고 다시 실행하세요(복구 절차는 이 파일 상단 주석).\n${readFileSync(SNAPSHOT_PATH, 'utf-8')}`)
  }
  snapshot = await readGlobalState()
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8')
  const { data } = await admin.from('rental_method_options').select('method_key, is_delivery_type').eq('is_active', true).is('deleted_at', null).not('method_key', 'is', null)
  methodRows = new Map(((data ?? []) as MethodRow[]).map(r => [r.method_key, r]))
  deliveryKey = [...methodRows.values()].find(r => r.is_delivery_type && r.method_key !== 'quick')?.method_key ?? null
  quickKey = methodRows.has('quick') ? 'quick' : null
})
function needDelivery(ctx: TestContext): string {
  if (!deliveryKey) { ctx.skip(); return '' }
  return deliveryKey
}
function needQuick(ctx: TestContext): string {
  if (!quickKey) { ctx.skip(); return '' }
  return quickKey
}

// ── 설정 픽스처(전역 값을 바꾸고 복구) ───────────────────────────────────────────
const TEST_SETTINGS: ShippingSettings = {
  enable_round_trip: true, round_trip_fee: 6000, enable_delivery: true, delivery_fee: 3500, enable_return: true, return_fee: 2500,
}
interface TierSpec { min_rental_amount: number; condition_types: Array<'long_term_rental' | 'sale_only_purchase' | 'rental_item'>; discount_rate: number }
async function useConfig(settings: ShippingSettings, tiers: TierSpec[]): Promise<void> {
  const { data: row } = await admin.from('rental_shipping_settings').select('*').limit(1).single()
  const original = row as Record<string, unknown> & { id: string }
  const { error: sErr } = await admin.from('rental_shipping_settings').update({
    enable_round_trip: settings.enable_round_trip, round_trip_fee: settings.round_trip_fee,
    enable_delivery: settings.enable_delivery, delivery_fee: settings.delivery_fee,
    enable_return: settings.enable_return, return_fee: settings.return_fee,
  }).eq('id', original.id)
  expect(sErr, `설정 변경 실패: ${sErr?.message}`).toBeNull()
  const { data: active } = await admin.from('delivery_fee_discount_tiers').select('id').eq('is_active', true).is('deleted_at', null)
  const activeIds = ((active ?? []) as Array<{ id: string }>).map(t => t.id)
  if (activeIds.length > 0) await admin.from('delivery_fee_discount_tiers').update({ is_active: false }).in('id', activeIds)
  const testTierIds: string[] = []
  for (const t of tiers) {
    const { data, error } = await admin.from('delivery_fee_discount_tiers').insert(t).select('id').single()
    expect(error, `티어 생성 실패: ${error?.message}`).toBeNull()
    testTierIds.push((data as { id: string }).id)
    createdTierIds.add((data as { id: string }).id)
  }
  cleanups.push(async () => {
    if (testTierIds.length > 0) await admin.from('delivery_fee_discount_tiers').delete().in('id', testTierIds)
    if (activeIds.length > 0) await admin.from('delivery_fee_discount_tiers').update({ is_active: true }).in('id', activeIds)
    await admin.from('rental_shipping_settings').update({
      enable_round_trip: original.enable_round_trip, round_trip_fee: original.round_trip_fee,
      enable_delivery: original.enable_delivery, delivery_fee: original.delivery_fee,
      enable_return: original.enable_return, return_fee: original.return_fee,
    }).eq('id', original.id)
  })
}

// ── 사용자·상품·제출 픽스처 ────────────────────────────────────────────────────
interface Session { client: SupabaseClient; userId: string }
async function createUser(): Promise<Session> {
  const email = `tdd-fee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`시험 사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`시험 사용자 로그인 실패: ${signInError.message}`)
  cleanups.push(async () => {
    const { data: res } = await admin.from('rental_reservations').select('id').eq('user_id', userId)
    const ids = ((res ?? []) as Array<{ id: number }>).map(r => r.id)
    if (ids.length > 0) {
      await admin.from('reservation_options').delete().in('reservation_id', ids)
      const { data: cs } = await admin.from('contracts').select('id').in('reservation_id', ids)
      const cids = ((cs ?? []) as Array<{ id: string }>).map(c => c.id)
      if (cids.length > 0) {
        await admin.from('contract_signings').delete().in('contract_id', cids)
        await admin.from('contracts').delete().in('id', cids)
      }
      const { data: ois } = await admin.from('order_items').select('order_id').in('reservation_id', ids)
      const oids = [...new Set(((ois ?? []) as Array<{ order_id: number }>).map(o => o.order_id))]
      await admin.from('order_items').delete().in('reservation_id', ids)
      if (oids.length > 0) {
        await admin.from('order_coupons').delete().in('order_id', oids)
        await admin.from('orders').delete().in('id', oids)
      }
      await admin.from('rental_reservations').delete().in('id', ids)
    }
    await admin.auth.admin.deleteUser(userId)
  })
  return { client, userId }
}

interface Flags { shipping_round_trip?: boolean; shipping_delivery?: boolean; shipping_return?: boolean }
async function createProduct(label: string, flags: Flags = {}, childCount = 1): Promise<string> {
  const { data: parent, error } = await admin.from('products')
    .insert({ name: `[TDD-FEE] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true, ...flags })
    .select('id').single()
  if (error || !parent) throw new Error(`부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  // 자식은 플래그를 지정하지 않는다(기본 true) — 부모 값이 우선 적용되는지 함께 확인
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: child, error: cErr } = await admin.from('products')
      .insert({ name: `[TDD-FEE] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id').single()
    if (cErr || !child) throw new Error(`자식상품 생성 실패: ${cErr?.message}`)
    childIds.push((child as { id: string }).id)
  }
  cleanups.unshift(async () => {
    await admin.from('product_option_links').delete().or(`product_id.eq.${parentId},option_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  await ensure24hPriceRule(admin, parentId)
  for (const id of childIds) await ensure24hPriceRule(admin, id)
  return parentId
}

interface Submitted { ids: number[]; orderId: number }
/** 방문/방문 신청대기 주문(기준 상태)을 만든다 */
async function submit(s: Session, productIds: string[], range: { start: string; end: string }): Promise<Submitted> {
  const ids: number[] = []
  for (const productId of productIds) {
    const { data, error } = await s.client.rpc('create_hold_reservation', {
      p_product_id: productId, p_start_date: range.start, p_end_date: range.end, p_pickup_method: 'visit', p_return_method: 'visit',
    })
    const row = (data as Array<{ success: boolean; reservation_id: number | null; error_message: string | null }> | null)?.[0]
    if (error || !row?.success || row.reservation_id == null) throw new Error(`hold 생성 실패: ${error?.message ?? row?.error_message}`)
    ids.push(row.reservation_id)
  }
  const { data: order, error: oErr } = await admin.rpc('create_reservation_order', { p_user_id: s.userId, p_reservation_ids: ids })
  const o = (order as Array<{ order_id: number }> | null)?.[0]
  if (oErr || !o) throw new Error(`주문 연결 실패: ${oErr?.message}`)
  return { ids, orderId: o.order_id }
}

interface Line {
  keep?: boolean; reservation_id?: number; product_id?: string; start_date?: string; end_date?: string; pickup_method?: string; return_method?: string
  pickup_time?: string; return_time?: string; duration_type?: string
  pickup_address_road?: string; pickup_address_detail?: string; return_address_road?: string; return_address_detail?: string
  options?: Array<{ option_product_id: string; qty: number }>
}
const ADDR = { road: '서울특별시 강남구 테헤란로 152', detail: '1층' }
function newLine(productId: string, r: { start: string; end: string }, pickup = 'visit', ret: string | null = 'visit'): Line {
  return {
    product_id: productId, start_date: r.start, end_date: r.end, pickup_method: pickup, ...(ret !== null ? { return_method: ret } : {}),
    pickup_time: '10:00', return_time: '18:00', duration_type: '24h',
    ...(isDeliveryTypeMethod(pickup) ? { pickup_address_road: ADDR.road, pickup_address_detail: ADDR.detail } : {}),
    ...(ret !== null && isDeliveryTypeMethod(ret) ? { return_address_road: ADDR.road, return_address_detail: ADDR.detail } : {}),
  }
}
const keepLine = (id: number): Line => ({ keep: true, reservation_id: id })

interface EditResult { success: boolean; reason: string; message?: string; reservation_ids?: number[]; final_amount?: number }
async function edit(s: Session, anchor: number, expected: number[], lines: Line[]): Promise<EditResult> {
  const { data, error } = await admin.rpc(FN, { p_user_id: s.userId, p_reservation_id: anchor, p_expected_reservation_ids: expected, p_lines: lines })
  expect(error, `편집 함수 오류: ${error?.code} ${error?.message}`).toBeNull()
  return data as EditResult
}
async function feeOf(orderId: number): Promise<number> {
  const { data } = await admin.from('orders').select('delivery_fee').eq('id', orderId).single()
  return (data as { delivery_fee: number }).delivery_fee
}

// ── TS 기대값 — 화면(cart/+page.svelte)이 하는 계산을 같은 순서·같은 순수 함수로 재현 ──────────────
// 소계: cart 의 groupRentalAndOptions(= itemRentalFee × 수량 + 옵션 1회)는 +page.svelte 안의 지역 함수라 가져올 수 없다. 그 함수가 부르는 순수 함수 calcRentalFee(cartRentalFee.ts)를 같은 입력으로 호출해 같은 값을 만든다.
//   (휴무일 연장·판매전용·옵션 12h 특례는 이 시험 날짜·상품에 없으므로 생략 — 옵션은 12h 요금이 없으면 unitPrice×qty, 있으면 calcRentalFee)
//   서버 compute_reservation_line_amount 는 일부러 쓰지 않는다 — 서버 결과로 서버 결과를 검증하는 순환을 피한다.
// 배송 판정: 키 이름 비교가 아니라 rental_method_options 행(활성·미삭제)을 읽어 장바구니 isShippingFeeMethod 와 같은 규칙(isDeliveryTypeMethod && quick 제외)으로 한다.
interface ScenarioOption { productId: string; qty: number }
interface ScenarioLine { productId: string; pickup: string; ret: string | null; flags: Required<Flags>; qty: number; options: ScenarioOption[] }
const ALL_TRUE: Required<Flags> = { shipping_round_trip: true, shipping_delivery: true, shipping_return: true }
async function ratesOf(productId: string): Promise<{ r24: number | null; r12: number | null }> {
  const { data } = await admin.from('price_rules').select('duration_type, price').eq('product_id', productId).eq('is_active', true).is('deleted_at', null)
  const rows = (data ?? []) as Array<{ duration_type: string; price: number }>
  const pick = (t: string): number | null => { const v = rows.filter(r => r.duration_type === t).map(r => Number(r.price)); return v.length ? Math.max(...v) : null }
  return { r24: pick('24h'), r12: pick('12h') }
}
async function tsSubtotal(lines: ScenarioLine[], range: { start: string; end: string }): Promise<number> {
  let sum = 0
  for (const l of lines) {
    const { r24, r12 } = await ratesOf(l.productId)
    if (r24 === null) continue
    const locked = isDeliveryTypeMethod(l.pickup)
    const common = { startDate: range.start, endDate: range.end, pickupTime: '10:00', returnTime: '18:00', deliveryLocked: locked }
    sum += calcRentalFee({ ...common, dailyPrice: r24, halfDayPrice: r12 }) * l.qty
    for (const o of l.options) {
      const or = await ratesOf(o.productId)
      if (or.r24 === null) continue
      sum += or.r12 == null ? or.r24 * o.qty : calcRentalFee({ ...common, dailyPrice: or.r24, halfDayPrice: or.r12 }) * o.qty
    }
  }
  return sum
}
interface Expected { fee: number; subtotal: number; rawFee: number }
async function expectedFee(s: Session, ids: number[], lines: ScenarioLine[], range: { start: string; end: string }, settings: ShippingSettings, tiers: TierSpec[]): Promise<Expected> {
  const subtotal = await tsSubtotal(lines, range)
  const items: ShippingFeeItem[] = lines.map(l => ({
    pickupIsDelivery: isShippingFeeMethod(l.pickup), returnIsDelivery: isShippingFeeMethod(l.ret), ...l.flags,
  }))
  const rawFee = calcShippingFee(settings, items)
  const dItems: DiscountConditionItem[] = lines.map(() => ({ rentalDays: calcRentalDays(range.start, range.end), saleOnlyPurchase: false }))
  const rate = calcShippingDiscountRate(tiers as DeliveryFeeDiscountTier[], subtotal, dItems, 0)
  let fee = applyShippingDiscount(rawFee, rate, isRoundTripShippingFee(items))
  if (fee > 0) {
    // create-order API 와 같은 결합: 구독 무료배송 판정(소진 없음)
    const { data } = await admin.rpc('apply_subscription_free_shipping', { p_user_id: s.userId, p_reservation_ids: ids, p_consume: false })
    if ((data as { applies?: boolean } | null)?.applies) fee = 0
  }
  return { fee, subtotal, rawFee }
}

interface ScenarioOpts {
  pickup: string; ret: string | null; flags?: Required<Flags>; settings?: ShippingSettings; tiers?: TierSpec[]; days?: number; session?: Session
  qty?: number; withOption?: boolean
}
/** 방문/방문 주문을 만든 뒤 한 줄(또는 qty 줄)을 지정한 방식으로 교체 저장하고 (DB 값, TS 기대값)을 돌려준다 */
async function runScenario(opts: ScenarioOpts): Promise<{ dbFee: number; expected: Expected }> {
  const settings = opts.settings ?? TEST_SETTINGS
  const tiers = opts.tiers ?? []
  await useConfig(settings, tiers)
  const s = opts.session ?? await createUser()
  const flags = opts.flags ?? ALL_TRUE
  const qty = opts.qty ?? 1
  const p = await createProduct('시나리오', flags, qty)
  let option: string | null = null
  if (opts.withOption) {
    option = await createProduct('시나리오옵션', {}, 1)
    const { error } = await admin.from('product_option_links').insert({ product_id: p, option_product_id: option })
    if (error) throw new Error(`옵션 연결 실패: ${error.message}`)
  }
  const range = nextRange(opts.days ?? 2)
  const sub = await submit(s, Array.from({ length: qty }, () => p), range)
  const lines = Array.from({ length: qty }, (_, i) => ({
    ...newLine(p, range, opts.pickup, opts.ret),
    ...(i === 0 && option ? { options: [{ option_product_id: option, qty: 1 }] } : {}),
  }))
  const res = await edit(s, sub.ids[0], sub.ids, lines)
  expect(res, JSON.stringify(res)).toMatchObject({ success: true, reason: 'ok' })
  const ids = res.reservation_ids as number[]
  const expected = await expectedFee(s, ids, [{ productId: p, pickup: opts.pickup, ret: opts.ret, flags, qty, options: option ? [{ productId: option, qty: 1 }] : [] }], range, settings, tiers)
  return { dbFee: await feeOf(sub.orderId), expected }
}

describe('[TDD] ① 방문/방문 — 0원', () => {
  it('수령·반납 모두 방문이면 배송비 0원(TS 와 동일)', async () => {
    const r = await runScenario({ pickup: 'visit', ret: 'visit' })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
})

describe('[TDD] ② 배송 수령/반납 3-way — 왕복·배송·반납 중 하나만 1회', () => {
  it('수령·반납 둘 다 배송 → 왕복요금 6000', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k })
    expect(r.expected.fee).toBe(6000)
    expect(r.dbFee).toBe(r.expected.fee)
  })
  it('수령만 배송 → 배송요금 3500', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: 'visit' })
    expect(r.expected.fee).toBe(3500)
    expect(r.dbFee).toBe(r.expected.fee)
  })
  it('방문 수령 + 배송 반납(반납만 배송)은 정책상 불가 — RETURN_DELIVERY_RESTRICTED 로 거절되고 주문 배송비·예약은 그대로(rental-policy §1-2)', async (ctx) => {
    const k = needDelivery(ctx)
    await useConfig(TEST_SETTINGS, [])
    const s = await createUser()
    const p = await createProduct('반납만배송')
    const range = nextRange(2)
    const sub = await submit(s, [p], range)
    const res = await edit(s, sub.ids[0], sub.ids, [newLine(p, range, 'visit', k)])
    expect(res.success, JSON.stringify(res)).toBe(false)
    expect(res.reason).toBe('RETURN_DELIVERY_RESTRICTED')
    expect(await feeOf(sub.orderId)).toBe(0)
    const { data: r0 } = await admin.from('rental_reservations').select('status').eq('id', sub.ids[0]).single()
    expect((r0 as { status: string }).status).toBe('hold')
  })
  it('해당 요금이 비활성(enable_*=false)이면 0원', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, settings: { ...TEST_SETTINGS, enable_round_trip: false } })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
})

describe('[TDD] ③ 우대 티어 임계 경계 — 소계가 임계값과 같으면 적용, 1원 모자라면 미적용', () => {
  async function boundary(ctx: TestContext, rate: number, pickup: 'rt' | 'dl'): Promise<void> {
    const k = needDelivery(ctx)
    const pk = k, rt = pickup === 'rt' ? k : 'visit'
    // 1단계: 티어 없이 소계를 알아낸다
    const base = await runScenario({ pickup: pk, ret: rt })
    const subtotal = base.expected.subtotal
    expect(subtotal).toBeGreaterThan(0)
    // 2단계: 임계값 = 소계(경계 위·포함) → 적용
    const atEdge = await runScenario({ pickup: pk, ret: rt, tiers: [{ min_rental_amount: subtotal, condition_types: ['rental_item'], discount_rate: rate }] })
    expect(atEdge.expected.subtotal).toBe(subtotal)
    expect(atEdge.dbFee).toBe(atEdge.expected.fee)
    // 3단계: 임계값 = 소계+1(경계 바로 아래) → 미적용(정가)
    const below = await runScenario({ pickup: pk, ret: rt, tiers: [{ min_rental_amount: subtotal + 1, condition_types: ['rental_item'], discount_rate: rate }] })
    expect(below.expected.fee).toBe(below.expected.rawFee)
    expect(below.dbFee).toBe(below.expected.rawFee)
  }
  it('무료(1.0) 티어 — 왕복', async (ctx) => { await boundary(ctx, 1, 'rt') })
  it('50% 티어 — 왕복에는 적용(3000)', async (ctx) => { await boundary(ctx, 0.5, 'rt') })
  it('50% 티어 — 편도(배송만)에는 적용되지 않는다(정가 3500)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: 'visit', tiers: [{ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 0.5 }] })
    expect(r.expected.fee).toBe(3500)
    expect(r.dbFee).toBe(3500)
  })
  it('장기대여(3일 이상) 조건 티어 — 2일이면 미적용, 3일이면 적용(TS 와 동일)', async (ctx) => {
    const k = needDelivery(ctx)
    const tiers: TierSpec[] = [{ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 1 }]
    const short = await runScenario({ pickup: k, ret: k, tiers, days: 2 })
    expect(short.dbFee).toBe(short.expected.fee)
    expect(short.dbFee).toBe(6000)
    const long = await runScenario({ pickup: k, ret: k, tiers, days: 3 })
    expect(long.dbFee).toBe(long.expected.fee)
    expect(long.dbFee).toBe(0)
  })
  it('여러 티어가 동시에 맞으면 할인율이 가장 큰 1개만(스태킹 없음)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, tiers: [
      { min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 0.5 },
      { min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 1 },
    ] })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
})

describe('[TDD] ④ 구독 무료배송 — create-order API 와 같은 판정(소진 없음)', () => {
  async function withSubscription(userId: string, shippingType: 'round_trip' | 'one_way'): Promise<void> {
    const { data: plan, error } = await admin.from('subscription_plans')
      .insert({ name: `__TEST_FEEPARITY_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, monthly_price: 9900, status: 'active' }).select('id').single()
    if (error || !plan) throw new Error(`플랜 생성 실패: ${error?.message}`)
    const planId = (plan as { id: number }).id
    await admin.from('tier_benefits').insert({ plan_id: planId, benefit_type: 'FREE_SHIPPING', is_enabled: true, benefit_params: { shipping_type: shippingType, monthly_limit: null } })
    const { data: sub, error: sErr } = await admin.from('user_subscriptions')
      .insert({ user_id: userId, plan_id: planId, status: 'active', billing_key: `billing_FEEPARITY_${Date.now()}`, billing_cycle_day: 1, fail_count: 0 }).select('id').single()
    if (sErr || !sub) throw new Error(`구독 생성 실패: ${sErr?.message}`)
    const subId = (sub as { id: number }).id
    cleanups.push(async () => {
      await admin.from('subscription_benefit_usage').delete().eq('user_subscription_id', subId)
      await admin.from('user_subscriptions').delete().eq('id', subId)
      await admin.from('tier_benefits').delete().eq('plan_id', planId)
      await admin.from('subscription_plans').delete().eq('id', planId)
    })
  }
  it('왕복 혜택 구독 + 왕복 배송 주문 → 0원, 사용 횟수는 소진되지 않는다', async (ctx) => {
    const k = needDelivery(ctx)
    const s = await createUser()
    await withSubscription(s.userId, 'round_trip')
    const r = await runScenario({ pickup: k, ret: k, session: s })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
    const { data: usage } = await admin.from('subscription_benefit_usage').select('id').eq('benefit_type', 'FREE_SHIPPING')
      .in('user_subscription_id', ((await admin.from('user_subscriptions').select('id').eq('user_id', s.userId)).data ?? []).map((x: { id: number }) => x.id))
    expect(usage ?? []).toHaveLength(0)
  })
  it('왕복 혜택 구독 + 편도(배송만) 주문 → 유형 불일치로 미적용(3500)', async (ctx) => {
    const k = needDelivery(ctx)
    const s = await createUser()
    await withSubscription(s.userId, 'round_trip')
    const r = await runScenario({ pickup: k, ret: 'visit', session: s })
    expect(r.expected.fee).toBe(3500)
    expect(r.dbFee).toBe(3500)
  })
  it('편도 혜택(one_way) 구독 + 편도(배송만) 주문 → TS 판정과 같다(같은 apply_subscription_free_shipping 판정 결합)', async (ctx) => {
    const k = needDelivery(ctx)
    const s = await createUser()
    await withSubscription(s.userId, 'one_way')
    const r = await runScenario({ pickup: k, ret: 'visit', session: s })
    expect(r.dbFee).toBe(r.expected.fee)
    expect([0, 3500]).toContain(r.dbFee)
  })
  it('편도 혜택(one_way) 구독 + 왕복 주문 → TS 판정과 같다(유형 불일치면 정가 6000)', async (ctx) => {
    const k = needDelivery(ctx)
    const s = await createUser()
    await withSubscription(s.userId, 'one_way')
    const r = await runScenario({ pickup: k, ret: k, session: s })
    expect(r.dbFee).toBe(r.expected.fee)
  })
  it('구독이 없는 사용자는 정가(6000)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k })
    expect(r.dbFee).toBe(6000)
  })
})

describe('[TDD] ⑤ 줄 추가·삭제·교체로 소계가 바뀌어 티어가 달라진다', () => {
  it('한 줄 정가 → 줄 추가로 무료 티어 적용 → 줄 삭제로 다시 정가', async (ctx) => {
    const k = needDelivery(ctx)
    const s = await createUser()
    const p1 = await createProduct('티어줄1')
    const p2 = await createProduct('티어줄2')
    const range = nextRange(2)
    // 한 줄 소계를 먼저 알아낸다(티어 없음)
    await useConfig(TEST_SETTINGS, [])
    const sub = await submit(s, [p1], range)
    const r1 = await edit(s, sub.ids[0], sub.ids, [newLine(p1, range, k, 'visit')])
    expect(r1.success).toBe(true)
    const e1 = await expectedFee(s, r1.reservation_ids as number[], [{ productId: p1, pickup: k, ret: 'visit', flags: ALL_TRUE, qty: 1, options: [] }], range, TEST_SETTINGS, [])
    const oneLineSubtotal = e1.subtotal
    expect(await feeOf(sub.orderId)).toBe(3500)
    // 티어: 소계가 한 줄 소계보다 클 때만 무료
    const tier: TierSpec = { min_rental_amount: oneLineSubtotal + 1, condition_types: ['rental_item'], discount_rate: 1 }
    await useConfig(TEST_SETTINGS, [tier])
    const ids1 = r1.reservation_ids as number[]
    const r2 = await edit(s, ids1[0], ids1, [keepLine(ids1[0]), newLine(p2, range, k, 'visit')])
    expect(r2.success, JSON.stringify(r2)).toBe(true)
    const ids2 = r2.reservation_ids as number[]
    const e2 = await expectedFee(s, ids2, [
      { productId: p1, pickup: k, ret: 'visit', flags: ALL_TRUE, qty: 1, options: [] }, { productId: p2, pickup: k, ret: 'visit', flags: ALL_TRUE, qty: 1, options: [] },
    ], range, TEST_SETTINGS, [tier])
    expect(e2.fee).toBe(0)
    expect(await feeOf(sub.orderId)).toBe(0)
    // 한 줄 삭제 → 소계가 임계 아래로 → 정가
    const r3 = await edit(s, ids2[0], ids2, [keepLine(ids2[0])])
    expect(r3.success, JSON.stringify(r3)).toBe(true)
    expect(await feeOf(sub.orderId)).toBe(3500)
  })
  it('줄 교체(다른 상품·다른 기간)도 같은 규칙으로 재계산된다', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: 'visit', days: 5 })
    expect(r.dbFee).toBe(r.expected.fee)
  })
})

describe('[TDD] ⑥ 수령/반납 방식 변경 시 배송비 재계산', () => {
  it('방문/방문(0) → 배송/방문(3500) → 배송/배송(6000) → 방문/방문(0)', async (ctx) => {
    const k = needDelivery(ctx)
    await useConfig(TEST_SETTINGS, [])
    const s = await createUser()
    const p = await createProduct('방식변경')
    const range = nextRange(2)
    const sub = await submit(s, [p], range)
    let ids = sub.ids
    // 방문 수령 + 배송 반납은 정책상 불가(RETURN_DELIVERY_RESTRICTED)라 도달 가능한 전이만 쓴다
    const steps: Array<[string, string, number]> = [[k, 'visit', 3500], [k, k, 6000], ['visit', 'visit', 0]]
    for (const [pk, rt, want] of steps) {
      const res = await edit(s, ids[0], ids, [newLine(p, range, pk, rt)])
      expect(res.success, JSON.stringify(res)).toBe(true)
      ids = res.reservation_ids as number[]
      expect(await feeOf(sub.orderId)).toBe(want)
    }
  })
})

describe('[TDD] ⑦ 상품별 shipping_* 플래그 예외 — 하나라도 false 면 그 요금 전체 미적용', () => {
  it('배송요금 플래그 false 상품 + 수령만 배송 → 0원(반납요금 플래그만 false 면 3500 유지)', async (ctx) => {
    const k = needDelivery(ctx)
    const off = await runScenario({ pickup: k, ret: 'visit', flags: { ...ALL_TRUE, shipping_delivery: false } })
    expect(off.expected.fee).toBe(0)
    expect(off.dbFee).toBe(0)
    const unrelated = await runScenario({ pickup: k, ret: 'visit', flags: { ...ALL_TRUE, shipping_return: false } })
    expect(unrelated.expected.fee).toBe(3500)
    expect(unrelated.dbFee).toBe(3500)
  })
  it('왕복요금 플래그 false 상품 + 왕복 → 0원(부모 값 우선 — 자식은 기본 true 인데도 0)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, flags: { ...ALL_TRUE, shipping_round_trip: false } })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
  it('두 상품 중 하나만 플래그 false 여도 그 요금 전체 미적용(보수적 처리)', async (ctx) => {
    const k = needDelivery(ctx)
    await useConfig(TEST_SETTINGS, [])
    const s = await createUser()
    const pOk = await createProduct('플래그정상')
    const pOff = await createProduct('플래그끔', { shipping_delivery: false })
    const range = nextRange(2)
    const sub = await submit(s, [pOk, pOff], range)
    const res = await edit(s, sub.ids[0], sub.ids, [newLine(pOk, range, k, 'visit'), newLine(pOff, range, k, 'visit')])
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(await feeOf(sub.orderId)).toBe(0)
  })
})

describe('[TDD] ⑧ 클라이언트가 배송비를 보낼 방법이 없다', () => {
  it('p_delivery_fee 를 실어 호출하면 함수 불일치 오류이고 주문 배송비는 그대로다', async (ctx) => {
    const k = needDelivery(ctx)
    await useConfig(TEST_SETTINGS, [])
    const s = await createUser()
    const p = await createProduct('인자없음')
    const range = nextRange(2)
    const sub = await submit(s, [p], range)
    const { error } = await admin.rpc(FN, { p_user_id: s.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [newLine(p, range, k, k)], p_delivery_fee: 0 })
    expect(error).not.toBeNull()
    expect(await feeOf(sub.orderId)).toBe(0)
  })
  it('편집 RPC 가 저장한 배송비는 항상 서버 계산값이다(설정 요금 6000, 고객이 정할 입력 경로 없음)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k })
    expect([0, 6000]).toContain(r.dbFee)
    expect(r.dbFee).toBe(r.expected.fee)
  })
})

describe('[TDD] ⑨ 판정 경계·수량·옵션·설정 조합 — TS 순수 함수와 동일', () => {
  it('퀵서비스(quick)는 배송료 계산에서 제외된다 — 수령이 quick 이어도 0원(키 비교가 아니라 방식 행 + quick 제외 규칙)', async (ctx) => {
    const q = needQuick(ctx)
    const r = await runScenario({ pickup: q, ret: 'visit' })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
  it('반납 방식이 없는(NULL) 주문: 수령만 배송 → 배송요금(3500), 왕복·반납으로 오인하지 않는다', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: null })
    expect(r.expected.fee).toBe(3500)
    expect(r.dbFee).toBe(3500)
  })
  it('수량 2(예약 2건): 왕복 배송요금은 수량과 무관하게 1회(6000)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, qty: 2 })
    expect(r.expected.fee).toBe(6000)
    expect(r.dbFee).toBe(6000)
  })
  it('옵션 포함 줄: 소계에 옵션이 들어가 우대 티어 경계가 TS 와 같다(소계와 같으면 무료, 1원 모자라면 정가)', async (ctx) => {
    const k = needDelivery(ctx)
    const base = await runScenario({ pickup: k, ret: 'visit', withOption: true })
    const subtotal = base.expected.subtotal
    expect(subtotal).toBeGreaterThan(0)
    const atEdge = await runScenario({ pickup: k, ret: 'visit', withOption: true, tiers: [{ min_rental_amount: subtotal, condition_types: ['rental_item'], discount_rate: 1 }] })
    expect(atEdge.expected.fee).toBe(0)
    expect(atEdge.dbFee).toBe(0)
    const below = await runScenario({ pickup: k, ret: 'visit', withOption: true, tiers: [{ min_rental_amount: subtotal + 1, condition_types: ['rental_item'], discount_rate: 1 }] })
    expect(below.expected.fee).toBe(3500)
    expect(below.dbFee).toBe(3500)
  })
  it('배송요금 비활성(enable_delivery=false) → 수령만 배송 0원', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: 'visit', settings: { ...TEST_SETTINGS, enable_delivery: false } })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(0)
  })
  it('3-way 우선순위: 왕복(배송/배송)은 반납요금 비활성(enable_return=false)과 무관하게 왕복요금(6000)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, settings: { ...TEST_SETTINGS, enable_return: false } })
    expect(r.expected.fee).toBe(6000)
    expect(r.dbFee).toBe(r.expected.fee)
  })
  it('3-way 우선순위: 왕복요금 비활성(enable_round_trip=false)이면 배송/배송은 편도로 대체되지 않고 0원', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, settings: { ...TEST_SETTINGS, enable_round_trip: false, enable_delivery: true } })
    expect(r.expected.fee).toBe(0)
    expect(r.dbFee).toBe(r.expected.fee)
  })
  it('50% 티어 + 배송/방문(편도) → 편도라 할인 미적용, 정가(3500)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: 'visit', tiers: [{ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 0.5 }] })
    expect(r.expected.fee).toBe(3500)
    expect(r.dbFee).toBe(3500)
  })
  it('홀수 요금 50% 할인은 반올림(6001 → 3001, JS Math.round 와 같다)', async (ctx) => {
    const k = needDelivery(ctx)
    const r = await runScenario({ pickup: k, ret: k, settings: { ...TEST_SETTINGS, round_trip_fee: 6001 }, tiers: [{ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 0.5 }] })
    expect(r.expected.fee).toBe(3001)
    expect(r.dbFee).toBe(3001)
  })
  for (const kind of ['inactive', 'deleted'] as const) {
    it(`${kind === 'inactive' ? '비활성' : '삭제된'} 방식 키는 배송 아님(0원)으로 저장되지 않고 거절된다(fail-closed) — 주문 배송비·예약은 그대로`, async () => {
      await useConfig(TEST_SETTINGS, [])
      const s = await createUser()
      const p = await createProduct('죽은방식')
      const range = nextRange(2)
      const sub = await submit(s, [p], range)
      const key = `tdd_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const { data: row, error } = await admin.from('rental_method_options').insert({
        name: `[TDD-FEE] ${kind}`, method_key: key, is_delivery_type: true, display_order: 99,
        is_active: kind !== 'inactive', deleted_at: kind === 'deleted' ? new Date().toISOString() : null,
      }).select('id').single()
      expect(error, `방식 행 생성 실패: ${error?.message}`).toBeNull()
      cleanups.push(async () => { await admin.from('rental_method_options').delete().eq('id', (row as { id: string }).id) })
      const res = await edit(s, sub.ids[0], sub.ids, [{ ...newLine(p, range, key, 'visit'), pickup_address_road: ADDR.road, pickup_address_detail: ADDR.detail }])
      expect(res.success).toBe(false)
      expect(['INVALID_METHOD', 'DELIVERY_FEE_FAILED', 'BAD_REQUEST']).toContain(res.reason)
      expect(await feeOf(sub.orderId)).toBe(0)
      const { data: r0 } = await admin.from('rental_reservations').select('status').eq('id', sub.ids[0]).single()
      expect((r0 as { status: string }).status).toBe('hold')
    })
  }
  // 시험하지 않는 것(사유):
  //  · '설정 행 없음' — rental_shipping_settings 의 유일한 행을 지워야 하는 전역 파괴 시험이라 Stage 공용 DB 에서 하지 않는다(SQL 은 행 없음 → 0, TS 는 settings=null → 0 으로 같다는 것을 코드 대조로만 확인).
  //  · 장기대여 경계(고른 기간 2일 + 휴무 연장 1일) — 휴무일 연장은 택배의존 방식 + 공휴일/일요일 데이터에 의존해 Stage 상태에 따라 재현이 달라진다. DB 는 연장 후 저장 날짜, TS 는 고른 날짜 기준이라 이 경계에서 차이가 날 수 있음(마이그레이션 주석에 명시).
})

describe('[TDD] 계산 함수는 외부에서 호출할 수 없다(서버 전용)', () => {
  it('private 함수는 PostgREST 로 노출되지 않는다', async () => {
    const { error } = await admin.rpc('calc_order_delivery_fee', { p_user_id: '00000000-0000-0000-0000-000000000000', p_reservation_ids: [1] })
    expect(error).not.toBeNull()
  })
})
