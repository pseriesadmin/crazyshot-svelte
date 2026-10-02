import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * cms_add_reservation_product_unit — 주문에 CMS로 상품을 추가할 때 대여 일정 정보 복사 — TDD (2026-10-02, Migration #619)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 배경(실사고): 조이서 주문 45 — CMS "+ 추가"로 SONY PXW-Z90을 추가한 예약 237이 수령/반납 시간·지점을 갖지 않아
 *   요금 함수(compute_reservation_line_amount)가 같은 날 대여를 0분(=0원)으로 계산, 주문 결제금액이 0원으로 표시됐다.
 *   RPC가 INSERT에서 날짜·방식·기간유형만 복사하고 pickup_time/return_time/지점/휴무일 연장일/주소·요청사항을 빠뜨린 것이 원인.
 *
 * 완료기준(B-START):
 *   정상 동작   : 추가된 예약이 원본의 수령/반납 시간·지점·연장일·주소·요청사항을 그대로 복사하고,
 *                order_items 금액이 0원이 아니며 주문 합계(total/final)에 반영된다.
 *   막아야 할 것 : 코드·운송장·결제확인 시각 등 예약 고유값은 복사하지 않는다.
 *   실패했을 때  : 시간이 비면 같은 날 대여 금액이 0원이 되어 주문 결제금액이 실제보다 적게 청구된다.
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트 — Migration #619 적용 전에는 실패하는 것이 정상.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let mainProductId: string;      // 원본 예약의 상품(부모 id 직접 사용 — 기존 테스트 관행)
let addParentId: string;        // 추가할 상품(활성 재고 유닛 + 요금 규칙 보유)
let pickupPointId: string | null = null;
const createdUserIds: string[] = [];

const _slotBase = Date.now() % 1000;
let _slotCounter = 0;
function futureDay(): string {
  _slotCounter += 1;
  const d = new Date(Date.UTC(2043, 0, 1) + (_slotBase * 50 + _slotCounter) * 5 * 86400000);
  return d.toISOString().slice(0, 10);
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-addunit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

beforeAll(async () => {
  // 추가 대상: 요금 규칙(24h)을 가진 활성 재고 유닛이 있는 부모 상품
  const { data: units, error } = await admin
    .from('products')
    .select('id, parent_product_id, price_rules!inner(duration_type, is_active, deleted_at)')
    .not('parent_product_id', 'is', null)
    .eq('is_active', true)
    .is('deleted_at', null)
    .eq('price_rules.duration_type', '24h')
    .eq('price_rules.is_active', true)
    .is('price_rules.deleted_at', null)
    .limit(1);
  if (error || !units || units.length === 0) throw new Error('요금 규칙을 가진 활성 재고 유닛이 Stage에 없습니다.');
  addParentId = (units[0] as { parent_product_id: string }).parent_product_id;

  // 원본 상품: 추가 대상과 다른 부모 상품
  const { data: mains } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .eq('is_active', true)
    .neq('id', addParentId)
    .limit(1);
  if (!mains || mains.length === 0) throw new Error('원본용 부모 상품이 없습니다.');
  mainProductId = (mains[0] as { id: string }).id;
  await ensure24hPriceRule(admin, mainProductId);

  const { data: pp } = await admin.from('pickup_points').select('id').limit(1);
  pickupPointId = (pp as Array<{ id: string }> | null)?.[0]?.id ?? null;
});

afterAll(async () => {
  for (const uid of createdUserIds) {
    const { data: rs } = await admin.from('rental_reservations').select('id').eq('user_id', uid);
    const ids = ((rs ?? []) as Array<{ id: number }>).map(r => r.id);
    if (ids.length > 0) {
      await admin.from('order_items').delete().in('reservation_id', ids);
      await admin.from('rental_reservations').delete().in('id', ids);
    }
    await admin.from('orders').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
});

async function setupOrderWithOneReservation(): Promise<{ userId: string; resId: number; day: string; orderId: number }> {
  const userId = await createEphemeralUser();
  const day = futureDay();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId, product_id: mainProductId, start_date: day, end_date: day, status: 'hold',
      pickup_method: 'visit', return_method: 'visit', duration_type: '12h',
      pickup_time: '13:30', return_time: '22:30',
      pickup_point_id: pickupPointId, return_point_id: pickupPointId,
      pickup_request_note: '수령 요청사항', return_request_note: '반납 요청사항',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`원본 예약 생성 실패: ${error?.message}`);
  const resId = (data as { id: number }).id;
  const { data: ord, error: oe } = await admin.rpc('create_reservation_order', { p_user_id: userId, p_reservation_ids: [resId] });
  if (oe) throw new Error(`주문 생성 실패: ${oe.message}`);
  const orderId = (ord as Array<{ order_id: number }>)[0].order_id;
  return { userId, resId, day, orderId };
}

describe('cms_add_reservation_product_unit — 일정 정보 복사 (Migration #619)', () => {
  it('Happy: 추가된 예약이 원본의 수령/반납 시간·지점·요청사항을 복사하고, 금액이 0원이 아니며 주문 합계에 반영된다', async () => {
    const { resId, orderId } = await setupOrderWithOneReservation();

    const { data, error } = await admin.rpc('cms_add_reservation_product_unit', { p_reservation_id: resId, p_product_id: addParentId });
    expect(error).toBeNull();
    const res = (data as Array<{ success: boolean; new_reservation_id: number | null; error_message: string | null }>)[0];
    expect(res.error_message).toBeNull();
    expect(res.success).toBe(true);
    const newId = res.new_reservation_id as number;

    const { data: n } = await admin
      .from('rental_reservations')
      .select('pickup_time, return_time, pickup_point_id, return_point_id, pickup_request_note, return_request_note, duration_type, payment_confirmed_at, tracking_number')
      .eq('id', newId)
      .single();
    const row = n as Record<string, unknown>;
    expect(row.pickup_time).toBe('13:30');
    expect(row.return_time).toBe('22:30');
    expect(row.pickup_point_id).toBe(pickupPointId);
    expect(row.return_point_id).toBe(pickupPointId);
    expect(row.pickup_request_note).toBe('수령 요청사항');
    expect(row.return_request_note).toBe('반납 요청사항');
    expect(row.duration_type).toBe('12h');
    // 예약 고유값은 복사하지 않는다
    expect(row.payment_confirmed_at).toBeNull();
    expect(row.tracking_number).toBeNull();

    const { data: items } = await admin.from('order_items').select('reservation_id, line_total').eq('order_id', orderId);
    const lines = (items as Array<{ reservation_id: number; line_total: string }>);
    expect(lines).toHaveLength(2);
    const added = lines.find(l => l.reservation_id === newId);
    expect(Number(added?.line_total)).toBeGreaterThan(0);

    const { data: o } = await admin.from('orders').select('total_amount, final_amount').eq('id', orderId).single();
    const order = o as { total_amount: string; final_amount: string };
    const sum = lines.reduce((s, l) => s + Number(l.line_total), 0);
    expect(Number(order.total_amount)).toBe(sum);
    expect(Number(order.final_amount)).toBeGreaterThan(0);
  });

  it('원본의 휴무일 연장일(pickup/return_holiday_extra_days)도 복사한다', async () => {
    const { resId } = await setupOrderWithOneReservation();
    await admin.from('rental_reservations').update({ pickup_holiday_extra_days: 1, return_holiday_extra_days: 2 }).eq('id', resId);

    const { data } = await admin.rpc('cms_add_reservation_product_unit', { p_reservation_id: resId, p_product_id: addParentId });
    const newId = (data as Array<{ new_reservation_id: number }>)[0].new_reservation_id;
    const { data: n } = await admin.from('rental_reservations').select('pickup_holiday_extra_days, return_holiday_extra_days').eq('id', newId).single();
    expect((n as { pickup_holiday_extra_days: number }).pickup_holiday_extra_days).toBe(1);
    expect((n as { return_holiday_extra_days: number }).return_holiday_extra_days).toBe(2);
  });
});
