import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { POST as signContract } from '../../routes/api/contracts/[token]/sign/+server';

/**
 * 계약서 서명 완료를 예약승인(confirmed) 필수조건으로 게이팅 — TDD (2026-08-17)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * plan_source: /Users/stevenmac/.claude/plans/encapsulated-bubbling-lightning.md
 *
 * 완료기준(B-START):
 *   정상 동작   : 결제완료(payment_confirmed_at) AND 계약서명완료(contract_signings.signed_at)
 *                둘 다 충족하는 순간(어느 쪽이 먼저든) hold → confirmed 자동 전환.
 *   막아야 할 것 : 결제만 완료됐거나 서명만 완료된 상태에서 confirmed로 전환되는 것.
 *   실패했을 때 : 조건 미충족 시 status는 hold 그대로 남고 payment_confirmed_at/signed_at은
 *                각자 기록된 값을 유지한다(멱등 — 재시도해도 안전).
 *
 * 주의: 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다(contractSign.test.ts와 동일 패턴). Migration 284(try_confirm_reservation /
 * mark_reservation_payment_confirmed RPC)가 Stage DB에 적용되기 전까지는 RPC not found로
 * 전부 실패하는 것이 정상이다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let testProductId: string;

type Cleanup = () => Promise<void>;

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-signgate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

// Stage DB는 다수의 동시 세션이 공유한다 — 고정 날짜(2026-09-01~03)를 쓰면
// rental_reservations_product_dates_excl(동일 상품·겹치는 기간 배제 제약)와 충돌해
// 무관한 동시 테스트가 서로를 실패시킨다. 매 호출마다 먼 미래의 랜덤 3일 구간을 배정해 충돌을
// 피한다(연-월-일 자체는 검증 대상이 아니므로 임의값으로도 완전 무해함).
function randomFutureDateRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 1; // 2027-01-01부터 최대 +10년 내 랜덤
  const start = new Date(Date.UTC(2027, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createReservation(userId: string, status: string): Promise<number> {
  const { start, end } = randomFutureDateRange();
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    testProductId,
      start_date:    start,
      end_date:      end,
      status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  return data.id as number;
}

async function createContractWithSigning(
  userId: string,
  reservationId: number,
): Promise<{ contractId: string; signingId: string; token: string }> {
  const { data: contract, error: contractErr } = await admin
    .from('contracts')
    .insert({
      reservation_id: reservationId,
      user_id:        userId,
      contract_type:  'rental',
      status:         'active',
    })
    .select('id')
    .single();
  if (contractErr || !contract) throw new Error(`contract 생성 실패: ${contractErr?.message}`);

  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .insert({ contract_id: contract.id, user_id: userId })
    .select('id, token')
    .single();
  if (signingErr || !signing) throw new Error(`contract_signings 생성 실패: ${signingErr?.message}`);

  return { contractId: contract.id as string, signingId: signing.id as string, token: signing.token as string };
}

async function callSign(token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/contracts/${token}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signature_data: 'data:image/png;base64,AAAA', stroke_count: 3 }),
  });

  const res = await signContract({
    params: { token },
    request,
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof signContract>[0]);

  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function getReservationStatus(reservationId: number): Promise<string | null> {
  const { data } = await admin
    .from('rental_reservations')
    .select('status')
    .eq('id', reservationId)
    .single();
  return (data?.status as string | undefined) ?? null;
}

// reservation-rental-execution.md §0-4 #7 — 같은 order로 묶인 다중상품 예약을 만들기 위한 헬퍼.
// resolveApprovalNotifyPlan은 order_items.order_id로 형제 예약을 찾으므로, 실제 체크아웃과
// 동일하게 orders + order_items 행을 직접 만든다.
async function linkReservationsToOrder(userId: string, reservationIds: number[]): Promise<number> {
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      order_key:     `TDD-ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      user_id:       userId,
      total_amount:  1000,
      final_amount:  1000,
    })
    .select('id')
    .single();
  if (orderErr || !order) throw new Error(`order 생성 실패: ${orderErr?.message}`);

  for (const reservationId of reservationIds) {
    const { data: product } = await admin.from('rental_reservations').select('product_id').eq('id', reservationId).single();
    const { error: itemErr } = await admin.from('order_items').insert({
      order_id:       order.id,
      reservation_id: reservationId,
      product_id:     product?.product_id,
      unit_price:     500,
      line_total:     500,
    });
    if (itemErr) throw new Error(`order_items 생성 실패: ${itemErr.message}`);
  }
  return order.id as number;
}

async function findGeneralSessionId(userId: string): Promise<string | null> {
  const { data } = await admin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('context_type', 'general')
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function countApprovalCards(sessionId: string): Promise<number> {
  const { data } = await admin
    .from('chat_messages')
    .select('id, action_payload')
    .eq('session_id', sessionId);
  return (data ?? []).filter(
    (m) => (m.action_payload as { type?: string } | null)?.type === 'reservation_approval'
  ).length;
}

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = data.id as string;
});

const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

describe('계약서명 게이팅: 결제완료 없이 서명만 완료 — hold 유지(막아야 할 것)', () => {
  it('RED: hold 예약 + 계약서명 완료(결제 미확인) → status는 여전히 hold', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);

    // 서명 자체는 완료돼야 함
    const { data: signing } = await admin
      .from('contract_signings')
      .select('signed_at')
      .eq('id', signingId)
      .single();
    expect(signing?.signed_at).not.toBeNull();

    // 그러나 결제완료(payment_confirmed_at)가 없으므로 confirmed 전환은 되지 않는다
    expect(await getReservationStatus(reservationId)).toBe('hold');
  });
});

describe('계약서명 게이팅: 결제 먼저 → 서명 나중 (정상 동작, 순서 1)', () => {
  it('RED: 결제완료(계약 없음) 시도 시 FALSE, 이후 계약 생성+서명 완료 시 confirmed 전환', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    // 계약이 아직 없는 상태에서 결제완료 시도 → FALSE(계약서명 미충족), status는 hold 유지
    const { data: firstAttempt, error: firstErr } = await admin.rpc('mark_reservation_payment_confirmed', {
      p_reservation_id: reservationId,
    });
    expect(firstErr).toBeNull();
    expect(firstAttempt).toBe(false);
    expect(await getReservationStatus(reservationId)).toBe('hold');

    // payment_confirmed_at은 이미 기록됐어야 함(멱등 재시도를 위한 선행 기록)
    const { data: afterPayment } = await admin
      .from('rental_reservations')
      .select('payment_confirmed_at')
      .eq('id', reservationId)
      .single();
    expect(afterPayment?.payment_confirmed_at).not.toBeNull();

    // 이제 계약을 생성하고 서명 완료 → try_confirm_reservation이 AND 조건 재검증 후 confirmed
    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);
    expect(await getReservationStatus(reservationId)).toBe('confirmed');
  });
});

describe('계약서명 게이팅: 서명 먼저 → 결제 나중 (정상 동작, 순서 2 — 대칭성 검증)', () => {
  it('RED: 서명 먼저 완료(결제 미확인) → hold 유지, 이후 결제완료 시 confirmed 전환', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);
    // 결제완료 전이므로 confirmed 전환 안 됨
    expect(await getReservationStatus(reservationId)).toBe('hold');

    // 이후 결제완료 → 이미 서명돼 있으므로 즉시 confirmed 전환
    const { data: confirmed, error: confirmErr } = await admin.rpc('mark_reservation_payment_confirmed', {
      p_reservation_id: reservationId,
    });
    expect(confirmErr).toBeNull();
    expect(confirmed).toBe(true);
    expect(await getReservationStatus(reservationId)).toBe('confirmed');
  });
});

describe('reservation-rental-execution.md §0-4 #7 — 묶음주문 서명완료 자동승인도 통합알림 정책과 일치', () => {
  it('GREEN: 형제 예약이 아직 미승인이면 이번 서명 건은 알림 보류(hold) — 개별 카드 미발송', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationA = await createReservation(userId, 'hold');
    const reservationB = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('reservation_id', reservationA);
      await admin.from('order_items').delete().eq('reservation_id', reservationB);
      await admin.from('rental_reservations').delete().in('id', [reservationA, reservationB]);
    });

    const orderId = await linkReservationsToOrder(userId, [reservationA, reservationB]);
    cleanups.push(async () => {
      await admin.from('orders').delete().eq('id', orderId);
    });

    // A만 결제+서명 완료 (B는 여전히 hold, 계약 자체도 없음 — 미승인 형제)
    await admin.rpc('mark_reservation_payment_confirmed', { p_reservation_id: reservationA });
    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationA);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);
    expect(await getReservationStatus(reservationA)).toBe('confirmed');
    expect(await getReservationStatus(reservationB)).toBe('hold');

    // 형제(B)가 아직 미승인이므로 이번 A 승인은 알림 보류 — reservation_approval 카드가
    // 전혀 발송되지 않아야 함(개별 카드로 새서는 안 됨)
    const sessionId = await findGeneralSessionId(userId);
    const cardCount = sessionId ? await countApprovalCards(sessionId) : 0;
    expect(cardCount).toBe(0);
  });

  it('GREEN: 마지막 형제까지 서명완료되면 개별 카드가 아닌 통합 카드 1건으로 발송된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationA = await createReservation(userId, 'hold');
    const reservationB = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('reservation_id', reservationA);
      await admin.from('order_items').delete().eq('reservation_id', reservationB);
      await admin.from('rental_reservations').delete().in('id', [reservationA, reservationB]);
    });

    const orderId = await linkReservationsToOrder(userId, [reservationA, reservationB]);
    cleanups.push(async () => {
      await admin.from('orders').delete().eq('id', orderId);
    });

    // A 먼저 결제+서명 완료 (B는 아직) → hold 모드, 알림 없음(위 테스트와 동일 선행 상태)
    await admin.rpc('mark_reservation_payment_confirmed', { p_reservation_id: reservationA });
    const signA = await createContractWithSigning(userId, reservationA);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signA.signingId);
      await admin.from('contracts').delete().eq('id', signA.contractId);
    });
    await callSign(signA.token);
    expect(await getReservationStatus(reservationA)).toBe('confirmed');

    // B도 결제+서명 완료 → 이제 형제 전체가 confirmed → batch 분기로 통합 카드 1건 발송
    await admin.rpc('mark_reservation_payment_confirmed', { p_reservation_id: reservationB });
    const signB = await createContractWithSigning(userId, reservationB);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signB.signingId);
      await admin.from('contracts').delete().eq('id', signB.contractId);
    });
    const { status } = await callSign(signB.token);
    expect(status).toBe(200);
    expect(await getReservationStatus(reservationB)).toBe('confirmed');

    const sessionId = await findGeneralSessionId(userId);
    expect(sessionId).not.toBeNull();
    // 개별 카드 2건이 아니라 통합 카드 정확히 1건이어야 함 — send_rental_chat_notification_batch
    const cardCount = await countApprovalCards(sessionId as string);
    expect(cardCount).toBe(1);
  });

  it('GREEN: 형제 없는 단건 예약은 기존과 동일하게 즉시 단건 카드 발송(회귀 없음)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('mark_reservation_payment_confirmed', { p_reservation_id: reservationId });
    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);
    expect(await getReservationStatus(reservationId)).toBe('confirmed');

    const sessionId = await findGeneralSessionId(userId);
    const cardCount = sessionId ? await countApprovalCards(sessionId) : 0;
    expect(cardCount).toBe(1);
  });
});

describe('관리자 수동 승인 우회 — 게이팅과 무관하게 회귀 없이 동작(Stephen 확정 정책)', () => {
  it('RED: 계약서 없는 hold 예약도 update_reservation_status 직접 호출로 즉시 confirmed 전환된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    // 계약서 자체가 없는 상태 — approveReservation 액션과 동일한 우회 경로
    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     'confirmed',
    });
    expect(error).toBeNull();
    expect((result as { ok?: boolean } | null)?.ok).toBe(true);
    expect(await getReservationStatus(reservationId)).toBe('confirmed');
  });
});
