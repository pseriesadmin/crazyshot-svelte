import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { awardReturnRegisterMissionPoints, awardReturnMissionForApproved, loadReturnMissionPoints } from '$lib/server/awardReturnRegisterMissionPoints';

/**
 * 반납등록 미션(return_register_mission) 포인트 TDD 통합테스트 — Migration #739 (2026-10-22)
 *
 * 정책(Stephen 확정): 고객이 반납정보(사진·확인·이용 평가) 등록을 마치면 CMS 포인트 규칙 금액을 예약당 1회 지급.
 * 규칙은 초기 0원·꺼짐 — 관리자가 켜기 전에는 지급·문구 노출 없음. 함수는 service_role 전용.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브 통합테스트다(onTimeReturnPointsAward.test.ts 패턴).
 * 규칙 행은 테스트 중에 값을 바꿨다가 afterEach 에서 원래 값으로 되돌린다.
 */

// Stage 원격 DB 왕복이 느릴 수 있어 5초 기본 제한(sp3 검수에서 시간 초과 관측)을 늘린다
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-return-mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });
  return userId;
}

async function pickChildProduct(): Promise<string> {
  const { data, error } = await admin.from('products').select('id').not('parent_product_id', 'is', null).eq('is_active', true).limit(1).single();
  if (error || !data) throw new Error(`테스트용 자식 상품 조회 실패: ${error?.message}`);
  return data.id as string;
}

async function createReservation(userId: string, childProductId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  // eslint-disable-next-line no-restricted-syntax -- H-01: 라이브 통합테스트가 시험용 예약을 직접 만든다(기존 시험과 동일 관행)
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: childProductId, start_date: today, end_date: today, status: 'in_use', pickup_method: 'visit', return_method: 'epost' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  const id = data.id as number;
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', id); });
  return id;
}

async function getRule(): Promise<{ amount: number; is_active: boolean }> {
  const { data, error } = await admin.from('point_earn_rules').select('amount, is_active').eq('event_type', 'return_register_mission').single();
  if (error || !data) throw new Error(`return_register_mission 규칙 조회 실패: ${error?.message}`);
  return data as { amount: number; is_active: boolean };
}

/** 규칙을 바꾸고 테스트가 끝나면 원래 값으로 되돌린다 */
async function setRule(amount: number, isActive: boolean): Promise<void> {
  const original = await getRule();
  await admin.from('point_earn_rules').update({ amount, is_active: isActive }).eq('event_type', 'return_register_mission');
  cleanups.push(async () => {
    await admin.from('point_earn_rules').update({ amount: original.amount, is_active: original.is_active }).eq('event_type', 'return_register_mission');
  });
}

async function getPoints(userId: string): Promise<number> {
  const { data, error } = await admin.from('user_profiles').select('points').eq('user_id', userId).single();
  if (error || !data) throw new Error(`user_profiles 조회 실패: ${error?.message}`);
  return data.points as number;
}

async function rpcAward(reservationId: number) {
  return (admin.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>)(
    'award_return_register_mission_points',
    { p_reservation_id: reservationId },
  );
}

