import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * TossPayments v2 주문 그룹 결제 RPC — TDD (2026-08-29)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * plan_source: /Users/stevenmac/.claude/plans/cart-cms-reservation-status-selected-30-merry-fiddle.md
 *
 * 완료기준(B-START):
 *   정상 동작   : confirm_order_payment_and_update_reservations 호출 시 p_reservation_ids
 *                전원의 payment_confirmed_at이 기록되고 payment_transactions 1행이 생성된다.
 *   막아야 할 것 : 동일 idempotency_key/toss_order_id로 중복 호출 시 기존 행을 재사용하고
 *                새 INSERT가 발생하지 않는다(멱등성).
 *                cancel_reservation_payment 호출 시 미결제 예약은 PAYMENT_NOT_FOUND 에러.
 *   실패했을 때  : 멱등 가드가 없으면 uq_payment_order_id UNIQUE 제약 위반으로 INSERT 실패,
 *                결제 상태가 불일치해 예약 상태 전이가 막힌다.
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트.
 * Migration 378~380이 Stage DB에 적용되기 전까지는 RPC not found로 전부 실패하는 것이 정상이다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let testProductId: string;
const createdUserIds: string[] = [];
const createdReservationIds: number[] = [];

// 날짜 충돌 방지: 테스트 실행마다 고유 베이스 + 호출마다 5일씩 전진
// - _slotBase(0~999) * 50 >= max_counter(50) 보장 → 연속 실행 간 슬롯 범위 비겹침
// - 최대 날짜: 2040 + 50000*5일/365 ≈ year 2724 → toISOString()이 표준 YYYY-MM-DD 반환
// - rental_reservations_product_dates_excl 제약 위반 구조적 예방
const _slotBase = Date.now() % 1000; // 0~999: ms 단위로 달라짐
let _slotCounter = 0;

function randomFutureDateRange(): { start: string; end: string } {
  _slotCounter += 1;
  const slot = _slotBase * 50 + _slotCounter; // max ≈ 50,050
  const start = new Date(Date.UTC(2040, 0, 1) + slot * 5 * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-toss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  });
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function createHoldReservation(userId: string): Promise<number> {
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: testProductId,
      start_date: start,
      end_date: end,
      status: 'hold',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  createdReservationIds.push(data.id as number);
  return data.id as number;
}

beforeAll(async () => {
  // 테스트용 부모 상품 1개 확보 (is_active=true인 아무 상품)
  const { data: prod } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (!prod) throw new Error('테스트용 상품이 없습니다. Stage DB에 부모 상품을 등록해주세요.');
  testProductId = prod.id;
});

afterAll(async () => {
  // 생성된 payment_transactions 정리 (reservation_id 기반)
  if (createdReservationIds.length > 0) {
    await admin
      .from('payment_transactions')
      .delete()
      .in('reservation_id', createdReservationIds);
  }
  // 생성된 예약 정리
  if (createdReservationIds.length > 0) {
    await admin
      .from('rental_reservations')
      .delete()
      .in('id', createdReservationIds);
  }
  // 생성된 유저 정리
  for (const uid of createdUserIds) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
});

