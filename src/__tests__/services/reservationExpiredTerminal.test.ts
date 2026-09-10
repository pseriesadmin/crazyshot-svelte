import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * update_reservation_status RPC — 'expired'(HOLD 30분 자동만료) 종료상태 가드 (TDD)
 * Migration #485(20260910070000_485_update_reservation_status_expired_terminal.sql)
 *
 * 결함: v_current_status 종료상태 체크가 completed/cancelled/damage_claimed만 보고
 *   expired를 빠뜨려, 이미 만료된 예약도 update_reservation_status(id,'cancelled')로
 *   그대로 전환이 성공해버렸다(rental-lifecycle.md·service-operations.md §10 —
 *   RentalDetailPanel.svelte TERMINAL Set 누락과 짝을 이루는 결함, 그쪽은 문서/UI만
 *   막고 서버는 그대로 허용하던 상태였음).
 *
 * 완료기준:
 *   EC-1: status=expired 예약은 update_reservation_status(id,'cancelled')가 ok:false를
 *         반환하고, 실제 DB status도 expired로 그대로 유지된다(전환 자체가 일어나지 않음).
 *   EC-2(회귀 방지): 기존에 이미 차단되던 completed/cancelled/damage_claimed 종료상태는
 *         이번 수정 이후에도 동일하게 차단된다.
 *   EC-3(회귀 방지): 정상 비종료 상태(hold)는 이번 수정과 무관하게 여전히 정상 전환된다
 *         (v_current_status IN 목록에 항목을 하나 추가한 것이 다른 분기에 영향 없음을 확인).
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let testProductId: string;

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-expiredterm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createReservation(userId: string, status: string): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    testProductId,
      // 먼 미래 날짜로 격리 — 다른 통합테스트·실사용 데이터와 기간 겹침(이중예약 방지
      // 제약, rental_reservations_product_dates_excl) 회피 (contractSign.test.ts와 동일 패턴)
      start_date:    '2099-09-11',
      end_date:      '2099-09-13',
      status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return data.id as number;
}

async function callUpdateStatus(
  reservationId: number,
  newStatus: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc('update_reservation_status', {
    p_reservation_id: reservationId,
    p_new_status:     newStatus,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; error?: string };
}

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = data.id as string;
});

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

describe("update_reservation_status — 'expired' 종료상태 가드 (Migration #485)", () => {
  it('EC-1 GREEN: status=expired 예약은 cancelled로 전환 요청해도 ok:false + status가 expired로 그대로 유지된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'expired');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const result = await callUpdateStatus(reservationId, 'cancelled');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('종료된');

    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(reservation?.status).toBe('expired');
  });

  it('EC-2 회귀 방지: status=cancelled 예약은 기존과 동일하게 damage_claimed 전환도 차단된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'cancelled');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const result = await callUpdateStatus(reservationId, 'damage_claimed');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('종료된');

    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(reservation?.status).toBe('cancelled');
  });

  it('EC-3 회귀 방지: status=hold(비종료) 예약은 이번 수정과 무관하게 confirmed로 정상 전환된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const result = await callUpdateStatus(reservationId, 'confirmed');

    expect(result.ok).toBe(true);

    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(reservation?.status).toBe('confirmed');
  });
});
