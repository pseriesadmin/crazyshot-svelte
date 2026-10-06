import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { POST as signContract } from '../../routes/api/contracts/[token]/sign/+server';
import { sha256Hex } from '$lib/contract-signature/signatureEvidence';

/**
 * 전자계약 서명 증적 (Migration #650·#651, 2026-10-06) — Stage 라이브 통합 테스트
 *
 * 검증:
 *   - 필수 동의 3종이 없으면 서명을 접수하지 않는다(400, signed_at 그대로 NULL)
 *   - 동의 3종이 있으면 서명 + contract_signature_evidence 1행(IP·UA·동의·해시·약관 스냅샷)이 저장된다
 *   - final_html_sha256 = 서명 이미지가 합성된 최종 HTML의 SHA-256
 *   - 증적 행은 수정·삭제할 수 없다(추가 전용)
 *   - 감사로그에 consented·evidence_saved 이벤트가 남는다
 *
 * 주의: 증적 테이블은 추가 전용이라 이 테스트가 만든 행은 Stage에 남는다(의도된 동작).
 * 다른 라이브 테스트와 날짜 제약이 겹치지 않도록 매 실행 무작위 먼 미래 날짜를 쓴다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALL_CONSENTS = [
  { key: 'contract', checked: true },
  { key: 'privacy', checked: true },
  { key: 'terms_copy', checked: true },
];

const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const HTML = '<table><tr><td class="sig-host-cell">테스트 (인)<!--CUSTOMER_SIGNATURE--></td></tr></table>';

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];
let testProductId: string;

function randomFarDate(): { start: string; end: string } {
  const year = 2200 + Math.floor(Math.random() * 700);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  return { start: `${year}-${month}-10`, end: `${year}-${month}-12` };
}

async function createFixture(): Promise<{ userId: string; reservationId: number; contractId: string; signingId: string; token: string }> {
  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email: `tdd-sigevidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  });
  if (userErr || !user.user) throw new Error(`user 생성 실패: ${userErr?.message}`);
  const userId = user.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

  const { start, end } = randomFarDate();
  const { data: reservation, error: resErr } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: testProductId, start_date: start, end_date: end, status: 'hold', pickup_method: 'visit', return_method: 'visit' })
    .select('id')
    .single();
  if (resErr || !reservation) throw new Error(`reservation 생성 실패: ${resErr?.message}`);
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservation.id); });

  const { data: contract, error: contractErr } = await admin
    .from('contracts')
    .insert({
      reservation_id: reservation.id,
      user_id: userId,
      contract_type: 'rental',
      status: 'active',
      authoring_mode: 'html',
      html_document: HTML,
      privacy_terms_text: '테스트 개인정보 문단',
    })
    .select('id')
    .single();
  if (contractErr || !contract) throw new Error(`contract 생성 실패: ${contractErr?.message}`);

  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .insert({ contract_id: contract.id, user_id: userId })
    .select('id, token')
    .single();
  if (signingErr || !signing) throw new Error(`signing 생성 실패: ${signingErr?.message}`);
  cleanups.push(async () => {
    await admin.from('contract_signings').delete().eq('id', signing.id);
    await admin.from('contracts').delete().eq('id', contract.id);
  });

  return { userId, reservationId: reservation.id as number, contractId: contract.id as string, signingId: signing.id as string, token: signing.token as string };
}

async function callSign(token: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/contracts/${token}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'TDD-Agent/1.0 (evidence-test)' },
    body: JSON.stringify(body),
  });
  const res = await signContract({
    params: { token },
    request,
    getClientAddress: () => '203.0.113.7',
  } as unknown as Parameters<typeof signContract>[0]);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').limit(1).single();
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`);
  testProductId = data.id as string;
});

afterAll(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined);
});

describe('서명 API — 필수 동의 서버 검증', () => {
  it('RED: consents 없이(구버전 화면) 호출하면 400이고 서명이 접수되지 않는다', async () => {
    const f = await createFixture();
    const { status } = await callSign(f.token, { signature_data: SIG, stroke_count: 2 });
    expect(status).toBe(400);
    const { data } = await admin.from('contract_signings').select('signed_at').eq('id', f.signingId).single();
    expect(data?.signed_at).toBeNull();
    const { count } = await admin.from('contract_signature_evidence').select('id', { count: 'exact', head: true }).eq('signing_id', f.signingId);
    expect(count).toBe(0);
  }, 60_000);

  it('RED: 동의가 하나라도 false면 400', async () => {
    const f = await createFixture();
    const partial = ALL_CONSENTS.map((c, i) => (i === 2 ? { ...c, checked: false } : c));
    const { status } = await callSign(f.token, { signature_data: SIG, stroke_count: 2, consents: partial });
    expect(status).toBe(400);
    const { data } = await admin.from('contract_signings').select('signed_at').eq('id', f.signingId).single();
    expect(data?.signed_at).toBeNull();
  }, 60_000);
});

describe('서명 API — 동시 제출', () => {
  it('RED→GREEN: 같은 토큰을 동시에 두 번 제출하면 한 번만 접수되고 증적도 1행만 남는다(0행 UPDATE는 409)', async () => {
    const f = await createFixture();
    const body = { signature_data: SIG, stroke_count: 2, consents: ALL_CONSENTS };
    const [a, b] = await Promise.all([callSign(f.token, body), callSign(f.token, body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const { count } = await admin.from('contract_signature_evidence').select('id', { count: 'exact', head: true }).eq('signing_id', f.signingId);
    expect(count).toBe(1);

    // 증적의 signed_at이 실제 서명 시각과 정확히 일치해야 한다
    const { data: signing } = await admin.from('contract_signings').select('signed_at').eq('id', f.signingId).single();
    const { data: ev } = await admin.from('contract_signature_evidence').select('signed_at').eq('signing_id', f.signingId).single();
    expect(new Date(ev!.signed_at as string).getTime()).toBe(new Date(signing!.signed_at as string).getTime());
  }, 90_000);
});

describe('서명 API — 증적 저장', () => {
  it('GREEN: 동의 3종 + 서명 → 200, 증적 1행(IP·UA·동의·해시·약관 스냅샷)', async () => {
    const f = await createFixture();
    const { status } = await callSign(f.token, { signature_data: SIG, stroke_count: 2, consents: ALL_CONSENTS });
    expect(status).toBe(200);

    const { data: signing } = await admin.from('contract_signings').select('signed_at, content_hash').eq('id', f.signingId).single();
    expect(signing?.signed_at).not.toBeNull();

    const { data: ev, error } = await admin.from('contract_signature_evidence').select('*').eq('signing_id', f.signingId).single();
    expect(error).toBeNull();
    expect(ev?.contract_id).toBe(f.contractId);
    expect(ev?.reservation_id).toBe(f.reservationId);
    expect(new Date(ev!.signed_at as string).getTime()).toBe(new Date(signing!.signed_at as string).getTime());
    expect(ev?.ip_address).toBe('203.0.113.7');
    expect(ev?.user_agent).toBe('TDD-Agent/1.0 (evidence-test)');
    expect(ev?.content_hash).toBe(signing?.content_hash);
    expect((ev?.consent_log as { key: string; checked: boolean }[]).map((c) => c.key)).toEqual(['contract', 'privacy', 'terms_copy']);

    // 서명 이미지가 합성된 최종 HTML의 해시와 일치
    const { data: contract } = await admin.from('contracts').select('html_document').eq('id', f.contractId).single();
    expect(contract?.html_document).toContain('alt="예약자 서명"');
    expect(contract?.html_document).not.toContain('<!--CUSTOMER_SIGNATURE-->');
    expect(ev?.final_html_sha256).toBe(await sha256Hex(contract!.html_document as string));
    expect(ev?.signature_image_sha256).toBe(await sha256Hex(SIG));

    // 약관 스냅샷 = 서명 당시 rental_policy_settings. 세 항목이 모두 비어 있으면(예: Stage) 빈 문자열 해시가 아니라 NULL("약관 없음")로 기록한다.
    const { data: policy } = await admin.from('rental_policy_settings').select('terms_text, refund_text, privacy_text').limit(1).maybeSingle();
    const allEmpty = [policy?.terms_text, policy?.refund_text, policy?.privacy_text].every((t) => !((t as string | null) ?? '').trim());
    if (allEmpty) {
      expect(ev?.terms_text).toBeNull();
      expect(ev?.terms_sha256).toBeNull();
      expect(ev?.refund_sha256).toBeNull();
      expect(ev?.privacy_sha256).toBeNull();
      const termsCopy = (ev?.consent_log as { key: string; text_sha256: string | null }[]).find((c) => c.key === 'terms_copy');
      expect(termsCopy?.text_sha256).toBeNull();
    } else {
      expect(ev?.terms_text).toBe((policy?.terms_text as string | null) ?? '');
      expect(ev?.refund_text).toBe((policy?.refund_text as string | null) ?? '');
      expect(ev?.privacy_text).toBe((policy?.privacy_text as string | null) ?? '');
      expect(ev?.terms_sha256).toBe(await sha256Hex((policy?.terms_text as string | null) ?? ''));
    }

    // 감사로그
    const { data: audit } = await admin.from('contract_audit_log').select('event_type').eq('contract_id', f.contractId);
    const types = (audit ?? []).map((a) => a.event_type);
    expect(types).toEqual(expect.arrayContaining(['signed', 'consented', 'evidence_saved']));
  }, 90_000);

  it('GREEN: 저장된 증적 행은 수정·삭제할 수 없다(추가 전용)', async () => {
    const f = await createFixture();
    await callSign(f.token, { signature_data: SIG, stroke_count: 2, consents: ALL_CONSENTS });
    const { data: ev } = await admin.from('contract_signature_evidence').select('id').eq('signing_id', f.signingId).single();
    expect(ev?.id).toBeTruthy();

    const upd = await admin.from('contract_signature_evidence').update({ ip_address: '9.9.9.9' }).eq('id', ev!.id);
    expect(upd.error).not.toBeNull();
    const del = await admin.from('contract_signature_evidence').delete().eq('id', ev!.id);
    expect(del.error).not.toBeNull();

    const { data: still } = await admin.from('contract_signature_evidence').select('ip_address').eq('id', ev!.id).single();
    expect(still?.ip_address).toBe('203.0.113.7');
  }, 90_000);
});