describe('[TDD] award_return_register_mission_points 반납등록 미션 적립 — Migration #739', () => {
  it('① 규칙이 켜져 있으면 규칙 금액만큼 적립되고 거래 내역이 남는다', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    const before = await getPoints(userId);
    const { data, error } = await rpcAward(reservationId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.amount).toBe(300);
    expect((await getPoints(userId)) - before).toBe(300);

    const { data: tx } = await admin.from('point_transactions').select('amount, type').eq('ref_type', 'return_register_mission').eq('ref_id', String(reservationId));
    expect(tx).toEqual([{ amount: 300, type: 'earn' }]);
  });

  it('② 멱등성: 같은 예약에 두 번 호출해도 중복 지급되지 않는다', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    await rpcAward(reservationId);
    const afterFirst = await getPoints(userId);
    const { data } = await rpcAward(reservationId);
    expect(data?.already_granted).toBe(true);
    expect(await getPoints(userId)).toBe(afterFirst);
  });

  it('③ 규칙이 꺼져 있으면(초기값) 지급하지 않는다(rule_inactive)', async () => {
    await setRule(300, false);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    const before = await getPoints(userId);
    const { data } = await rpcAward(reservationId);
    expect(data?.success).toBe(false);
    expect(data?.error).toBe('rule_inactive');
    expect(await getPoints(userId)).toBe(before);
  });

  it('④ 켜져 있어도 금액이 0원이면 지급하지 않는다', async () => {
    await setRule(0, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    const { data } = await rpcAward(reservationId);
    expect(data?.error).toBe('rule_inactive');
  });

  it('⑤ 없는 예약이면 reservation_not_found', async () => {
    await setRule(300, true);
    const { data } = await rpcAward(2147483000);
    expect(data?.success).toBe(false);
    expect(data?.error).toBe('reservation_not_found');
  });

  it('⑦ 동시 호출: 같은 예약으로 거의 동시에 두 번 호출해도 적립은 한 번뿐이다(Migration #741)', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    const before = await getPoints(userId);
    const results = await Promise.all([rpcAward(reservationId), rpcAward(reservationId), rpcAward(reservationId)]);
    results.forEach((r) => expect(r.error).toBeNull());
    // 정확히 한 번만 새로 지급되고 나머지는 이미 지급으로 응답
    expect(results.filter((r) => r.data?.amount === 300).length).toBe(1);
    expect(results.filter((r) => r.data?.already_granted === true).length).toBe(2);
    expect((await getPoints(userId)) - before).toBe(300);

    const { data: tx } = await admin.from('point_transactions').select('amount').eq('ref_type', 'return_register_mission').eq('ref_id', String(reservationId));
    expect(tx).toEqual([{ amount: 300 }]);
  });

  it('⑧ DB 최후 방어선: 같은 예약의 미션 적립 내역을 직접 한 번 더 넣으면 유일 인덱스가 거절한다', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());
    await rpcAward(reservationId);

    const { error } = await admin.from('point_transactions').insert({
      user_id: userId, type: 'earn', amount: 300, balance_after: 0, description: 'dup', ref_type: 'return_register_mission', ref_id: String(reservationId),
    });
    expect(error).not.toBeNull();
  });

  it('⑥ 일반 사용자(anon 키)는 이 함수를 호출할 수 없다(service_role 전용)', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
    const { error } = await (anon.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
      'award_return_register_mission_points',
      { p_reservation_id: 1 },
    );
    expect(error).not.toBeNull();
  });
});

describe('[TDD] 서버 헬퍼 — awardReturnRegisterMissionPoints·loadReturnMissionPoints', () => {
  it('지급 결과에 이번에 받은 포인트가 담기고, 재호출은 0이다', async () => {
    await setRule(250, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());

    const first = await awardReturnRegisterMissionPoints(admin, reservationId);
    expect(first.awarded).toBe(250);
    const second = await awardReturnRegisterMissionPoints(admin, reservationId);
    expect(second.awarded).toBe(0);
  });

  it('규칙이 꺼져 있으면 awarded 0, 미션 문구용 포인트는 null (문구 숨김)', async () => {
    await setRule(250, false);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());
    expect((await awardReturnRegisterMissionPoints(admin, reservationId)).awarded).toBe(0);
    expect(await loadReturnMissionPoints(admin)).toBeNull();
  });

  it('규칙이 켜져 있으면 미션 문구용 포인트는 규칙 금액', async () => {
    await setRule(250, true);
    expect(await loadReturnMissionPoints(admin)).toBe(250);
  });
});

describe('[TDD] 검수 승인 후 지급 — awardReturnMissionForApproved (제출 즉시 지급 아님)', () => {
  async function createSubmission(reservationId: number, userId: string): Promise<void> {
    const { error } = await admin.from('reservation_return_submissions').insert({ reservation_id: reservationId, method: 'courier', checklist: [], submitted_by: userId });
    if (error) throw new Error(`submission 생성 실패: ${error.message}`);
    cleanups.push(async () => { await admin.from('reservation_return_submissions').delete().eq('reservation_id', reservationId); });
  }

  it('고객이 반납정보를 등록하지 않은 예약(방문 반납 등)은 승인돼도 지급하지 않는다', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());
    const before = await getPoints(userId);
    await awardReturnMissionForApproved(admin, [reservationId]);
    expect(await getPoints(userId)).toBe(before);
  });

  it('등록한 예약은 승인 시 규칙 금액이 1회만 지급된다(재호출·동시 호출에도 1회)', async () => {
    await setRule(300, true);
    const userId = await createEphemeralUser();
    const reservationId = await createReservation(userId, await pickChildProduct());
    await createSubmission(reservationId, userId);
    const before = await getPoints(userId);
    await Promise.all([awardReturnMissionForApproved(admin, [reservationId]), awardReturnMissionForApproved(admin, [reservationId])]);
    await awardReturnMissionForApproved(admin, [reservationId]);
    expect((await getPoints(userId)) - before).toBe(300);
  });

  it('빈 목록은 아무 일도 하지 않는다', async () => {
    await expect(awardReturnMissionForApproved(admin, [])).resolves.toBeUndefined();
  });
});
