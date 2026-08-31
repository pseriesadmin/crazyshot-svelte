import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { GET as getPayment } from '../../routes/api/cms/reservations/[id]/payment/+server';

/**
 * GET /api/cms/reservations/[id]/payment — 형제 예약 결제정보 조회 CRITICAL 수정
 * (2026-08-31, CMS 감사 에이전트 HIGH 발견)
 *
 * 배경: confirm_order_payment_and_update_reservations(Migration 378)는 주문당
 * payment_transactions 1행만 대표 예약에 연결한다. 이 엔드포인트가 예전처럼
 * `.eq('reservation_id', params.id)`로 직접매칭만 하면, 형제 예약(같은 주문의 다른 상품)의
 * "결제정보" 탭은 항상 "결제 정보가 없습니다"로 뜨고 환불 버튼도 영구히 비활성화된다
 * (paymentDetail?.status==='done' 게이트). cancel_reservation_payment RPC의 1a/1b
 * 조회 패턴과 동일하게 order_items 경유 형제 매칭 폴백을 추가했다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let testProductId: string;
const cleanups: (() => Promise<void>)[] = [];

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

// 날짜 충돌 방지(rental_reservations_product_dates_excl) — tossPaymentGroupRpc.test.ts와
// 동일한 슬롯 기반 유일성 보장 패턴.
const _slotBase = Date.now() % 1000;
let _slotCounter = 0;
function randomFutureDateRange(): { start: string; end: string } {
  _slotCounter += 1;
  const slot = _slotBase * 50 + _slotCounter;
  const start = new Date(Date.UTC(2038, 0, 1) + slot * 5 * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-cmspay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  return data.user.id;
}

async function createReservation(userId: string): Promise<number> {
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId, product_id: testProductId, start_date: start, end_date: end,
      status: 'hold', pickup_method: 'visit', return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return data.id as number;
}

async function linkToOrder(userId: string, reservationIds: number[]): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  });
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`);
}

function callGet(reservationId: number) {
  return getPayment({
    params: { id: String(reservationId) },
    locals: { cmsRole: 'manager' },
  } as unknown as Parameters<typeof getPayment>[0]);
}

describe('GET /api/cms/reservations/[id]/payment — 형제 예약 결제정보 조회(CRITICAL 수정)', () => {
  it('CRITICAL 회귀 확인: 형제 예약(결제행 미소유)도 대표 예약의 결제정보를 그대로 조회한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchorId  = await createReservation(userId);
    const siblingId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [anchorId, siblingId]);
    });
    await linkToOrder(userId, [anchorId, siblingId]);

    const tossOrderId = `CZ-siblingpay-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999970,
      p_reservation_ids: [anchorId, siblingId],
      p_payment_key: 'test_sibling_payment_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-siblingpay-${Date.now()}`,
      p_total_amount: 45000,
      p_paid_amount: 45000,
    });
    cleanups.push(async () => {
      await admin.from('payment_transactions').delete().eq('order_id', tossOrderId);
    });

    const res = await callGet(siblingId);
    expect(res.status).toBe(200);
    const body = await res.json() as { payment: { status?: string; payment_key?: string } | null };
    // 수정 전(버그): payment=null("결제 정보가 없습니다")로 잘못 조회됨.
    expect(body.payment).not.toBeNull();
    expect(body.payment?.status).toBe('done');
    expect(body.payment?.payment_key).toBe('test_sibling_payment_key');
  });

  it('무회귀: 대표 예약 자신은 기존과 동일하게 직접 조회된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchorId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', anchorId);
    });

    const tossOrderId = `CZ-anchorpay-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999969,
      p_reservation_ids: [anchorId],
      p_payment_key: 'test_anchor_payment_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-anchorpay-${Date.now()}`,
      p_total_amount: 30000,
      p_paid_amount: 30000,
    });
    cleanups.push(async () => {
      await admin.from('payment_transactions').delete().eq('order_id', tossOrderId);
    });

    const res = await callGet(anchorId);
    const body = await res.json() as { payment: { payment_key?: string } | null };
    expect(body.payment?.payment_key).toBe('test_anchor_payment_key');
  });

  it('무회귀: 결제 기록 자체가 없는 예약은 payment=null', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const reservationId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const res = await callGet(reservationId);
    const body = await res.json() as { payment: unknown };
    expect(body.payment).toBeNull();
  });
});
