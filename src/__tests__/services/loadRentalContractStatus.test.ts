import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { loadRentalContractStatus } from '../../lib/server/account/loadRentalContractStatus';

/**
 * loadRentalContractStatus — 형제 예약(같은 주문의 다른 상품) 계약 상태 조회 (2026-08-31)
 *
 * 배경(감사로 발견된 CRITICAL 결함): init-contract API가 "같은 주문에 이미 계약이 있으면
 * 재사용"으로 바뀌어(2026-08-31), 계약(contracts)이 주문당 정확히 1건만 존재하고 대표
 * 예약에만 anchor된다. 이 함수가 예전처럼 각 reservationId 자신의 contracts.reservation_id
 * 만 조회하면, 형제 예약은 실제로 서명 완료된 계약이 있어도 영원히 "서명 안 됨"으로 잘못
 * 판정되어 마이페이지에서 "전자계약 확인" 버튼이 뜨지 않는다. 이 스위트는 그 수정을 검증한다.
 *
 * 실제 라이브 통합 테스트(Stage DB) — 기존 결제 관련 테스트와 동일 패턴.
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
  const start = new Date(Date.UTC(2036, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-contractstatus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  return data.user.id;
}

async function createReservation(userId: string): Promise<number> {
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

async function createPendingContract(userId: string, reservationId: number): Promise<{ contractId: string; signingId: string; token: string }> {
  const { data: contract, error: cErr } = await admin
    .from('contracts')
    .insert({ reservation_id: reservationId, user_id: userId, contract_type: 'rental', status: 'active' })
    .select('id')
    .single();
  if (cErr || !contract) throw new Error(`contract 생성 실패: ${cErr?.message}`);

  const { data: signing, error: sErr } = await admin
    .from('contract_signings')
    .insert({ contract_id: contract.id, user_id: userId, sent_at: new Date().toISOString() })
    .select('id, token')
    .single();
  if (sErr || !signing) throw new Error(`contract_signings 생성 실패: ${sErr?.message}`);

  return { contractId: contract.id as string, signingId: signing.id as string, token: signing.token as string };
}

async function linkToOrder(userId: string, reservationIds: number[]): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  });
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`);
}

describe('loadRentalContractStatus — 형제 예약 계약 상태 조회(CRITICAL 수정)', () => {
  it('CRITICAL 회귀 확인: 형제 예약(계약 미소유)도 대표 예약이 서명완료면 signed=true로 조회된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchorId  = await createReservation(userId);
    const siblingId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [anchorId, siblingId]);
    });
    await linkToOrder(userId, [anchorId, siblingId]);

    // init-contract 정책과 동일하게 대표 예약(anchor)에만 계약을 만들고 서명 완료 처리.
    const { contractId, signingId } = await createSignedContract(userId, anchorId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const statusMap = await loadRentalContractStatus(admin as never, [anchorId, siblingId]);

    expect(statusMap.get(String(anchorId))?.signed).toBe(true);
    // 수정 전(버그): 형제 예약은 자기 자신 소유 계약이 없어 signed=false로 잘못 조회됨.
    expect(statusMap.get(String(siblingId))?.signed).toBe(true);
  });

  it('형제 예약(계약 미소유)도 대표 예약이 서명대기 상태면 같은 pendingToken을 받는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchorId  = await createReservation(userId);
    const siblingId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [anchorId, siblingId]);
    });
    await linkToOrder(userId, [anchorId, siblingId]);

    const { contractId, signingId, token } = await createPendingContract(userId, anchorId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const statusMap = await loadRentalContractStatus(admin as never, [anchorId, siblingId]);

    expect(statusMap.get(String(anchorId))?.signed).toBe(false);
    expect(statusMap.get(String(anchorId))?.pendingToken).toBe(token);
    expect(statusMap.get(String(siblingId))?.signed).toBe(false);
    expect(statusMap.get(String(siblingId))?.pendingToken).toBe(token);
  });

  it('무회귀: 주문에 묶이지 않은 단일 예약(계약 직접 소유)은 기존과 동일하게 동작한다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const reservationId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId } = await createSignedContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const statusMap = await loadRentalContractStatus(admin as never, [reservationId]);
    expect(statusMap.get(String(reservationId))?.signed).toBe(true);
  });

  it('무회귀: 계약 자체가 없는 예약은 signed=false, pendingToken=null', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const reservationId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const statusMap = await loadRentalContractStatus(admin as never, [reservationId]);
    expect(statusMap.get(String(reservationId))).toEqual({ signed: false, pendingToken: null });
  });

  it('과잉병합 방지: 서로 다른 주문의 예약끼리는 계약 상태가 섞이지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const ridA = await createReservation(userId); // 계약 서명완료
    const ridB = await createReservation(userId); // 계약 없음(독립, 다른 주문)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [ridA, ridB]);
    });
    // 서로 다른 주문으로 각각 링크(형제 관계 아님)
    await linkToOrder(userId, [ridA]);
    await linkToOrder(userId, [ridB]);

    const { contractId, signingId } = await createSignedContract(userId, ridA);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const statusMap = await loadRentalContractStatus(admin as never, [ridA, ridB]);
    expect(statusMap.get(String(ridA))?.signed).toBe(true);
    expect(statusMap.get(String(ridB))?.signed).toBe(false);
  });
});
