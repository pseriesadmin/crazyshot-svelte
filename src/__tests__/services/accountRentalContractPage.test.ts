import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { load as accountRentalContractLoad } from '../../routes/account/rental/[id]/contract/+page.server';

/**
 * /account/rental/[id]/contract — 형제 예약(같은 주문의 다른 상품) 계약 열람 CRITICAL 수정
 * (2026-08-31, 감사로 발견)
 *
 * 배경: init-contract API가 "같은 주문에 이미 계약이 있으면 재사용"으로 바뀌어 계약이
 * 주문당 1건만 존재(대표 예약에만 anchor)하는데, 이 페이지의 계약 조회가
 * `.eq('contracts.reservation_id', res.id)`로 그 예약 자신의 계약만 봐서, 형제 예약의
 * URL(`/account/rental/{형제id}/contract`)로 접근하면 실제로는 서명 완료된 계약이 있어도
 * "계약 없음" 안내만 뜨던 CRITICAL 결함. order_items 경유 형제 조회로 수정했다.
 *
 * 실제 라이브 통합 테스트(Stage DB) — 소유권 검증은 RLS 클라이언트를 흉내낼 수 없어
 * locals.supabase를 admin으로 대체하는 대신, 실제 RLS를 태우는 사용자 세션 클라이언트를
 * 만들어 검증한다(accountWithdrawal.test.ts류의 ephemeral 세션 패턴).
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
  const start = new Date(Date.UTC(2037, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<{ userId: string; email: string; password: string }> {
  const email = `tdd-acctcontract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  return { userId: data.user.id, email, password };
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

async function linkToOrder(userId: string, reservationIds: number[]): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  });
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`);
}

// locals.supabase는 RLS를 태우는 사용자 세션 클라이언트여야 한다 — service_role 키로는
// "user_id 불일치 시 조회 자체가 안 됨" 소유권 검증을 재현할 수 없으므로, 실제로 로그인한
// 것과 동일하게 anon 키 + 비밀번호 로그인으로 세션을 발급받아 사용한다(accountWithdrawal.
// test.ts의 createEphemeralSession과 동일 패턴).
async function createUserSessionClient(email: string, password: string) {
  const anonClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`로그인 실패: ${error?.message}`);
  return anonClient;
}

describe('/account/rental/[id]/contract load() — 형제 예약 계약 열람(CRITICAL 수정)', () => {
  it('CRITICAL 회귀 확인: 형제 예약(계약 미소유) URL로 접근해도 대표 예약의 서명완료 계약이 조회된다', async () => {
    const { userId, email, password } = await createEphemeralUser();
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

    const anchorId  = await createReservation(userId);
    const siblingId = await createReservation(userId);
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().in('id', [anchorId, siblingId]);
    });
    await linkToOrder(userId, [anchorId, siblingId]);

    const { contractId, signingId } = await createSignedContract(userId, anchorId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const userClient = await createUserSessionClient(email, password);
    const { data: sessionData } = await userClient.auth.getSession();

    const event = {
      params: { id: String(siblingId) },
      locals: {
        safeGetSession: async () => ({ session: sessionData.session }),
        supabase: userClient,
      },
    } as unknown as Parameters<typeof accountRentalContractLoad>[0];

    const result = await accountRentalContractLoad(event) as { contract: unknown; mySignature: unknown };

    // 수정 전(버그): contract=null, mySignature=null(계약 없음 안내)로 잘못 반환됨.
    expect(result.contract).not.toBeNull();
    expect(result.mySignature).not.toBeNull();
  });
});
