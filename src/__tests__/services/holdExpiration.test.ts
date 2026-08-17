import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * reservation-rental-execution.md §0-5 — HOLD 자동만료(pg_cron) 메커니즘 복구 (TDD)
 * Harness Flow v3.2 — RED → GREEN
 *
 * 배경: release_reservation_hold() 함수 + hold_expiration_cleanup pg_cron 잡이 Stage·
 * Production 둘 다에 실존하지 않아 "HOLD 30분(구 10분) 자동만료" 정책이 전혀 동작하지
 * 않고 있었다(Production 실측 hold 29건 전부 30분 초과). Migration 285로 복구.
 *
 * 완료기준: status='hold'이고 created_at이 30분보다 오래된 예약만 'expired'로 전환한다.
 * 30분 이내의 최근 hold, 그리고 hold가 아닌 다른 상태(confirmed 등)는 절대 건드리지 않는다.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다(contractSigningGate.test.ts와 동일 패턴).
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

function randomFutureDateRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 1;
  const start = new Date(Date.UTC(2027, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function ensureTestProductId(): Promise<string> {
  if (testProductId) return testProductId;
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = data.id as string;
  return testProductId;
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-holdexpire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createReservationWithCreatedAt(status: string, createdAt: Date, userId: string): Promise<number> {
  const productId = await ensureTestProductId();
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    productId,
      start_date:    start,
      end_date:      end,
      status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  const id = data.id as number;

  // created_at은 insert 시 DEFAULT now()로 고정되므로, 과거 시점 시뮬레이션을 위해
  // service_role 권한으로 직접 UPDATE(테스트 전용 — 앱 코드에서는 절대 하지 않는 패턴)
  const { error: updErr } = await admin
    .from('rental_reservations')
    .update({ created_at: createdAt.toISOString() })
    .eq('id', id);
  if (updErr) throw new Error(`created_at 조작 실패: ${updErr.message}`);

  return id;
}

async function getStatus(reservationId: number): Promise<string | null> {
  const { data } = await admin
    .from('rental_reservations')
    .select('status')
    .eq('id', reservationId)
    .single();
  return (data?.status as string | undefined) ?? null;
}

describe('release_reservation_hold — HOLD 30분 자동만료', () => {
  it('GREEN: 생성된 지 30분 초과한 hold 예약은 expired로 전환된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    const reservationId = await createReservationWithCreatedAt('hold', thirtyOneMinutesAgo, userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { data, error } = await admin.rpc('release_reservation_hold', {});
    expect(error).toBeNull();
    expect((data as { ok?: boolean } | null)?.ok).toBe(true);

    expect(await getStatus(reservationId)).toBe('expired');
  });

  it('GREEN: 생성된 지 30분 이내인 hold 예약은 건드리지 않는다(경계 회귀 방지)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const reservationId = await createReservationWithCreatedAt('hold', tenMinutesAgo, userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('release_reservation_hold', {});

    expect(await getStatus(reservationId)).toBe('hold');
  });

  it('GREEN: hold가 아닌 상태(confirmed)는 30분이 지나도 건드리지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const reservationId = await createReservationWithCreatedAt('confirmed', oneHourAgo, userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('release_reservation_hold', {});

    expect(await getStatus(reservationId)).toBe('confirmed');
  });

  it('GREEN: expired_count가 이번 호출에서 실제로 만료시킨 행 수를 정확히 반영한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const old1 = await createReservationWithCreatedAt('hold', new Date(Date.now() - 40 * 60 * 1000), userId);
    const old2 = await createReservationWithCreatedAt('hold', new Date(Date.now() - 35 * 60 * 1000), userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [old1, old2]);
    });

    const { data } = await admin.rpc('release_reservation_hold', {});
    const result = data as { ok: boolean; expired_count: number } | null;

    expect(result?.expired_count).toBeGreaterThanOrEqual(2);
    expect(await getStatus(old1)).toBe('expired');
    expect(await getStatus(old2)).toBe('expired');
  });

  it('멱등: 이미 expired인 예약을 다시 호출해도 에러 없이 안전하다(재실행 안전성)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservationWithCreatedAt('hold', new Date(Date.now() - 60 * 60 * 1000), userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('release_reservation_hold', {});
    expect(await getStatus(reservationId)).toBe('expired');

    const { error } = await admin.rpc('release_reservation_hold', {});
    expect(error).toBeNull();
    expect(await getStatus(reservationId)).toBe('expired');
  });
});