describe('confirm_order_payment_and_update_reservations', () => {
  it('Happy: 그룹 결제 확정 시 대표 예약 payment_transactions 생성 + 전원 payment_confirmed_at 기록', async () => {
    const userId = await createEphemeralUser();
    const rid1 = await createHoldReservation(userId);
    const rid2 = await createHoldReservation(userId);

    const idempotencyKey = `idem-test-${Date.now()}`;
    const tossOrderId = `CZ-test-${Date.now()}`;

    const { data, error } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999999,
      p_reservation_ids: [rid1, rid2],
      p_payment_key: 'test_payment_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 100000,
      p_paid_amount: 100000,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.success).toBe(true);
    expect(data.idempotent).toBe(false);
    expect(data.payment_id).toBeTruthy();

    // payment_transactions 1행 확인
    const { data: pt } = await admin
      .from('payment_transactions')
      .select('id, reservation_id, order_id, status')
      .eq('idempotency_key', idempotencyKey)
      .single();
    expect(pt).toBeTruthy();
    expect(pt?.reservation_id).toBe(rid1); // 대표 예약 = 첫 번째
    expect(pt?.order_id).toBe(tossOrderId);
    expect(pt?.status).toBe('done');

    // 양쪽 예약 모두 payment_confirmed_at 기록 확인
    const { data: res1 } = await admin
      .from('rental_reservations')
      .select('payment_confirmed_at')
      .eq('id', rid1)
      .single();
    expect(res1?.payment_confirmed_at).toBeTruthy();

    const { data: res2 } = await admin
      .from('rental_reservations')
      .select('payment_confirmed_at')
      .eq('id', rid2)
      .single();
    expect(res2?.payment_confirmed_at).toBeTruthy();
  });

  it('Edge: 동일 idempotency_key 재호출 시 기존 payment_id 반환(idempotent=true), 새 INSERT 없음', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const idempotencyKey = `idem-dedup-${Date.now()}`;
    const tossOrderId = `CZ-dedup-${Date.now()}`;

    // 1차 호출
    const { data: first } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999998,
      p_reservation_ids: [rid],
      p_payment_key: 'test_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 50000,
      p_paid_amount: 50000,
    });
    expect(first?.success).toBe(true);
    expect(first?.idempotent).toBe(false);

    // payment_transactions COUNT 확인
    const { count: countBefore } = await admin
      .from('payment_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', idempotencyKey);

    // 2차 호출 (동일 idempotency_key)
    const { data: second } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999998,
      p_reservation_ids: [rid],
      p_payment_key: 'test_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 50000,
      p_paid_amount: 50000,
    });
    expect(second?.success).toBe(true);
    expect(second?.idempotent).toBe(true);
    expect(second?.payment_id).toBe(first?.payment_id);

    // INSERT 없이 COUNT 동일
    const { count: countAfter } = await admin
      .from('payment_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', idempotencyKey);
    expect(countAfter).toBe(countBefore);
  });

  it('Edge: toss_order_id 중복으로도 멱등 처리', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const tossOrderId = `CZ-toss-dedup-${Date.now()}`;

    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999997,
      p_reservation_ids: [rid],
      p_payment_key: 'test_key_a',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-a-${Date.now()}`,
      p_total_amount: 30000,
      p_paid_amount: 30000,
    });

    // 다른 idempotency_key지만 동일 toss_order_id로 재시도
    const { data: second } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999997,
      p_reservation_ids: [rid],
      p_payment_key: 'test_key_a',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-b-${Date.now()}`,
      p_total_amount: 30000,
      p_paid_amount: 30000,
    });
    expect(second?.success).toBe(true);
    expect(second?.idempotent).toBe(true);
  });
});

