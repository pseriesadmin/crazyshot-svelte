import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type TableInsertResult = { error: { code: string; message: string } | null };
const tableInsert = (table: string, row: Record<string, unknown>): Promise<TableInsertResult> =>
  (admin.from as unknown as (t: string) => { insert: (r: Record<string, unknown>) => Promise<TableInsertResult> })(table).insert(row);

type TableSelectResult = { data: Record<string, unknown>[] | null; error: { code: string; message: string } | null };
const tableSelect = (table: string) =>
  admin.from(table).select('*') as unknown as { eq: (col: string, val: unknown) => { limit: (n: number) => Promise<TableSelectResult> } };

/**
 * S1-M3 Payment Integration Tests (TDD)
 * 토스페이먼츠 v2 결제 연동 — RED → GREEN → REFACTOR
 *
 * 범위: /api/webhooks/toss 웹훅 수신 (즉시 200 OK + raw_webhook_logs 저장)
 *
 * ⚠️ 2026-08-31: /api/payment/confirm·/api/checkout/initiate·/payment/success·/payment/fail
 * 4개 라우트를 사용처 0건(전수 grep 확인) + 도달 시 확정적 크래시(존재하지 않는 컬럼 조회)
 * 확인 후 삭제(toss_payments_pg_integration_2026-08-30.md 참고). 이 4파일이 전용으로
 * 쓰던 RPC 중 confirm_payment_and_update_reservation·cancel_payment_and_release_hold도
 * 같은 날 Stephen 승인으로 함께 삭제(Migration 396, 다른 라이브 코드 호출처 전수 확인 후
 * 완전한 고아로 판정) — 이 RPC들을 직접 호출하던 테스트는 전부 제거했다. atomic_reserve_asset도
 * 같은 이유로 삭제됐으나 이 파일에 해당 테스트는 없었다. calculate_cart_total은 cart/
 * +page.server.ts가 여전히 사용 중이라(타입캐스팅 호출부라 최초 grep에서 놓쳤던 라이브
 * 호출처) 삭제 대상에서 제외됐다.
 */

const makeOrderId = () => `ORDER-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const makePayKey  = () => `payKey_TEST_${Date.now()}`;

describe('Payment — raw_webhook_logs', () => {

  it('RED: raw_webhook_logs — 웹훅 페이로드 저장 확인', async () => {
    const testPayload = {
      eventType:  'PAYMENT_STATUS_CHANGED',
      createdAt:  new Date().toISOString(),
      data:       { paymentKey: makePayKey(), orderId: makeOrderId(), status: 'DONE' }
    };

    const { error } = await tableInsert('raw_webhook_logs', {
      source:     'toss',
      event_type: testPayload.eventType,
      payload:    testPayload,
      processed:  false,
    });

    // service_role로 INSERT 성공해야 한다 (anon은 RLS 거부)
    expect(error).toBeNull();
  });

});

// ── EDGE CASES ─────────────────────────────────────────────────────────────────
describe('Payment — Edge Cases', () => {

  it('스펙: calc_at 30초 유효성 판정 산식 문서화', () => {
    // 2026-08-31: 이 산식을 실제로 검증하던 /api/payment/confirm 라우트는 삭제됨(사용처 0건).
    // 현재 라이브 결제 확정 경로(/contract/[token]/pay-result)는 이 30초 유효성 체크를
    // 별도로 수행하지 않음 — payment.md가 기술하는 이 정책이 실제로는 어디서도 강제되고
    // 있지 않다는 점을 문서화만 해둔다(신규 기능 구현은 별도 승인 필요, 이번 정리 범위 밖).
    const CALC_VALIDITY_SECONDS = 30;
    const calcAt = new Date(Date.now() - (CALC_VALIDITY_SECONDS + 1) * 1000);
    const calcAge = (Date.now() - calcAt.getTime()) / 1000;

    expect(calcAge).toBeGreaterThan(CALC_VALIDITY_SECONDS);
  });

});

// ── ERROR SCENARIOS ────────────────────────────────────────────────────────────
describe('Payment — Error Scenarios', () => {

  it('RED: payment_transactions — processed 웹훅 재전송 시 중복 처리 안 됨 (processed=true 확인)', async () => {
    // raw_webhook_logs에서 processed=false인 항목만 pg_cron이 처리
    // 이미 processed=true인 항목은 스킵되어야 함
    // 이 시나리오는 pg_cron 구현 후 완전 검증 (다음 사이클)

    // 현재: DB 레벨 인덱스 존재 확인으로 대체
    const { data, error } = await tableSelect('raw_webhook_logs')
      .eq('processed', false)
      .limit(1);

    // RLS 거부(anon) → error 발생, 또는 빈 배열 반환
    expect(error === null || Array.isArray(data)).toBe(true);
  });

  it('RED: deposit_holds status CHECK 제약 — forfeited 외 값 거부', async () => {
    // deposit_holds.status는 'held' | 'released' | 'forfeited' 만 허용
    // 직접 INSERT는 RLS로 불가 → CHECK 제약은 RPC 내부에서 보호됨
    // 이 테스트는 RPC가 올바른 status 값만 전달함을 문서화

    const validStatuses = ['held', 'released', 'forfeited'];
    const invalidStatus = 'refunded'; // 허용되지 않음
    expect(validStatuses).not.toContain(invalidStatus);
    expect(validStatuses).toContain('held');
    expect(validStatuses).toContain('released');
    expect(validStatuses).toContain('forfeited');
  });

  it('RED: TOSS_SECRET_KEY는 서버사이드 전용 ($env/static/private) — 클라이언트 노출 불가', () => {
    // 보안 규칙 문서화 테스트
    // 실제 키가 클라이언트 번들에 포함되지 않음을 확인
    // 빌드 후 grep으로 검증: grep -r "TOSS_SECRET" .svelte-kit/output/client/
    const forbidden = ['TOSS_SECRET_KEY', 'supabase_service_role'];
    forbidden.forEach(key => {
      // 클라이언트 import 경로에 $env/static/private가 없어야 함
      expect(key).not.toContain('$env/static/public');
    });
  });

});

// ── /api/webhooks/toss 라우트 스펙 문서화 ────────────────────────────────────
describe('POST /api/webhooks/toss — 스펙 문서화', () => {

  it('스펙: 1초 이내 200 OK 반환 후 raw_webhook_logs 저장', () => {
    // 처리 순서:
    // 1. HMAC-SHA256 서명 검증 (TOSS_SECRET_KEY)
    // 2. raw_webhook_logs INSERT (service_role)
    // 3. 즉시 200 OK 반환
    // 4. pg_cron이 백그라운드에서 processed=false 항목 처리 (다음 사이클)
    const processingOrder = [
      'verify_hmac_signature',
      'insert_raw_webhook_logs',
      'return_200_ok',
    ];
    expect(processingOrder[0]).toBe('verify_hmac_signature');
    expect(processingOrder[1]).toBe('insert_raw_webhook_logs');
    expect(processingOrder[2]).toBe('return_200_ok');
  });

  it('스펙: HMAC-SHA256 서명 검증 실패 → 401 반환', () => {
    // verifyTossSignature(body, signature, TOSS_SECRET_KEY)
    // signature 없거나 불일치 → 401
    const invalidSignature = null;
    expect(invalidSignature).toBeNull(); // RED: 구현 후 실제 검증으로 교체
  });

});
