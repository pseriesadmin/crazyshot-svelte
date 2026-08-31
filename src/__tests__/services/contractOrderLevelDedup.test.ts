import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { POST as initContract } from '../../routes/api/cms/reservations/[id]/init-contract/+server';

/**
 * 계약서 생성 — '예약' 단위(= '주문' 단위) 정합 (2026-08-31, Stephen 지적)
 *
 * 배경: '예약' 단위는 장바구니에 상품이 몇 개 담기든 하나의 '예약신청' 실행으로 예약코드가
 * 발행된 상태를 가리키는 것이지, 개별 상품(rental_reservations 행) 단위가 아니다. '예약'과
 * '주문'은 동일어이며, 형제 예약 단위(주문 하나에 계약서 여러 장)는 존재해서는 안 된다.
 *
 * init-contract API가 예약 ID 하나만 보고 계약을 생성하던 기존 로직은, 같은 주문에 묶인
 * 다른 상품(형제 예약 행)에 대해 관리자가 각각 "계약서 발송"을 누르면 계약서·서명링크·
 * 결제 트리거가 여러 개로 쪼개지는 결함이 있었다(toss_payments_pg_integration_2026-08-30.md
 * 후속 지적) — 이 스위트는 그 수정(같은 주문이면 기존 계약을 재사용)을 검증한다.
 *
 * 실제 라이브 통합 테스트(Stage DB) — paymentContractOrderRedesign.test.ts와 동일 패턴.
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

function randomFutureDateRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 1;
  const start = new Date(Date.UTC(2035, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-contractdedup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
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
  return data.id as number;
}

function callInitContract(reservationId: number) {
  return initContract({
    params: { id: String(reservationId) },
    locals: { cmsRole: 'manager' },
  } as unknown as Parameters<typeof initContract>[0]);
}

async function getContractIds(reservationIds: number[]): Promise<string[]> {
  const { data } = await admin
    .from('contracts')
    .select('id')
    .in('reservation_id', reservationIds)
    .is('deleted_at', null);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

describe('init-contract — 같은 주문(형제 예약) 계약 재사용', () => {
  it('Happy: 같은 주문에 묶인 두 예약 각각 계약서 발송을 눌러도 계약서는 정확히 1건만 생성된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const rid1 = await createHoldReservation(userId);
    const rid2 = await createHoldReservation(userId);
    cleanups.push(async () => {
      await admin.from('contracts').delete().in('reservation_id', [rid1, rid2]);
      await admin.from('order_items').delete().in('reservation_id', [rid1, rid2]);
      await admin.from('rental_reservations').delete().in('id', [rid1, rid2]);
    });

    await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [rid1, rid2],
    });

    const res1 = await callInitContract(rid1);
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { contractId: string };
    expect(body1.contractId).toBeTruthy();

    // 형제 예약(rid2)에 대해 별도로 "계약서 발송"을 눌러도 새 계약이 생기지 않고
    // rid1의 계약을 그대로 재사용해야 한다.
    const res2 = await callInitContract(rid2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as { contractId: string };
    expect(body2.contractId).toBe(body1.contractId);

    // DB 직접 확인 — 두 예약 전체를 통틀어 계약서는 정확히 1건.
    const contractIds = await getContractIds([rid1, rid2]);
    expect(contractIds).toHaveLength(1);
    expect(contractIds[0]).toBe(body1.contractId);
  });

  it('Edge(무회귀): 동일 예약에 재호출해도 기존처럼 같은 계약을 재사용한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const rid = await createHoldReservation(userId);
    cleanups.push(async () => {
      await admin.from('contracts').delete().eq('reservation_id', rid);
      await admin.from('rental_reservations').delete().eq('id', rid);
    });

    const first = await callInitContract(rid);
    const firstBody = await first.json() as { contractId: string };

    const second = await callInitContract(rid);
    const secondBody = await second.json() as { contractId: string };

    expect(secondBody.contractId).toBe(firstBody.contractId);
  });

  it('Edge(과잉병합 방지): 서로 다른 주문의 예약은 각자 독립적인 계약을 갖는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const ridA = await createHoldReservation(userId); // 주문 묶음 없음(독립)
    const ridB = await createHoldReservation(userId); // 주문 묶음 없음(독립, ridA와 다른 주문)
    cleanups.push(async () => {
      await admin.from('contracts').delete().in('reservation_id', [ridA, ridB]);
      await admin.from('rental_reservations').delete().in('id', [ridA, ridB]);
    });

    const resA = await callInitContract(ridA);
    const bodyA = await resA.json() as { contractId: string };
    const resB = await callInitContract(ridB);
    const bodyB = await resB.json() as { contractId: string };

    expect(bodyA.contractId).not.toBe(bodyB.contractId);
  });
});