describe('cancel_reservation_payment', () => {
  it('Error: 결제 없는 예약(hold 상태)에 cancel 호출 시 PAYMENT_NOT_FOUND 반환', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const { data, error } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid,
      p_admin_id: userId, // admin_id로 user_id 재사용 (테스트 목적)
      p_cancel_reason: '테스트 환불',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toBe('PAYMENT_NOT_FOUND');
  });

  it('Happy: 결제된 예약에 cancel 호출 시 payment_transactions.status=cancelled + payment_key 반환', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    // 결제 완료 상태 만들기
    const idempotencyKey = `idem-cancel-${Date.now()}`;
    const tossOrderId = `CZ-cancel-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999996,
      p_reservation_ids: [rid],
      p_payment_key: 'test_cancel_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 80000,
      p_paid_amount: 80000,
    });

    // 이제 환불 RPC 호출
    const { data, error } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid,
      p_admin_id: userId,
      p_cancel_reason: '고객 요청 환불',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.payment_key).toBe('test_cancel_key');
    expect(data?.toss_order_id).toBe(tossOrderId);

    // payment_transactions.status=cancelled 확인
    const { data: pt } = await admin
      .from('payment_transactions')
      .select('status, cancelled_at')
      .eq('idempotency_key', idempotencyKey)
      .single();
    expect(pt?.status).toBe('cancelled');
    expect(pt?.cancelled_at).toBeTruthy();
  });

  it('Edge (주문 전체 환불): 예약 2개가 같은 주문에 묶여있을 때 1개 reservation_id로 cancel 호출 시 payment_transactions 1행만 cancelled + 두 예약 모두 status=cancelled', async () => {
    const userId = await createEphemeralUser();
    const rid1 = await createHoldReservation(userId);
    const rid2 = await createHoldReservation(userId);

    // 같은 주문으로 묶기 (create_reservation_order RPC — RETURNS TABLE, 배열 반환)
    const { data: orderRows, error: orderErr } = await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid1, rid2],
    });
    expect(orderErr).toBeNull();
    expect(Array.isArray(orderRows) ? orderRows[0]?.order_id : (orderRows as { order_id: number } | null)?.order_id).toBeTruthy();
    const orderId: number = Array.isArray(orderRows)
      ? (orderRows as { order_id: number }[])[0].order_id
      : (orderRows as { order_id: number }).order_id;

    // 결제 완료 상태 만들기 (rid1을 대표 예약으로)
    const idempotencyKey = `idem-group-cancel-${Date.now()}`;
    const tossOrderId = `CZ-group-cancel-${Date.now()}`;
    const { data: confirmData } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: orderId,
      p_reservation_ids: [rid1, rid2],
      p_payment_key: 'test_group_cancel_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 160000,
      p_paid_amount: 160000,
    });
    expect(confirmData?.success).toBe(true);

    // rid1 하나로 cancel 호출 → 주문 전체 환불
    const { data, error } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid1,
      p_admin_id: userId,
      p_cancel_reason: '주문 전체 환불 테스트',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.payment_key).toBe('test_group_cancel_key');

    // cancelled_reservation_ids에 rid1, rid2 모두 포함 확인
    const cancelledIds: number[] = data?.cancelled_reservation_ids ?? [];
    expect(cancelledIds).toContain(rid1);
    expect(cancelledIds).toContain(rid2);

    // payment_transactions 1행만 cancelled (새 행 생성 없음)
    const { data: pts } = await admin
      .from('payment_transactions')
      .select('id, status, cancelled_at')
      .eq('idempotency_key', idempotencyKey);
    expect(pts?.length).toBe(1);
    expect(pts?.[0].status).toBe('cancelled');
    expect(pts?.[0].cancelled_at).toBeTruthy();

    // 두 예약 모두 status=cancelled
    const { data: res1 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid1)
      .single();
    expect(res1?.status).toBe('cancelled');

    const { data: res2 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid2)
      .single();
    expect(res2?.status).toBe('cancelled');

    // 정리: order_items
    await admin.from('order_items').delete().eq('order_id', orderId);
    await admin.from('orders').delete().eq('id', orderId);
  });

  it('Edge (멱등 — 이미 cancelled인 예약 스킵): cancel 두 번 호출해도 두 번째는 cancelled_reservation_ids가 빈 배열', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const idempotencyKey = `idem-cancel-idempotent-${Date.now()}`;
    const tossOrderId = `CZ-cancel-idempotent-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999995,
      p_reservation_ids: [rid],
      p_payment_key: 'test_cancel_idem_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: idempotencyKey,
      p_total_amount: 40000,
      p_paid_amount: 40000,
    });

    // 1차 cancel
    const { data: first } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid,
      p_admin_id: userId,
      p_cancel_reason: '1차 환불',
    });
    expect(first?.success).toBe(true);
    expect((first?.cancelled_reservation_ids as number[]).length).toBe(1);

    // 2차 cancel — payment_transactions가 이미 cancelled라 PAYMENT_NOT_FOUND
    const { data: second } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid,
      p_admin_id: userId,
      p_cancel_reason: '2차 중복 환불',
    });
    expect(second?.success).toBe(false);
    expect(second?.error).toBe('PAYMENT_NOT_FOUND');
  });
});  // end describe('cancel_reservation_payment')

