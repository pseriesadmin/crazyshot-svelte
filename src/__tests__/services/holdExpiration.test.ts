import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * release_reservation_hold() — HOLD 만료 정책 전면 개편 (Migration 453, 2026-09-07 Stephen 확정)
 * Harness Flow v3.2 — RED → GREEN
 *
 * 이전 정책(Migration 285~431): "생성 후 30분" 타이머가 계약 미발송 상태에서도 그냥 흘렀다
 * (계약 발송 시 GREATEST(created_at, sent_at)로 리셋될 뿐, 발송 자체가 없으면 created_at
 * 기준으로 만료됨).
 *
 * 신규 정책(Migration 453): "고객 예약신청완료(hold) 건은 타이머 자체가 없다 — 관리자가
 * 전자계약을 발송한 시점부터만 30분이 시작된다. 계약이 한 번도 발송되지 않았으면 생성 후
 * 아무리 오래 지나도 이 함수는 손대지 않는다." 이 파일의 5개 케이스는 전부 "계약 미발송"
 * 시나리오만 다루므로, 이전 정책에서의 "expired 전환"이 신규 정책에서는 "hold 유지"로
 * 정확히 반전된다 — 이것이 이번 정책 반전이 실제로 적용됐음을 보증하는 회귀 테스트다.
 * "계약 발송 후" 시나리오(D-1 타이머 실제 동작)는 holdExpirationContractTimer.test.ts가 담당.
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

describe('release_reservation_hold — HOLD 만료 정책 전면 개편(계약 미발송 시나리오)', () => {
  it('REVERSED: 계약 미발송 + 생성 후 30분 초과해도 hold 그대로 유지된다(구 정책 반전)', async () => {
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

    expect(await getStatus(reservationId)).toBe('hold');
  });

  it('REVERSED: 계약 미발송 + 생성 후 며칠(엿새) 지나도 여전히 hold 유지된다(타이머 자체가 없음을 극단값으로 확인)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const reservationId = await createReservationWithCreatedAt('hold', sixDaysAgo, userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('release_reservation_hold', {});

    expect(await getStatus(reservationId)).toBe('hold');
  });

  it('무회귀: 생성된 지 30분 이내인 hold 예약은 (여전히) 건드리지 않는다', async () => {
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

  it('무회귀: hold가 아닌 상태(confirmed)는 계약 미발송·시간 경과와 무관하게 건드리지 않는다', async () => {
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

  it('무회귀: 계약 미발송 hold 여러 건을 한 번에 호출해도 expired_count에 포함되지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const old1 = await createReservationWithCreatedAt('hold', new Date(Date.now() - 40 * 60 * 1000), userId);
    const old2 = await createReservationWithCreatedAt('hold', new Date(Date.now() - 35 * 60 * 1000), userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [old1, old2]);
    });

    const { data } = await admin.rpc('release_reservation_hold', {});
    const result = data as { ok: boolean; expired_count: number } | null;

    expect(result?.ok).toBe(true);
    expect(await getStatus(old1)).toBe('hold');
    expect(await getStatus(old2)).toBe('hold');
  });
});
