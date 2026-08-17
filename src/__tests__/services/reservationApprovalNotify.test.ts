import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { resolveApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify';

/**
 * CMS 예약 승인(/cms/reservation ?/approveReservation) — 다중상품 주문 배치알림 연동
 * (service-operations.md §4): 같은 주문(order_items)으로 묶인 예약을 관리자가 상품별로
 * 한 건씩 승인할 때, 상품마다 개별 "승인되었습니다" 카드를 쌓지 않고 주문 전체가 승인
 * 완료된 시점(마지막 승인)에만 통합 카드 1건을 보내야 한다. resolveApprovalNotifyPlan이
 * 이 판단 로직을 담당 — 실제 stage DB의 order_items/rental_reservations 스키마·
 * create_reservation_order RPC(Migration 280)를 그대로 사용해 검증한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let testProductId: string;
type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = (data as { id: string }).id;
});

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-approvenotify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  return data.user.id;
}

async function deleteEphemeralUser(userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

// 같은 product_id로 여러 예약을 만들 때 겹치는 날짜는 이중예약 방지 제약(exclusion
// constraint rental_reservations_product_dates_excl)에 걸리므로, 다건 픽스처는 서로 겹치지
// 않는 날짜 범위를 지정해야 한다(dayOffset으로 월 단위 이동).
async function createHoldReservation(userId: string, dayOffset = 0): Promise<number> {
  const start = new Date(Date.UTC(2099, dayOffset, 1));
  const end   = new Date(Date.UTC(2099, dayOffset, 3));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    testProductId,
      start_date:    fmt(start),
      end_date:      fmt(end),
      status:        'hold',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`hold reservation 생성 실패: ${error?.message}`);
  return (data as { id: number }).id;
}

type CreateOrderRpc = (
  fn: 'create_reservation_order',
  args: { p_user_id: string; p_reservation_ids: number[] }
) => Promise<{ data: { order_id: number; order_key: string; final_amount: number }[] | null; error: { message: string } | null }>;

async function linkToOrder(userId: string, reservationIds: number[]): Promise<number> {
  const { data, error } = await (admin.rpc as unknown as CreateOrderRpc)('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  });
  if (error || !data?.[0]) throw new Error(`create_reservation_order 실패: ${error?.message}`);
  return data[0].order_id;
}

async function setStatus(reservationId: number, status: string): Promise<void> {
  const { error } = await admin.from('rental_reservations').update({ status }).eq('id', reservationId);
  if (error) throw new Error(`상태 갱신 실패: ${error.message}`);
}

describe('resolveApprovalNotifyPlan', () => {
  it('order_items에 연결되지 않은 단일 예약이면 single을 반환한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const reservationId = await createHoldReservation(userId);
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId); });

    const plan = await resolveApprovalNotifyPlan(admin, reservationId);
    expect(plan.mode).toBe('single');
  });

  it('주문에 이 예약 1건만 연결돼있으면(단일 상품 주문) single을 반환한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const reservationId = await createHoldReservation(userId);
    const orderId = await linkToOrder(userId, [reservationId]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const plan = await resolveApprovalNotifyPlan(admin, reservationId);
    expect(plan.mode).toBe('single');
  });

  it('다중상품 주문인데 다른 상품이 아직 confirmed 전이면 hold를 반환한다(알림 보류)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const idA = await createHoldReservation(userId, 1);
    const idB = await createHoldReservation(userId, 2);
    const orderId = await linkToOrder(userId, [idA, idB]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().in('id', [idA, idB]);
    });

    // idA만 confirmed로 전환(방금 승인한 것으로 가정), idB는 여전히 hold
    await setStatus(idA, 'confirmed');

    const plan = await resolveApprovalNotifyPlan(admin, idA);
    expect(plan.mode).toBe('hold');
  });

  it('다중상품 주문의 마지막 상품까지 confirmed되면 batch를 반환하고 전체 id를 포함한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const idA = await createHoldReservation(userId, 3);
    const idB = await createHoldReservation(userId, 4);
    const orderId = await linkToOrder(userId, [idA, idB]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().in('id', [idA, idB]);
    });

    await setStatus(idA, 'confirmed');
    await setStatus(idB, 'confirmed');

    const plan = await resolveApprovalNotifyPlan(admin, idB);
    expect(plan.mode).toBe('batch');
    if (plan.mode === 'batch') {
      expect(plan.reservationIds.slice().sort((a, b) => a - b)).toEqual([idA, idB].sort((a, b) => a - b));
    }
  });

  it('취소된 형제 상품은 제외하고, 나머지가 모두 confirmed면 batch를 반환한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const idA = await createHoldReservation(userId, 5);
    const idB = await createHoldReservation(userId, 6);
    const idC = await createHoldReservation(userId, 7);
    const orderId = await linkToOrder(userId, [idA, idB, idC]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().in('id', [idA, idB, idC]);
    });

    await setStatus(idA, 'cancelled');
    await setStatus(idB, 'confirmed');
    await setStatus(idC, 'confirmed');

    const plan = await resolveApprovalNotifyPlan(admin, idC);
    expect(plan.mode).toBe('batch');
    if (plan.mode === 'batch') {
      expect(plan.reservationIds.slice().sort((a, b) => a - b)).toEqual([idB, idC].sort((a, b) => a - b));
      expect(plan.reservationIds).not.toContain(idA);
    }
  });

  it('만료(expired)된 형제 상품도 취소와 동일하게 제외하고, 나머지가 모두 confirmed면 batch를 반환한다 (HOLD 30분 자동만료 상호작용 회귀 방지, QA 발견)', async () => {
    // 배경: reservation-rental-execution.md QA 발견 — HOLD 30분 자동만료(Migration 285)
    // 도입 후, 묶음주문 중 한 상품이 만료되면 relevant 필터가 expired를 걸러내지 못해
    // allConfirmed가 영원히 false가 되고, 이미 confirmed된 다른 상품의 승인알림이 영구히
    // hold(보류) 상태로 묶여버리는 실제 사고였다.
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const idA = await createHoldReservation(userId, 8);
    const idB = await createHoldReservation(userId, 9);
    const orderId = await linkToOrder(userId, [idA, idB]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().in('id', [idA, idB]);
    });

    await setStatus(idA, 'expired');
    await setStatus(idB, 'confirmed');

    const plan = await resolveApprovalNotifyPlan(admin, idB);
    expect(plan.mode).toBe('batch');
    if (plan.mode === 'batch') {
      expect(plan.reservationIds).toEqual([idB]);
      expect(plan.reservationIds).not.toContain(idA);
    }
  });

  it('만료(expired)된 형제만 있고 confirmed가 없으면 hold를 반환한다(잘못된 배치알림 방지)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));
    const idA = await createHoldReservation(userId, 10);
    const idB = await createHoldReservation(userId, 11);
    const orderId = await linkToOrder(userId, [idA, idB]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
      await admin.from('rental_reservations').delete().in('id', [idA, idB]);
    });

    await setStatus(idA, 'expired');
    // idB는 여전히 hold(만료도 확정도 아님)

    const plan = await resolveApprovalNotifyPlan(admin, idA);
    expect(plan.mode).toBe('hold');
  });
});