describe('process_pending_toss_webhooks', () => {
  // 실제 Toss 웹훅 구조: { eventType, data: { orderId, status, paymentKey, ... } }
  // Migration 383으로 수정: payload -> 'data' ->> 'orderId' / ->> 'status' 경로로 파싱
  it('Happy: processed=false 웹훅 처리 후 processed=true로 마킹 (nested 페이로드 구조)', async () => {
    // raw_webhook_logs에 테스트 행 INSERT — 실제 Toss 웹훅과 동일한 nested 구조
    const { data: log, error: insertErr } = await admin
      .from('raw_webhook_logs')
      .insert({
        source: 'toss',
        event_type: 'PAYMENT_STATUS_CHANGED',
        payload: {
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            orderId: `test-wh-${Date.now()}`,
            status:  'DONE',
          },
        },
        processed: false,
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();
    expect(log?.id).toBeTruthy();

    // process_pending_toss_webhooks 호출
    const { error } = await admin.rpc('process_pending_toss_webhooks');
    expect(error).toBeNull();

    // 해당 행이 processed=true로 변경됐는지 확인
    // 주의: FOR UPDATE SKIP LOCKED로 인해 pg_cron(*/2분)이 동시에 처리 중이면 이 RPC는 skip.
    // 어느 쪽이 처리하든 processed=true가 되므로 최대 5초 대기하는 재시도 루프로 검증.
    type WebhookLogRow = { processed: boolean; processed_at: string | null; process_result: unknown };
    let updated: WebhookLogRow | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data } = await admin
        .from('raw_webhook_logs')
        .select('processed, processed_at, process_result')
        .eq('id', log!.id)
        .single()
        .returns<WebhookLogRow>();
      if (data?.processed) {
        updated = data;
        break;
      }
      await new Promise<void>(r => setTimeout(r, 500));
    }
    expect(updated?.processed).toBe(true);
    expect(updated?.processed_at).toBeTruthy();

    // 정리
    await admin.from('raw_webhook_logs').delete().eq('id', log!.id);
  });

  it('Edge: 멱등성 — 이미 processed=true인 행은 다시 처리되지 않음', async () => {
    const { data: log } = await admin
      .from('raw_webhook_logs')
      .insert({
        source: 'toss',
        event_type: 'PAYMENT_STATUS_CHANGED',
        payload: {
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: {
            orderId: `test-wh-done-${Date.now()}`,
            status:  'DONE',
          },
        },
        processed: true,
        processed_at: new Date().toISOString(),
        process_result: { note: '이미 처리됨' },
      })
      .select('id, processed_at')
      .single();

    const prevProcessedAt = log?.processed_at;

    await admin.rpc('process_pending_toss_webhooks');

    const { data: after } = await admin
      .from('raw_webhook_logs')
      .select('processed_at')
      .eq('id', log!.id)
      .single();
    // processed_at이 변경되지 않아야 함
    expect(after?.processed_at).toBe(prevProcessedAt);

    await admin.from('raw_webhook_logs').delete().eq('id', log!.id);
  });

  // 2026-08-31(Migration 388, F3): 편도 판정 보완 — pt_status='done'인데 웹훅이 취소류
  // 상태를 보내는 반대 방향 불일치도 STATUS_MISMATCH_WARN으로 잡아야 한다.
  it('Edge(F3): pt_status=done인데 웹훅 status=CANCELED → STATUS_MISMATCH_WARN', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const tossOrderId = `CZ-reverse-mismatch-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999990,
      p_reservation_ids: [rid],
      p_payment_key: 'test_reverse_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-reverse-${Date.now()}`,
      p_total_amount: 40000,
      p_paid_amount: 40000,
    });

    const { data: log } = await admin
      .from('raw_webhook_logs')
      .insert({
        source: 'toss',
        event_type: 'PAYMENT_STATUS_CHANGED',
        payload: {
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: { orderId: tossOrderId, status: 'CANCELED' },
        },
        processed: false,
      })
      .select('id')
      .single();

    await admin.rpc('process_pending_toss_webhooks');

    type WebhookLogRow = { processed: boolean; process_result: { note?: string } | null };
    let updated: WebhookLogRow | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data } = await admin
        .from('raw_webhook_logs')
        .select('processed, process_result')
        .eq('id', log!.id)
        .single()
        .returns<WebhookLogRow>();
      if (data?.processed) { updated = data; break; }
      await new Promise<void>(r => setTimeout(r, 500));
    }
    expect(updated?.process_result?.note).toBe('STATUS_MISMATCH_WARN');

    await admin.from('raw_webhook_logs').delete().eq('id', log!.id);
  });

  it('Happy(F3 무회귀): pt_status=done + 웹훅 status=DONE → 여전히 reconciled(정상)', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const tossOrderId = `CZ-still-reconciled-${Date.now()}`;
    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999989,
      p_reservation_ids: [rid],
      p_payment_key: 'test_reconciled_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: `idem-reconciled-${Date.now()}`,
      p_total_amount: 40000,
      p_paid_amount: 40000,
    });

    const { data: log } = await admin
      .from('raw_webhook_logs')
      .insert({
        source: 'toss',
        event_type: 'PAYMENT_STATUS_CHANGED',
        payload: {
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: { orderId: tossOrderId, status: 'DONE' },
        },
        processed: false,
      })
      .select('id')
      .single();

    await admin.rpc('process_pending_toss_webhooks');

    type WebhookLogRow = { processed: boolean; process_result: { note?: string } | null };
    let updated: WebhookLogRow | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data } = await admin
        .from('raw_webhook_logs')
        .select('processed, process_result')
        .eq('id', log!.id)
        .single()
        .returns<WebhookLogRow>();
      if (data?.processed) { updated = data; break; }
      await new Promise<void>(r => setTimeout(r, 500));
    }
    expect(updated?.process_result?.note).toBe('reconciled');

    await admin.from('raw_webhook_logs').delete().eq('id', log!.id);
  });
});

