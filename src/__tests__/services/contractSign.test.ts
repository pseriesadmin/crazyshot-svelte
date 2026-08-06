import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { POST as signContract } from '../../routes/api/contracts/[token]/sign/+server';

/**
 * BL-CHAT-C3 + BL-CHAT-B4(서명 부분) — 전자계약 서명 완료 처리 결함 수정 (TDD)
 *
 * 결함 A: 서명 완료 시 예약 상태(shipped→in_use)를 정식 RPC 없이 직접 UPDATE (H-01 위반)
 * 결함 B: 알림 전송 대상 채팅 세션이 pending/open이 아니면(전부 closed거나 세션 자체가 없으면)
 *         알림이 에러도 로그도 없이 조용히 유실됨
 *
 * 완료기준:
 *   - update_reservation_status RPC 경유로만 상태 변경 (직접 DML 금지)
 *   - pending → open → closed(재활성화) → 신규 생성 4단계 세션 탐색으로 알림 유실 방지
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SERVER_SOURCE_PATH = new URL('../../routes/api/contracts/[token]/sign/+server.ts', import.meta.url);

let testProductId: string;

type Cleanup = () => Promise<void>;

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-contractsign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
      start_date:    '2026-09-01',
      end_date:      '2026-09-03',
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

async function createChatSession(userId: string, status: 'open' | 'pending' | 'closed'): Promise<string> {
  const { data, error } = await admin
    .from('chat_sessions')
    .insert({ user_id: userId, status, context_type: 'reservation' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`chat_session 생성 실패: ${error?.message}`);
  return data.id as string;
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

describe('BL-CHAT-C3: 계약서명 완료 처리 — RPC 경유 상태 변경', () => {
  it('RED: 소스코드가 update_reservation_status RPC를 호출하고, rental_reservations를 직접 UPDATE하지 않는다 (H-01)', () => {
    const source = readFileSync(SERVER_SOURCE_PATH, 'utf-8');

    expect(source).toMatch(/admin\s*\.rpc\(\s*['"]update_reservation_status['"]/);
    // 직접 DML 금지 — rental_reservations.update({ status: ... }) 체인이 남아있으면 안 됨
    expect(source).not.toMatch(/\.from\(['"]rental_reservations['"]\)[\s\S]{0,80}\.update\(\{\s*status:/);
  });

  it('RED: shipped 상태 예약 + 서명 완료 → in_use로 전환된다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'shipped');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const sessionId = await createChatSession(userId, 'open');
    cleanups.push(async () => {
      await admin.from('chat_messages').delete().eq('session_id', sessionId);
      await admin.from('chat_sessions').delete().eq('id', sessionId);
    });

    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status, body } = await callSign(token);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(reservation?.status).toBe('in_use');

    const { data: messages } = await admin
      .from('chat_messages')
      .select('id, action_payload')
      .eq('session_id', sessionId);
    expect(messages?.length).toBeGreaterThan(0);
    const payload = messages?.[0]?.action_payload as { type?: string } | null;
    expect(payload?.type).toBe('contract_signed');
  });

  it('RED: shipped가 아닌 예약(in_use)은 서명 완료 후에도 상태가 훼손되지 않는다', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'in_use');
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

    const { data: reservation } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', reservationId)
      .single();
    expect(reservation?.status).toBe('in_use');
  });
});

describe('BL-CHAT-B4(서명): 채팅 세션 재사용 정책 — 알림 유실 방지', () => {
  it('RED: open/pending 세션이 없고 closed 세션만 있으면 → open으로 재활성화 후 알림 삽입', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'shipped');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const sessionId = await createChatSession(userId, 'closed');
    cleanups.push(async () => {
      await admin.from('chat_messages').delete().eq('session_id', sessionId);
      await admin.from('chat_sessions').delete().eq('id', sessionId);
    });

    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { status } = await callSign(token);
    expect(status).toBe(200);

    const { data: session } = await admin
      .from('chat_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();
    expect(session?.status).toBe('open');

    const { data: messages } = await admin
      .from('chat_messages')
      .select('id')
      .eq('session_id', sessionId);
    expect(messages?.length).toBeGreaterThan(0);
  });

  it('RED: 채팅 세션이 전혀 없으면 → 신규 세션 생성 후 알림 삽입', async () => {
    const userId = await createEphemeralUser();
    cleanups.push(() => deleteEphemeralUser(userId));

    const reservationId = await createReservation(userId, 'shipped');
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId);
    });

    const { contractId, signingId, token } = await createContractWithSigning(userId, reservationId);
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId);
      await admin.from('contracts').delete().eq('id', contractId);
    });

    const { data: before } = await admin.from('chat_sessions').select('id').eq('user_id', userId);
    expect(before?.length ?? 0).toBe(0);

    const { status } = await callSign(token);
    expect(status).toBe(200);

    const { data: after } = await admin
      .from('chat_sessions')
      .select('id, status')
      .eq('user_id', userId);
    expect(after?.length).toBe(1);
    expect(after?.[0]?.status).toBe('open');

    const newSessionId = after?.[0]?.id as string;
    cleanups.push(async () => {
      await admin.from('chat_messages').delete().eq('session_id', newSessionId);
      await admin.from('chat_sessions').delete().eq('id', newSessionId);
    });

    const { data: messages } = await admin
      .from('chat_messages')
      .select('id')
      .eq('session_id', newSessionId);
    expect(messages?.length).toBeGreaterThan(0);
  });
});

afterAll(async () => {
  // 개별 afterEach에서 대부분 정리되지만, 마지막 안전망으로 남은 항목은 없는지만 확인
});
