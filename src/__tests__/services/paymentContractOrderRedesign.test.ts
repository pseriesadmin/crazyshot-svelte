import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { POST as signContract } from '../../routes/api/contracts/[token]/sign/+server';
import { POST as payMock } from '../../routes/api/contracts/[token]/pay-mock/+server';
import { load as contractPageLoad } from '../../routes/contract/[token]/+page.server';

/**
 * TASK.md "예약 결제·계약서명 순서 재설계"(2026-08-21) — Phase F TDD 스위트
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 배경: 결제(mock) 트리거를 cart 체크아웃(1단계)에서 계약서명 완료 직후(3단계,
 * /api/contracts/[token]/pay-mock)로 이동. Migration 284(try_confirm_reservation/
 * mark_reservation_payment_confirmed)는 순서 무관 대칭 설계라 시그니처·게이팅 로직을
 * 그대로 재사용(변경 없음) — contractSigningGate.test.ts가 이미 검증한 대칭성을
 * 신규 pay-mock 엔드포인트 경로로 재확인하고, Phase D(release_reservation_hold 방어조건)를
 * 새로 검증한다.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다(contractSigningGate.test.ts·holdExpiration.test.ts와 동일 패턴).
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

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = (data as { id: string }).id;
});

function randomFutureDateRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 1;
  const start = new Date(Date.UTC(2027, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-paycontract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createReservation(
  userId: string,
  status: string,
  createdAt?: Date,
): Promise<number> {
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
  const id = data.id as number;

  if (createdAt) {
    const { error: updErr } = await admin
      .from('rental_reservations')
      .update({ created_at: createdAt.toISOString() })
      .eq('id', id);
    if (updErr) throw new Error(`created_at 조작 실패: ${updErr.message}`);
  }

  return id;
}

// contract_signings.sent_at까지 채워 "계약 발송(2단계 계약대기 진입)" 상태를 재현한다.
// contractSigningGate.test.ts의 createContractWithSigning은 sent_at을 채우지 않으므로
// (해당 파일은 계약대기 크론 방어조건과 무관) 이 파일 전용으로 별도 구현.
async function createSentContract(
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
    .insert({ contract_id: contract.id, user_id: userId, sent_at: new Date().toISOString() })
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

async function callPayMock(
  token: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/contracts/${token}/pay-mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await payMock({
    params: { token },
    request,
  } as unknown as Parameters<typeof payMock>[0]);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function getReservationRow(
  reservationId: number,
): Promise<{ status: string; payment_confirmed_at: string | null } | null> {
  const { data } = await admin
    .from('rental_reservations')
    .select('status, payment_confirmed_at')
    .eq('id', reservationId)
    .single();
  return (data as { status: string; payment_confirmed_at: string | null } | undefined) ?? null;
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

// ── F-1: 신청(1단계) ─────────────────────────────────────────────────────────
describe('F-1: 신청(1단계) — cart 체크아웃 후 결제(mock)가 호출되지 않는다', () => {
  it('GREEN: create_reservation_order(주문연결)만 호출해도 payment_confirmed_at은 NULL, status는 hold 유지', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('order_items').delete().eq('reservation_id', reservationId);
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    // cart/+page.svelte Phase B 이후 흐름 — create_reservation_order만 호출하고
    // confirm-mock(mark_reservation_payment_confirmed)은 더 이상 호출하지 않는다.
    const { error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId,
      p_reservation_ids: [reservationId],
    });
    expect(error).toBeNull();

    const row = await getReservationRow(reservationId);
    expect(row?.status).toBe('hold');
    expect(row?.payment_confirmed_at).toBeNull();
  });
});

// ── F-2: 계약대기(2단계) ──────────────────────────────────────────────────────
describe('F-2: 계약대기(2단계) — 계약 발송 후에도 결제·서명 둘 다 없으면 hold 유지', () => {
  it('GREEN: 계약 발송(sent_at) 직후에도 status는 hold, payment_confirmed_at은 NULL', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const row = await getReservationRow(reservationId);
    expect(row?.status).toBe('hold');
    expect(row?.payment_confirmed_at).toBeNull();
  });
});

// ── F-3: 서명+결제(3단계) 정상 경로 ────────────────────────────────────────────
describe('F-3: 서명+결제(3단계) 정상 경로', () => {
  it('GREEN: 서명 완료 → pay-mock 결제 → confirmed 전환 + reservation_approval 카드 정확히 1건 발송', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const signRes = await callSign(token);
    expect(signRes.status).toBe(200);
    // 서명만으로는 결제 전이라 아직 confirmed 아님(대칭성 — F-4와 동일 전제)
    expect((await getReservationRow(reservationId))?.status).toBe('hold');

    const payRes = await callPayMock(token);
    expect(payRes.status).toBe(200);
    expect(payRes.body.confirmed).toBe(true);

    const row = await getReservationRow(reservationId);
    expect(row?.status).toBe('confirmed');
    expect(row?.payment_confirmed_at).not.toBeNull();

    // resolveApprovalNotifyPlan 무회귀 — 단건 예약은 기존과 동일하게 카드 정확히 1건
    const sessionId = await findGeneralSessionId(userId);
    expect(sessionId).not.toBeNull();
    const cardCount = await countApprovalCards(sessionId as string);
    expect(cardCount).toBe(1);
  });
});

// ── F-4: 결제 없이 서명만 ──────────────────────────────────────────────────────
describe('F-4: 결제 없이 서명만 한 경우 — hold 유지, confirmed 전환 안 됨', () => {
  it('GREEN: pay-mock을 호출하지 않으면 서명 완료 후에도 계속 hold', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const signRes = await callSign(token);
    expect(signRes.status).toBe(200);

    const row = await getReservationRow(reservationId);
    expect(row?.status).toBe('hold');
    expect(row?.payment_confirmed_at).toBeNull();
  });
});

// ── F-5: 관리자 수동 승인 우회 경로 무회귀 ─────────────────────────────────────
describe('F-5: 관리자 수동 승인(approveReservation) 우회 경로 — 계약·결제 무관 즉시 confirmed', () => {
  it('GREEN: 계약서·결제 둘 다 없는 hold 예약도 update_reservation_status 직접 호출로 즉시 confirmed', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { data: result, error } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     'confirmed',
    });
    expect(error).toBeNull();
    expect((result as { ok?: boolean } | null)?.ok).toBe(true);
    expect((await getReservationRow(reservationId))?.status).toBe('confirmed');
  });
});

// ── F-6: HOLD 30분 만료 크론 방어조건(Phase D-1 + D-3) ─────────────────────────
describe('F-6: HOLD 30분 만료 크론 — 계약 발송·결제완료 방어조건(Migration 324)', () => {
  it('GREEN: 계약 미발송 hold는 기존대로 30분 후 expired 처리된다(회귀 없음)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold', new Date(Date.now() - 31 * 60 * 1000));
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    await admin.rpc('release_reservation_hold', {});
    expect((await getReservationRow(reservationId))?.status).toBe('expired');
  });

  it('GREEN: D-1 — 계약이 발송된(sent_at) hold는 30분이 지나도 expired 처리되지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold', new Date(Date.now() - 31 * 60 * 1000));
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    await admin.rpc('release_reservation_hold', {});
    expect((await getReservationRow(reservationId))?.status).toBe('hold');
  });

  it('GREEN: D-3 — 결제완료(payment_confirmed_at) 예약은 계약 발송 여부와 무관하게 30분이 지나도 expired 처리되지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold', new Date(Date.now() - 31 * 60 * 1000));
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    // 계약 없이 결제(mock)만 먼저 완료된 과도기 상태 재현 — mark_reservation_payment_confirmed는
    // 계약이 없어도 payment_confirmed_at은 그대로 기록한다(try_confirm_reservation만 false 반환)
    await admin.rpc('mark_reservation_payment_confirmed', { p_reservation_id: reservationId });
    expect((await getReservationRow(reservationId))?.payment_confirmed_at).not.toBeNull();

    await admin.rpc('release_reservation_hold', {});
    expect((await getReservationRow(reservationId))?.status).toBe('hold');
  });
});

// ── F-7: 동시성 리스크 — 서명완료~결제(mock) 사이 30분 크론 개입 ────────────────
describe('F-7: 동시성 리스크 — 서명 완료 후 결제(mock) 전 30분 경과해도 안전하게 이어서 결제 가능', () => {
  it('GREEN: 서명 완료(계약발송 hold, 생성 31분 경과) → 크론 실행(만료 안 됨) → pay-mock 호출 → 정상 confirmed 전환', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold', new Date(Date.now() - 31 * 60 * 1000));
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    // 서명 완료(3단계 진입 직전) — 아직 결제 전
    const signRes = await callSign(token);
    expect(signRes.status).toBe(200);
    expect((await getReservationRow(reservationId))?.status).toBe('hold');

    // 이 순간 30분 만료 크론이 개입해도(이번 아젠다의 원 발단 버그 신규 흐름판) 계약이
    // 발송된 hold이므로 D-1 방어조건에 의해 파괴되지 않아야 한다
    await admin.rpc('release_reservation_hold', {});
    expect((await getReservationRow(reservationId))?.status).toBe('hold');

    // 크론이 파괴하지 않았으므로 이어서 결제(mock)를 진행하면 정상적으로 confirmed 전환된다
    const payRes = await callPayMock(token);
    expect(payRes.status).toBe(200);
    expect(payRes.body.confirmed).toBe(true);
    expect((await getReservationRow(reservationId))?.status).toBe('confirmed');
  });
});

// ── Phase E: CMS 배지·필터 정합성 검증 (신규 구현 아님 — 기존 STATUS_FILTERS가 새
//    흐름에서도 정확한 건수를 반환하는지, get_rental_list RPC를 /cms/reservation·
//    /cms/rentals의 +page.server.ts와 동일한 파라미터로 직접 호출해 확인) ──────────
describe('Phase E: CMS 배지·필터 정합성 검증', () => {
  it('E-1: 신청대기(계약 미발송) 예약은 p_require_contract_sent_unsigned=true(계약대기)에서 제외되고, 평범한 hold 조회에는 포함된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    // /cms/reservation +page.server.ts '신청대기' 칩과 동일 호출(계약대기 파라미터 없음)
    const { data: holdRows, error: holdErr } = await admin.rpc('get_rental_list', {
      p_status: 'hold',
      p_page: 1,
      p_per_page: 100,
      p_exclude_statuses: ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft'],
    });
    expect(holdErr).toBeNull();
    expect((holdRows ?? []).some((r: { reservation_id: number }) => r.reservation_id === reservationId)).toBe(true);

    // '계약대기' 칩과 동일 호출 — 계약을 발송한 적이 없으므로 제외돼야 함
    const { data: pendingRows, error: pendingErr } = await admin.rpc('get_rental_list', {
      p_status: 'hold',
      p_page: 1,
      p_per_page: 100,
      p_exclude_statuses: ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft'],
      p_require_contract_sent_unsigned: true,
    });
    expect(pendingErr).toBeNull();
    expect((pendingRows ?? []).some((r: { reservation_id: number }) => r.reservation_id === reservationId)).toBe(false);
  });

  it('E-1: 계약대기(계약 발송·미서명) 예약은 p_require_contract_sent_unsigned=true 조회에 정확히 포함된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { data: pendingRows, error: pendingErr } = await admin.rpc('get_rental_list', {
      p_status: 'hold',
      p_page: 1,
      p_per_page: 100,
      p_exclude_statuses: ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'draft'],
      p_require_contract_sent_unsigned: true,
    });
    expect(pendingErr).toBeNull();
    const row = (pendingRows ?? []).find((r: { reservation_id: number }) => r.reservation_id === reservationId) as
      { reservation_id: number; signing_sent_at: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.signing_sent_at).not.toBeNull();
  });

  it('E-2: 서명+결제(3단계) 완료로 confirmed 전환된 예약이 /cms/rentals "계약완료" 칩 조회(p_status=confirmed)에 정확히 포함된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    await callSign(token);
    const payRes = await callPayMock(token);
    expect(payRes.body.confirmed).toBe(true);

    // /cms/rentals +page.server.ts '계약완료' 칩과 동일 호출
    const { data: confirmedRows, error: confirmedErr } = await admin.rpc('get_rental_list', {
      p_status: 'confirmed',
      p_page: 1,
      p_per_page: 100,
      p_include_statuses: ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed'],
    });
    expect(confirmedErr).toBeNull();
    expect((confirmedRows ?? []).some((r: { reservation_id: number }) => r.reservation_id === reservationId)).toBe(true);
  });
});

// ── EC-1: 서명 완료 후(결제 전) /contract/[token] 재접속 — sp3-qa-agent 발견 CRITICAL 수정 ──
describe('EC-1: 서명 완료 후 결제 전 상태로 /contract/[token]에 재접속(새로고침·재방문)', () => {
  it('GREEN: redirect 없이 로드되고 alreadySigned=true로 결제 단계 진입이 가능하다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const signRes = await callSign(token);
    expect(signRes.status).toBe(200);
    // 서명만으로는 결제 전이라 여전히 hold(F-3/F-4와 동일 전제)
    expect((await getReservationRow(reservationId))?.status).toBe('hold');

    // "재접속" 시뮬레이션 — 서명 직후가 아니라 별도 요청으로 load()를 다시 호출.
    // 과거 버그: signing.signed_at만 보고 무조건 /contract/signed로 redirect(throw) —
    // 결제 UI가 없는 죽은 안내 페이지라 여기서 예외가 던져지면 곧 이 테스트가 실패한다.
    const result = await (contractPageLoad as (e: unknown) => Promise<{ alreadySigned?: boolean }>)(
      { params: { token } } as unknown as Parameters<typeof contractPageLoad>[0],
    );
    expect(result.alreadySigned).toBe(true);

    // 이어서 결제(mock)까지 정상적으로 완료 가능해야 한다(재접속이 결제 경로를 막지 않음)
    const payRes = await callPayMock(token);
    expect(payRes.status).toBe(200);
    expect(payRes.body.confirmed).toBe(true);
    expect((await getReservationRow(reservationId))?.status).toBe('confirmed');
  });

  it('GREEN: 서명+결제까지 모두 끝난(confirmed) 예약은 여전히 /contract/signed로 redirect된다(회귀 없음)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    await callSign(token);
    const payRes = await callPayMock(token);
    expect(payRes.body.confirmed).toBe(true);

    await expect(
      (contractPageLoad as (e: unknown) => Promise<unknown>)(
        { params: { token } } as unknown as Parameters<typeof contractPageLoad>[0],
      ),
    ).rejects.toMatchObject({ status: 302, location: '/contract/signed' });
  });
});

// ── EC-3: 이미 confirmed(관리자 우회 승인)된 예약에 pay-mock 재접근 — no-op ─────
describe('EC-3: 관리자 수동 승인 후 고객이 뒤늦게 결제(mock) 페이지 재접근', () => {
  it('GREEN: 이미 confirmed인 예약에 pay-mock을 호출해도 안전하게 no-op 처리된다(중복승인 방지)', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'hold');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createSentContract(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    // 관리자가 계약·결제 여부와 무관하게 먼저 수동 승인(우회 경로)
    await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status:     'confirmed',
    });
    expect((await getReservationRow(reservationId))?.status).toBe('confirmed');

    // 고객이 옛 결제 링크(pay-mock)에 뒤늦게 접근 — 에러 없이 안전하게 처리되고
    // 상태는 여전히 confirmed(변경 없음)여야 한다
    const payRes = await callPayMock(token);
    expect(payRes.status).toBe(200);
    expect(payRes.body.alreadyProcessed).toBe(true);
    expect((await getReservationRow(reservationId))?.status).toBe('confirmed');
  });
});