// ── get_rental_list payment_status — Migration 387 (F1) ─────────────────────
// toss_payments_pg_integration_2026-08-30.md F1: orders.status(영구 pending) 대신
// payment_transactions.status를 반영해야 한다. 대표 예약뿐 아니라 형제 예약(order_items
// 경유)도 같은 결제 기록을 봐야 한다.
describe('get_rental_list — payment_status(Migration 387)', () => {
  it('Happy: 결제 완료된 대표 예약 조회 시 payment_status가 orders.status(pending)가 아니라 payment_transactions.status(done)를 반영', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999980,
      p_reservation_ids: [rid],
      p_payment_key: 'test_pstatus_key',
      p_toss_order_id: `CZ-pstatus-${Date.now()}`,
      p_idempotency_key: `idem-pstatus-${Date.now()}`,
      p_total_amount: 60000,
      p_paid_amount: 60000,
    });

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: rid,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { payment_status?: string | null } | undefined;
    expect(row?.payment_status).toBe('done');
  });

  it('Happy(형제 예약): 같은 주문에 묶인 형제 예약도 대표 예약의 payment_transactions.status를 그대로 반영', async () => {
    const userId = await createEphemeralUser();
    const rid1 = await createHoldReservation(userId); // 대표 예약
    const rid2 = await createHoldReservation(userId); // 형제 예약(payment_transactions 직접 매칭 없음)

    // 실제 프로덕션 순서 재현 — cart 체크아웃 시점에 create_reservation_order로 먼저
    // order_items/orders를 묶어야 get_rental_list의 형제 예약 조회(order_items 경유)가
    // 대상을 찾을 수 있다(confirm_order_payment_and_update_reservations 자체는 order_items를
    // 만들지 않음 — service-operations.md §4).
    await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid1, rid2],
    });

    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999981,
      p_reservation_ids: [rid1, rid2],
      p_payment_key: 'test_sibling_key',
      p_toss_order_id: `CZ-sibling-${Date.now()}`,
      p_idempotency_key: `idem-sibling-${Date.now()}`,
      p_total_amount: 90000,
      p_paid_amount: 90000,
    });

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: rid2,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { payment_status?: string | null } | undefined;
    expect(row?.payment_status).toBe('done');
  });

  it('Happy(환불): cancel_reservation_payment 이후 payment_status가 cancelled로 반영', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: 999999982,
      p_reservation_ids: [rid],
      p_payment_key: 'test_cancel_pstatus_key',
      p_toss_order_id: `CZ-cancel-pstatus-${Date.now()}`,
      p_idempotency_key: `idem-cancel-pstatus-${Date.now()}`,
      p_total_amount: 70000,
      p_paid_amount: 70000,
    });
    await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid,
      p_admin_id: userId,
      p_cancel_reason: '테스트 환불',
    });

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: rid,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { payment_status?: string | null } | undefined;
    expect(row?.payment_status).toBe('cancelled');
  });

  it('Edge(미결제): 결제 시도 자체가 없는 hold 예약은 payment_status가 NULL(orders.status의 stale pending을 노출하지 않음)', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: rid,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { payment_status?: string | null } | undefined;
    expect(row?.payment_status).toBeNull();
  });
});

