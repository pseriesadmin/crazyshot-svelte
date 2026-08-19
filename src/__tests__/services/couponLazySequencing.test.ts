import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

/**
 * B-8: 쿠폰 지연채번(Lazy Sequencing) TDD 통합 테스트
 * Harness Flow v3.2 — RED → GREEN
 *
 * 배경: Migration 291/292/293 — 쿠폰 코드를 생성·배포 시가 아닌 고객이 결제하는
 * 시점(use_coupon)에 원자적으로 채번하는 Lazy Sequencing 아키텍처.
 * products.md §2-1~§2-3의 지연채번 원칙과 동일 설계.
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다 (holdExpiration.test.ts / contractSigningGate.test.ts와 동일 패턴).
 *
 * 검증 항목:
 *   1. B-4 회귀: user_coupons INSERT 시 issued_at 없이 성공 (버그 수정 확인)
 *   2. sequenced 모드: generate_user_coupon_redeemed_code가 redeemed_code를 채번함
 *   3. 멱등성: 동일 user_coupon에 2회 호출해도 같은 redeemed_code 반환
 *   4. manual 모드 무작동: code_mode='manual' 쿠폰은 채번 없이 NULL 반환
 *   5. max_sequence 상한: 한도 초과 시 COUPON_SEQ_EXCEEDED 예외 발생
 *   6. use_coupon 통합(sequenced): use_coupon 호출 시 redeemed_code 자동 채번됨
 *   7. use_coupon 회귀(manual): manual 쿠폰 use_coupon 후 redeemed_code = NULL 유지
 *   8. ALREADY_USED 정책: 2회 use_coupon → ALREADY_USED 반환 (회귀 검증)
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// RPC 타입 헬퍼 — database.ts 자동생성 타입이 신규 RPC를 아직 모르므로 우회
type RpcResult<T = Record<string, unknown>> = {
  data: T | null;
  error: { code: string; message: string; details?: string } | null;
};
const rpcCall = <T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult<T>> =>
  (admin.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<RpcResult<T>>)(fn, args);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

// 테스트 실행마다 unique category code → coupon_code_sequences 충돌 방지
const TEST_CATEGORY = `TDC${Date.now().toString(36).toUpperCase().slice(-6)}`;
const TEST_PREFIX = 'Z';

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

afterAll(async () => {
  // coupon_code_sequences 테스트 데이터 정리 — TEST_CATEGORY와 max_sequence 테스트가 쓰는
  // 격리된 파생 카테고리(`${TEST_CATEGORY}M`)를 모두 포함해 prefix로 일괄 삭제
  await (admin.from('coupon_code_sequences' as never) as unknown as {
    delete: () => { like: (col: string, pattern: string) => Promise<{ error: unknown }> }
  }).delete().like('category_code', `${TEST_CATEGORY}%`);
});

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-cpn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

// sequenced 모드 쿠폰 생성 (admin 클라이언트로 직접 insert — is_cms_user() 우회)
// categoryCode 미지정 시 파일 공용 TEST_CATEGORY 사용 — coupon_code_sequences 카운터를
// 여러 테스트가 공유(모듈 레벨 상수라 파일 내 전체 테스트가 같은 시퀀스를 누적 소비함).
// max_sequence 상한 테스트처럼 "이 호출이 정확히 seq=1이어야 한다"를 전제하는 테스트는
// 반드시 categoryCode를 별도로 넘겨 독립된 시퀀스 카운터를 써야 한다 — 그렇지 않으면
// 앞선 describe 블록들이 이미 소비한 순번 때문에 첫 호출부터 상한을 초과해버린다.
async function createSequencedCoupon(opts?: { maxSeq?: number; categoryCode?: string }): Promise<string> {
  const codeSeries = {
    category_code: opts?.categoryCode ?? TEST_CATEGORY,
    prefix: TEST_PREFIX,
    date_option: 'none',
    seq_digits: 4,
    max_sequence: opts?.maxSeq ?? null,
  };
  const farFuture = '2099-12-31T00:00:00.000Z';
  const pastDate  = '2020-01-01T00:00:00.000Z';
  const { data, error } = await (admin.from('coupons' as never) as unknown as {
    insert: (r: Record<string, unknown>) => {
      select: (s: string) => { single: () => Promise<RpcResult<{ id: string }>> }
    }
  }).insert({
    code:            null,
    code_mode:       'sequenced',
    code_series:     codeSeries,
    type:            'all',
    discount_type:   'percentage',
    discount_value:  10,
    min_purchase_amount: 0,
    is_active:       true,
    usage_count:     0,
    usage_limit:     999,
    valid_from:      pastDate,
    valid_until:     farFuture,
  }).select('id').single();

  if (error || !data) throw new Error(`sequenced coupon 생성 실패: ${error?.message}`);
  return data.id;
}

// manual 모드 쿠폰 생성
async function createManualCoupon(): Promise<string> {
  const farFuture = '2099-12-31T00:00:00.000Z';
  const pastDate  = '2020-01-01T00:00:00.000Z';
  const { data, error } = await (admin.from('coupons' as never) as unknown as {
    insert: (r: Record<string, unknown>) => {
      select: (s: string) => { single: () => Promise<RpcResult<{ id: string }>> }
    }
  }).insert({
    code:            `MANUAL${Date.now()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    code_mode:       'manual',
    type:            'all',
    discount_type:   'percentage',
    discount_value:  5,
    min_purchase_amount: 0,
    is_active:       true,
    usage_count:     0,
    usage_limit:     999,
    valid_from:      pastDate,
    valid_until:     farFuture,
  }).select('id').single();

  if (error || !data) throw new Error(`manual coupon 생성 실패: ${error?.message}`);
  return data.id;
}

// user_coupon 직접 생성 (distribute_coupon 우회 — is_cms_user() 요구함)
async function createUserCoupon(userId: string, couponId: string): Promise<string> {
  const { data, error } = await (admin.from('user_coupons' as never) as unknown as {
    insert: (r: Record<string, unknown>) => {
      select: (s: string) => { single: () => Promise<RpcResult<{ id: string }>> }
    }
  }).insert({ user_id: userId, coupon_id: couponId }).select('id').single();

  if (error || !data) throw new Error(`user_coupon 생성 실패: ${error?.message}`);
  return data.id;
}

// user_coupon 상태 조회
async function getUserCouponState(id: string): Promise<{
  redeemed_code: string | null;
  used_at: string | null;
  order_id: number | null;
}> {
  const { data, error } = await (admin.from('user_coupons' as never) as unknown as {
    select: (s: string) => {
      eq: (col: string, val: unknown) => {
        single: () => Promise<RpcResult<{ redeemed_code: string | null; used_at: string | null; order_id: number | null }>>
      }
    }
  }).select('redeemed_code, used_at, order_id').eq('id', id).single();

  if (error || !data) throw new Error(`user_coupon 조회 실패: ${error?.message}`);
  return data;
}

// B-후속(주문 연결, migration 297): 테스트용 최소 orders 행 생성 — user_coupons.order_id FK 충족용
async function createTestOrder(userId: string): Promise<number> {
  const orderKey = `TDD-ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await (admin.from('orders' as never) as unknown as {
    insert: (r: Record<string, unknown>) => {
      select: (s: string) => { single: () => Promise<RpcResult<{ id: number }>> }
    }
  }).insert({
    order_key: orderKey,
    user_id: userId,
    total_amount: 0,
    discount_amount: 0,
    tax_amount: 0,
    final_amount: 0,
    status: 'pending',
  }).select('id').single();

  if (error || !data) throw new Error(`테스트 order 생성 실패: ${error?.message}`);
  return data.id;
}

async function deleteTestOrder(id: number): Promise<void> {
  await (admin.from('orders' as never) as unknown as {
    delete: () => { eq: (col: string, val: unknown) => Promise<{ error: unknown }> }
  }).delete().eq('id', id);
}

// 쿠폰 소프트삭제 (cleanup용)
async function softDeleteCoupon(id: string): Promise<void> {
  await (admin.from('coupons' as never) as unknown as {
    update: (r: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{ error: unknown }>
    }
  }).update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
}

// user_coupon 삭제 (cleanup용)
async function deleteUserCoupon(id: string): Promise<void> {
  await (admin.from('user_coupons' as never) as unknown as {
    delete: () => { eq: (col: string, val: unknown) => Promise<{ error: unknown }> }
  }).delete().eq('id', id);
}

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('B-4 회귀: distribute_coupon issued_at 버그 수정', () => {
  it('user_coupons INSERT에 issued_at 없이 성공해야 한다 (created_at이 자동 설정됨)', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    // user_coupons에 issued_at 컬럼이 없으므로 (user_id, coupon_id)만으로 INSERT 성공해야 함
    // 원래 distribute_coupon 버그: INSERT INTO user_coupons (user_id, coupon_id, issued_at) —
    // issued_at 컬럼 자체가 존재하지 않아 오류 발생. 수정 후: (user_id, coupon_id)만 사용.
    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    // created_at이 자동으로 설정됐는지 확인
    const { data } = await (admin.from('user_coupons' as never) as unknown as {
      select: (s: string) => {
        eq: (col: string, val: unknown) => {
          single: () => Promise<RpcResult<{ created_at: string; used_at: string | null }>>
        }
      }
    }).select('created_at, used_at').eq('id', ucId).single();

    expect(data).toBeTruthy();
    expect(data!.created_at).toBeTruthy();  // DEFAULT NOW() 자동 설정
    expect(data!.used_at).toBeNull();       // 아직 사용 전
  });
});

describe('generate_user_coupon_redeemed_code — sequenced 모드 채번', () => {
  it('sequenced 모드 user_coupon에 redeemed_code를 채번해야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data, error } = await rpcCall<string>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(typeof data).toBe('string');

    // 코드 형식: prefix(Z) + category_code(TDCXXXXXX) + date_part('') + seq(0001)
    expect(data).toMatch(new RegExp(`^${TEST_PREFIX}${TEST_CATEGORY}\\d{4}$`));

    // DB에도 실제로 기록됐는지 확인
    const state = await getUserCouponState(ucId);
    expect(state.redeemed_code).toBe(data);
  });

  it('멱등성: 동일 user_coupon에 2회 호출해도 같은 redeemed_code를 반환해야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data: code1 } = await rpcCall<string>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId,
    });
    const { data: code2 } = await rpcCall<string>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId,
    });

    expect(code1).toBeTruthy();
    expect(code2).toBeTruthy();
    // 두 번 호출해도 순번이 추가로 소비되지 않아야 함
    expect(code1).toBe(code2);
  });

  it('동시 호출 시 중복 redeemed_code가 생성되지 않아야 한다 (원자성)', async () => {
    // 서로 다른 user_coupon 2개를 동시에 채번 → 각각 다른 코드를 받아야 함
    const userId1  = await createEphemeralUser();
    const userId2  = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId1));
    cleanups.push(async () => deleteEphemeralUser(userId2));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId1 = await createUserCoupon(userId1, couponId);
    const ucId2 = await createUserCoupon(userId2, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId1));
    cleanups.push(async () => deleteUserCoupon(ucId2));

    // 동시 호출
    const [r1, r2] = await Promise.all([
      rpcCall<string>('generate_user_coupon_redeemed_code', { p_user_coupon_id: ucId1 }),
      rpcCall<string>('generate_user_coupon_redeemed_code', { p_user_coupon_id: ucId2 }),
    ]);

    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r1.data).toBeTruthy();
    expect(r2.data).toBeTruthy();
    // 두 코드가 달라야 함 (원자적 순번 보장)
    expect(r1.data).not.toBe(r2.data);
  });
});

describe('generate_user_coupon_redeemed_code — manual 모드 무작동', () => {
  it('manual 모드 쿠폰 user_coupon에서는 NULL을 반환하고 redeemed_code가 설정되지 않아야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data, error } = await rpcCall<string | null>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();  // manual 모드: 조용히 NULL 반환

    // DB에도 redeemed_code가 NULL로 유지돼야 함
    const state = await getUserCouponState(ucId);
    expect(state.redeemed_code).toBeNull();
  });
});

describe('generate_user_coupon_redeemed_code — max_sequence 상한 체크', () => {
  it('max_sequence=1 쿠폰에서 두 번째 채번 시도는 COUPON_SEQ_EXCEEDED 에러가 발생해야 한다', async () => {
    const userId1  = await createEphemeralUser();
    const userId2  = await createEphemeralUser();
    // 이 테스트는 "첫 호출이 정확히 seq=1"이어야 성립하므로, 앞선 describe 블록들이
    // 이미 소비한 파일 공용 TEST_CATEGORY 카운터를 쓰면 안 됨 — 독립된 카테고리 코드 사용
    const isolatedCategory = `${TEST_CATEGORY}M`;
    // max_sequence=1 — 첫 번째만 성공, 두 번째는 실패
    const couponId = await createSequencedCoupon({ maxSeq: 1, categoryCode: isolatedCategory });
    cleanups.push(async () => deleteEphemeralUser(userId1));
    cleanups.push(async () => deleteEphemeralUser(userId2));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId1 = await createUserCoupon(userId1, couponId);
    const ucId2 = await createUserCoupon(userId2, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId1));
    cleanups.push(async () => deleteUserCoupon(ucId2));

    // 첫 번째: 성공
    const { data: code1, error: err1 } = await rpcCall<string>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId1,
    });
    expect(err1).toBeNull();
    expect(code1).toBeTruthy();

    // 두 번째: COUPON_SEQ_EXCEEDED
    const { data: code2, error: err2 } = await rpcCall<string>('generate_user_coupon_redeemed_code', {
      p_user_coupon_id: ucId2,
    });
    expect(code2).toBeNull();
    expect(err2).toBeTruthy();
    expect(err2!.message).toContain('COUPON_SEQ_EXCEEDED');

    // 두 번째 실패 후 redeemed_code가 NULL로 유지돼야 함
    const state2 = await getUserCouponState(ucId2);
    expect(state2.redeemed_code).toBeNull();
  });
});

describe('use_coupon 통합 검증 — sequenced 모드', () => {
  it('sequenced 쿠폰 use_coupon 호출 시 redeemed_code가 자동 채번되고 used_at이 설정돼야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data, error } = await rpcCall<{ ok: boolean; error?: string; redeemed_code?: string | null }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect((data as { ok: boolean }).ok).toBe(true);

    // redeemed_code가 자동 채번됐는지 확인
    const state = await getUserCouponState(ucId);
    expect(state.redeemed_code).toBeTruthy();
    expect(state.redeemed_code).toMatch(new RegExp(`^${TEST_PREFIX}${TEST_CATEGORY}\\d{4}$`));
    expect(state.used_at).toBeTruthy();

    // B-8 후속(고객 노출 경로, migration 296): use_coupon 응답 JSON 자체에도
    // redeemed_code가 실려 있어야 confirm-mock → 결제완료 화면 전달이 가능함
    expect((data as { redeemed_code?: string | null }).redeemed_code).toBe(state.redeemed_code);
  });
});

describe('use_coupon 회귀 검증 — manual 모드', () => {
  it('manual 쿠폰 use_coupon 호출 후 redeemed_code는 NULL로 유지되어야 한다 (기존 동작 보존)', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data, error } = await rpcCall<{ ok: boolean; redeemed_code?: string | null }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });

    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
    // manual 모드는 응답 JSON의 redeemed_code도 null(migration 296 추가 필드) — 기존
    // 클라이언트 응답 구조에 새 키가 하나 추가된 것 외 동작 변화 없음
    expect((data as { redeemed_code?: string | null }).redeemed_code).toBeNull();

    // manual 모드 → redeemed_code는 NULL 유지 (기존 동작 회귀 없음)
    const state = await getUserCouponState(ucId);
    expect(state.redeemed_code).toBeNull();
    expect(state.used_at).toBeTruthy();  // used_at은 정상 설정
  });

  it('ALREADY_USED: 동일 user_coupon에 use_coupon을 2회 호출하면 두 번째는 ALREADY_USED를 반환해야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    // 첫 번째 사용: 성공
    const { data: r1, error: e1 } = await rpcCall<{ ok: boolean; error?: string }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });
    expect(e1).toBeNull();
    expect((r1 as { ok: boolean }).ok).toBe(true);

    // 두 번째 사용: ALREADY_USED
    const { data: r2, error: e2 } = await rpcCall<{ ok: boolean; error?: string }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });
    expect(e2).toBeNull();  // DB 에러가 아닌 앱 레벨 에러
    expect((r2 as { ok: boolean; error?: string }).ok).toBe(false);
    expect((r2 as { ok: boolean; error?: string }).error).toBe('ALREADY_USED');
  });
});

describe('use_coupon 주문 연결 — migration 297 (CMS 채번내역 랜딩 기반)', () => {
  it('p_order_id를 넘기면 user_coupons.order_id에 기록되어야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    const orderId  = await createTestOrder(userId);
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));
    cleanups.push(async () => deleteTestOrder(orderId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { data, error } = await rpcCall<{ ok: boolean }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
      p_order_id:       orderId,
    });

    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);

    const state = await getUserCouponState(ucId);
    expect(state.order_id).toBe(orderId);
  });

  it('p_order_id를 생략하면 기존과 동일하게 order_id는 NULL로 유지되어야 한다 (하위호환)', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { error } = await rpcCall<{ ok: boolean }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });
    expect(error).toBeNull();

    const state = await getUserCouponState(ucId);
    expect(state.order_id).toBeNull();
  });
});

describe('get_coupon_redemptions — CMS 사용 채번 목록 조회 RPC', () => {
  it('채번된 코드·사용일시·사용계정·user_id를 반환하고, 예약이 없는 사용자는 reservation_id가 NULL이어야 한다', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createSequencedCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { error: useErr } = await rpcCall<{ ok: boolean }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });
    expect(useErr).toBeNull();

    const { data, error } = await rpcCall<Array<{
      user_coupon_id: string;
      user_id: string;
      redeemed_code: string;
      used_at: string;
      user_name: string | null;
      user_email: string | null;
      reservation_id: number | null;
      reservation_status: string | null;
    }>>('get_coupon_redemptions', { p_coupon_id: couponId });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    const row = (data ?? []).find(r => r.user_coupon_id === ucId);
    expect(row).toBeTruthy();
    // user_id는 항상 정확히 이 사용자를 가리켜야 함(중복 쿠폰 사용에도 안정적) — migration 301
    expect(row!.user_id).toBe(userId);
    expect(row!.redeemed_code).toMatch(new RegExp(`^${TEST_PREFIX}${TEST_CATEGORY}\\d{4}$`));
    expect(row!.used_at).toBeTruthy();
    // 이 ephemeral 테스트 사용자는 rental_reservations가 전혀 없으므로 대표 예약이 없어야 함
    expect(row!.reservation_id).toBeNull();
    expect(row!.reservation_status).toBeNull();
  });

  it('manual 모드 쿠폰의 사용 이력도 포함해야 한다(migration 299 — redeemed_code IS NULL이어도 노출)', async () => {
    const userId   = await createEphemeralUser();
    const couponId = await createManualCoupon();
    cleanups.push(async () => deleteEphemeralUser(userId));
    cleanups.push(async () => softDeleteCoupon(couponId));

    const ucId = await createUserCoupon(userId, couponId);
    cleanups.push(async () => deleteUserCoupon(ucId));

    const { error: useErr } = await rpcCall<{ ok: boolean }>('use_coupon', {
      p_user_id:        userId,
      p_user_coupon_id: ucId,
    });
    expect(useErr).toBeNull();

    const { data, error } = await rpcCall<Array<{
      user_coupon_id: string;
      redeemed_code: string | null;
      used_at: string;
    }>>('get_coupon_redemptions', { p_coupon_id: couponId });

    expect(error).toBeNull();
    const row = (data ?? []).find(r => r.user_coupon_id === ucId);
    expect(row).toBeTruthy();
    expect(row!.redeemed_code).toBeNull();   // manual 모드는 채번 안 됨 — 프론트가 coupon.code로 대체 표시
    expect(row!.used_at).toBeTruthy();
  });
});
