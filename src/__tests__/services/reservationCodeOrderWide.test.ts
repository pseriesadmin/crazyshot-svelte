import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { GET as resolveReservation } from '../../routes/api/cms/reservations/resolve/+server';

/**
 * 예약코드(reservation_code) 주문단위 통일 (2026-08-31, Migration 400)
 *
 * 배경: reservation_code는 rental_reservations 행(=개별 상품) 하나당 하나씩
 * BEFORE INSERT 트리거(trg_set_reservation_code, Migration 144)로 발급됐다. 장바구니에
 * 상품을 여러 개 담아 함께 체크아웃해도 각 행이 서로 다른 코드를 받아, "장바구니에 몇 개를
 * 담든 하나의 예약(주문)건으로 예약품번코드가 발행된다"는 Stephen의 확정 정책과 어긋났다.
 *
 * 수정: create_reservation_order RPC(장바구니 체크아웃 제출 시점)가 예약들을 하나의
 * 주문으로 묶을 때, 그 주문에 속한 예약 전체의 reservation_code를 대표값(주문 내 가장
 * 먼저 생성된 예약 = MIN(id)의 코드) 하나로 통일한다. reservation_code UNIQUE 제약도
 * 함께 제거(같은 주문의 여러 행이 의도적으로 같은 값을 가짐).
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

// 날짜 충돌 방지(rental_reservations_product_dates_excl) — 기존 테스트들과 동일한
// 슬롯 기반 유일성 보장 패턴(tossPaymentGroupRpc.test.ts 등).
const _slotBase = Date.now() % 1000;
let _slotCounter = 0;
function randomFutureDateRange(): { start: string; end: string } {
  _slotCounter += 1;
  const slot = _slotBase * 50 + _slotCounter;
  const start = new Date(Date.UTC(2039, 0, 1) + slot * 5 * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-rescode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  return data.user.id;
}

async function createReservation(userId: string): Promise<{ id: number; code: string | null }> {
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId, product_id: testProductId, start_date: start, end_date: end,
      status: 'hold', pickup_method: 'visit', return_method: 'visit',
    })
    .select('id, reservation_code')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return { id: data.id as number, code: data.reservation_code as string | null };
}

async function fetchCode(reservationId: number): Promise<string | null> {
  const { data, error } = await admin
    .from('rental_reservations')
    .select('reservation_code')
    .eq('id', reservationId)
    .single();
  if (error || !data) throw new Error(`reservation 조회 실패: ${error?.message}`);
  return data.reservation_code as string | null;
}

async function linkToOrder(userId: string, reservationIds: number[]): Promise<number> {
  const { data, error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  });
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row.order_id as number;
}

function callResolve(searchParams: Record<string, string>) {
  return resolveReservation({
    locals: { cmsRole: 'manager' },
    url: { searchParams: new URLSearchParams(searchParams) },
  } as unknown as Parameters<typeof resolveReservation>[0]);
}

describe('create_reservation_order — 예약코드 주문단위 통일(Migration 400)', () => {
  it('장바구니 다중 상품 체크아웃 시 형제 예약 전체가 대표(최소 id) 예약의 코드로 통일된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchor = await createReservation(userId);
    const sibling1 = await createReservation(userId);
    const sibling2 = await createReservation(userId);
    const ids = [anchor.id, sibling1.id, sibling2.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    // 트리거 발급 시점엔 서로 다른 코드였어야 정상(수정 전 버그 재현 조건)
    expect(anchor.code).not.toBeNull();
    expect(sibling1.code).not.toBeNull();
    expect(anchor.code).not.toBe(sibling1.code);

    const orderId = await linkToOrder(userId, ids);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const [anchorCode, sibling1Code, sibling2Code] = await Promise.all([
      fetchCode(anchor.id), fetchCode(sibling1.id), fetchCode(sibling2.id),
    ]);

    expect(anchorCode).toBe(anchor.code); // 대표(최소 id)는 자기 자신의 원래 코드 유지
    expect(sibling1Code).toBe(anchor.code);
    expect(sibling2Code).toBe(anchor.code);
  });

  it('멱등성: create_reservation_order를 재호출해도 항상 같은 대표값으로 수렴한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchor = await createReservation(userId);
    const sibling = await createReservation(userId);
    const ids = [anchor.id, sibling.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    const orderId1 = await linkToOrder(userId, ids);
    const orderId2 = await linkToOrder(userId, ids);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId1);
      await admin.from('orders').delete().eq('id', orderId1);
    });

    expect(orderId2).toBe(orderId1); // 같은 예약이면 기존 주문에 계속 연결됨

    const siblingCode = await fetchCode(sibling.id);
    expect(siblingCode).toBe(anchor.code);
  });

  it('무회귀: 단일 예약(형제 없음)만으로 주문 생성 시 자기 자신의 코드가 그대로 유지된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const solo = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', solo.id);
    });

    const orderId = await linkToOrder(userId, [solo.id]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const soloCode = await fetchCode(solo.id);
    expect(soloCode).toBe(solo.code);
  });

  it('Edge: 예약 3개를 id 순서와 무관하게(뒤섞어) 전달해도 항상 최소 id의 코드로 통일된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const r1 = await createReservation(userId);
    const r2 = await createReservation(userId);
    const r3 = await createReservation(userId);
    const ids = [r1.id, r2.id, r3.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    // 배열 순서를 일부러 뒤섞어 "전달 순서"가 아니라 "id 순서"로 대표값이 결정됨을 확인
    const orderId = await linkToOrder(userId, [r3.id, r1.id, r2.id]);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const [c1, c2, c3] = await Promise.all([fetchCode(r1.id), fetchCode(r2.id), fetchCode(r3.id)]);
    expect(c1).toBe(r1.code); // r1이 가장 먼저 생성됨 → 최소 id
    expect(c2).toBe(r1.code);
    expect(c3).toBe(r1.code);
  });

  it('UNIQUE 제약 제거 확인: 같은 reservation_code를 가진 행이 2개 이상이어도 통일 UPDATE가 에러 없이 성공한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchor = await createReservation(userId);
    const sibling = await createReservation(userId);
    const ids = [anchor.id, sibling.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    // Migration 400 이전(UNIQUE 제약 존재)이었다면 두 번째 UPDATE가
    // rental_reservations_reservation_code_key 위반으로 실패했을 것.
    const orderId = await linkToOrder(userId, ids);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const { count } = await admin
      .from('rental_reservations')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_code', anchor.code as string);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/cms/reservations/resolve — 통일된 코드의 결정론적 매칭(Migration 400)', () => {
  it('여러 행이 같은 reservation_code를 공유해도 항상 가장 작은 id(대표 예약)를 반환한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchor = await createReservation(userId);
    const sibling = await createReservation(userId);
    const ids = [anchor.id, sibling.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    const orderId = await linkToOrder(userId, ids);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const code = await fetchCode(anchor.id);
    expect(code).not.toBeNull();

    const res = await callResolve({ code: code as string });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; status: string };
    expect(body.id).toBe(anchor.id); // sibling.id가 아니라 항상 anchor(최소 id)로 수렴
  });

  it('id 파라미터로 직접 조회 시 코드 공유 여부와 무관하게 그 예약 자신이 반환된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchor = await createReservation(userId);
    const sibling = await createReservation(userId);
    const ids = [anchor.id, sibling.id];
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', ids);
    });

    const orderId = await linkToOrder(userId, ids);
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('order_id', orderId);
      await admin.from('orders').delete().eq('id', orderId);
    });

    const res = await callResolve({ id: String(sibling.id) });
    const body = await res.json() as { id: number };
    expect(body.id).toBe(sibling.id);
  });

  it('무회귀: 코드를 공유하는 형제가 없는 단일 예약은 코드 조회로도 자기 자신을 반환한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const solo = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', solo.id);
    });

    const res = await callResolve({ code: solo.code as string });
    const body = await res.json() as { id: number };
    expect(body.id).toBe(solo.id);
  });
});