// ── create_reservation_order — 배송비 합산 (Migration 395) ──────────────────
// Stephen 지적: 장바구니가 보여준 "대여료+배송비" 총액과 실제 Toss 청구액이 달랐음(F1
// 후속 조사) — 배송비를 orders.final_amount(및 실결제 금액)에 포함시키도록 수정.
describe('create_reservation_order — 배송비 합산(Migration 395)', () => {
  it('Happy: p_delivery_fee를 전달하면 final_amount = 대여료합계 - 등급할인 + 배송비', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const { data, error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid],
      p_delivery_fee: 3000,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;

    const { data: orderRow } = await admin
      .from('orders')
      .select('total_amount, discount_amount, final_amount, delivery_fee')
      .eq('id', row.order_id)
      .single();

    expect(orderRow?.delivery_fee).toBe(3000);
    expect(Number(orderRow?.final_amount)).toBe(
      Number(orderRow?.total_amount) - Number(orderRow?.discount_amount) + 3000
    );
    expect(Number(row.final_amount)).toBe(Number(orderRow?.final_amount));
  });

  it('Edge(하위호환): p_delivery_fee 생략 시 기존과 동일하게 0으로 처리(배송비 미반영 호출부 무회귀)', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    const { error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid],
    });
    expect(error).toBeNull();

    const { data: oi } = await admin
      .from('order_items')
      .select('order_id')
      .eq('reservation_id', rid)
      .single();
    const { data: order } = await admin
      .from('orders')
      .select('delivery_fee, final_amount, total_amount, discount_amount')
      .eq('id', oi!.order_id)
      .single();

    expect(order?.delivery_fee).toBe(0);
    expect(Number(order?.final_amount)).toBe(Number(order?.total_amount) - Number(order?.discount_amount));
  });

  it('Edge(재호출 덮어쓰기): 같은 예약으로 다른 p_delivery_fee를 다시 호출하면 최신값으로 갱신', async () => {
    const userId = await createEphemeralUser();
    const rid = await createHoldReservation(userId);

    await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid],
      p_delivery_fee: 3000,
    });
    const { data: second } = await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid],
      p_delivery_fee: 0, // CRAZY 등급 무료배송 등으로 이후 0원 재계산된 케이스 재현
    });
    const row2 = Array.isArray(second) ? second[0] : second;

    const { data: order } = await admin
      .from('orders')
      .select('delivery_fee, final_amount, total_amount, discount_amount')
      .eq('id', row2.order_id)
      .single();

    expect(order?.delivery_fee).toBe(0);
    expect(Number(order?.final_amount)).toBe(Number(order?.total_amount) - Number(order?.discount_amount));
  });
});

// ── get_rental_list 계약(contract) 조회 — 주문 단위 통일 (Migration 399) ────────
// CMS 감사 에이전트 HIGH 발견: init-contract가 "같은 주문에 이미 계약이 있으면 재사용"
// 으로 바뀌어(계약은 주문당 1건, 대표 예약에만 anchor), 형제 예약은 이 RPC에서 여전히
// contract_id=NULL로 나와 CMS "계약서" 탭이 "계약서 미생성"을 잘못 표시했다.
describe('get_rental_list — 계약 조회 주문단위 통일(Migration 399)', () => {
  async function createSignedContract(userId: string, reservationId: number): Promise<{ contractId: string; signingId: string }> {
    const { data: contract, error: cErr } = await admin
      .from('contracts')
      .insert({ reservation_id: reservationId, user_id: userId, contract_type: 'rental', status: 'active' })
      .select('id')
      .single();
    if (cErr || !contract) throw new Error(`contract 생성 실패: ${cErr?.message}`);

    const { data: signing, error: sErr } = await admin
      .from('contract_signings')
      .insert({ contract_id: contract.id, user_id: userId, sent_at: new Date().toISOString(), signed_at: new Date().toISOString() })
      .select('id')
      .single();
    if (sErr || !signing) throw new Error(`contract_signings 생성 실패: ${sErr?.message}`);

    return { contractId: contract.id as string, signingId: signing.id as string };
  }

  it('CRITICAL 회귀 확인: 형제 예약(계약 미소유)도 대표 예약의 계약 정보를 그대로 조회한다', async () => {
    const userId = await createEphemeralUser();
    const anchorId  = await createHoldReservation(userId);
    const siblingId = await createHoldReservation(userId);

    await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [anchorId, siblingId],
    });

    // init-contract 정책과 동일하게 대표 예약(anchor)에만 계약을 만들고 서명 완료 처리.
    const { contractId, signingId } = await createSignedContract(userId, anchorId);

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: siblingId,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { contract_id?: string | null; customer_signed_at?: string | null } | undefined;
    // 수정 전(버그): 형제 예약은 자기 자신 소유 계약이 없어 contract_id=NULL로 잘못 조회됨.
    expect(row?.contract_id).toBe(contractId);
    expect(row?.customer_signed_at).not.toBeNull();

    await admin.from('contract_signings').delete().eq('id', signingId);
    await admin.from('contracts').delete().eq('id', contractId);
  });

  it('무회귀: 형제 예약이 없는 단일 예약은 자기 자신의 계약을 그대로 조회한다', async () => {
    const userId = await createEphemeralUser();
    const reservationId = await createHoldReservation(userId);

    const { contractId, signingId } = await createSignedContract(userId, reservationId);

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: reservationId,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { contract_id?: string | null } | undefined;
    expect(row?.contract_id).toBe(contractId);

    await admin.from('contract_signings').delete().eq('id', signingId);
    await admin.from('contracts').delete().eq('id', contractId);
  });

  it('무회귀: 계약 자체가 없는 예약은 contract_id가 NULL이다', async () => {
    const userId = await createEphemeralUser();
    const reservationId = await createHoldReservation(userId);

    const { data, error } = await admin.rpc('get_rental_list', {
      p_reservation_id: reservationId,
      p_page: 1,
      p_per_page: 1,
    });
    expect(error).toBeNull();
    const row = (data ?? [])[0] as { contract_id?: string | null } | undefined;
    expect(row?.contract_id ?? null).toBeNull();
  });
});

// 예약코드(reservation_code) 주문단위 통일(Migration 400)의 전용 테스트는
// src/__tests__/services/reservationCodeOrderWide.test.ts로 통합됨(2026-08-31,
// 병렬 세션 간 중복 작성 발견 후 정리 — .claude/harness/TASK.md 해당 블록 참고).
