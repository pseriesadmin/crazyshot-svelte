import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * 리뷰 작성(review) 포인트 자동적립 TDD 통합테스트 — Migration #596
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/misty-scribbling-wand.md §1
 *
 * 정책(Stephen 확정, 2026-09-30):
 *   ① 실제로 그 상품을 대여해 반납/완료까지 한 이력이 있는 고객만 적립 대상
 *   ② 같은 상품에 대해 사용자당 최초 1회만 지급
 *   ③ 기간 제한(14일 등) 없음 — 이력만 있으면 언제든 최초 1회 적립
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral 행을 만드는 라이브
 * 통합테스트다(accountWithdrawal.test.ts의 createEphemeralSession 패턴 동일 적용).
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn().catch(() => undefined);
  }
});

// ── 픽스처 헬퍼 ────────────────────────────────────────────────────────────────

async function createEphemeralSession(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  const email = `tdd-review-pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`);

  return { client: asUser, userId };
}

/** 활성 자식(재고) 상품 1개와 그 부모 id를 함께 반환 */
async function pickChildAndParent(): Promise<{ childId: string; parentId: string }> {
  const { data, error } = await admin
    .from('products')
    .select('id, parent_product_id')
    .not('parent_product_id', 'is', null)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error || !data) throw new Error(`테스트용 자식 상품 조회 실패: ${error?.message}`);
  return { childId: data.id as string, parentId: data.parent_product_id as string };
}

async function createReservation(userId: string, childProductId: string, status: string): Promise<number> {
  const dayOffset = Math.floor(Math.random() * 3650) + 365;
  const start = new Date(Date.UTC(2027, 0, 1) + dayOffset * 86400000);
  const end = new Date(start.getTime() + 2 * 86400000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: childProductId,
      start_date: fmt(start),
      end_date: fmt(end),
      status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`);
  const id = data.id as number;
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', id); });
  return id;
}

async function getRule(): Promise<{ amount: number; is_active: boolean }> {
  const { data, error } = await admin
    .from('point_earn_rules')
    .select('amount, is_active')
    .eq('event_type', 'review')
    .single();
  if (error || !data) throw new Error(`review 규칙 조회 실패: ${error?.message}`);
  return data as { amount: number; is_active: boolean };
}

async function setRuleActive(isActive: boolean): Promise<void> {
  await admin.from('point_earn_rules').update({ is_active: isActive }).eq('event_type', 'review');
}

async function getPoints(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('points')
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error(`user_profiles 조회 실패: ${error?.message}`);
  return data.points as number;
}

async function countReviewTx(userId: string, productId: string): Promise<number> {
  const { count, error } = await admin
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('ref_type', 'review')
    .eq('ref_id', productId);
  if (error) throw new Error(`point_transactions 조회 실패: ${error.message}`);
  return count ?? 0;
}

async function submitReview(client: SupabaseClient, productId: string, title: string) {
  return (client.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: string | null; error: { message: string } | null }>)('create_product_review', {
    p_product_id: productId,
    p_title: title,
    p_content: '테스트 리뷰 내용',
  });
}

// ── 테스트 스위트 ───────────────────────────────────────────────────────────────

describe('[TDD] create_product_review 리뷰 작성 적립 — Migration #596', () => {
  it('① 대여 이력(returned)이 있는 고객이 리뷰를 쓰면 적립된다', async () => {
    const rule = await getRule();
    if (!rule.is_active || rule.amount <= 0) {
      // 규칙이 비활성이면 이 테스트만 일시로 켜서 검증 후 원복
      await setRuleActive(true);
      cleanups.push(async () => { await setRuleActive(rule.is_active); });
    }

    const { client, userId } = await createEphemeralSession();
    const { childId, parentId } = await pickChildAndParent();
    await createReservation(userId, childId, 'returned');

    const before = await getPoints(userId);
    const { data: reviewId, error } = await submitReview(client, parentId, '적립 테스트');
    expect(error).toBeNull();
    expect(reviewId).toBeTruthy();
    if (reviewId) {
      cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', reviewId); });
    }

    const after = await getPoints(userId);
    const usedRule = await getRule();
    expect(after - before).toBe(usedRule.amount);
    expect(await countReviewTx(userId, parentId)).toBe(1);
  });

  it('② 대여 이력이 없는 고객이 리뷰를 쓰면 적립되지 않는다(리뷰 자체는 정상 등록)', async () => {
    const { client, userId } = await createEphemeralSession();
    const { parentId } = await pickChildAndParent();

    const before = await getPoints(userId);
    const { data: reviewId, error } = await submitReview(client, parentId, '이력없음 테스트');
    expect(error).toBeNull();
    expect(reviewId).toBeTruthy(); // 리뷰 작성 자체는 여전히 허용됨(스코프 밖)
    if (reviewId) {
      cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', reviewId); });
    }

    const after = await getPoints(userId);
    expect(after).toBe(before);
    expect(await countReviewTx(userId, parentId)).toBe(0);
  });

  it('③ 같은 상품에 두 번째 리뷰를 써도 추가 적립되지 않는다(상품당 최초 1회)', async () => {
    const { client, userId } = await createEphemeralSession();
    const { childId, parentId } = await pickChildAndParent();
    await createReservation(userId, childId, 'returned');

    const { data: firstId } = await submitReview(client, parentId, '첫 리뷰');
    if (firstId) cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', firstId); });

    const afterFirst = await getPoints(userId);
    const { data: secondId, error } = await submitReview(client, parentId, '두번째 리뷰');
    expect(error).toBeNull();
    if (secondId) cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', secondId); });

    const afterSecond = await getPoints(userId);
    expect(afterSecond).toBe(afterFirst); // 추가 지급 없음
    expect(await countReviewTx(userId, parentId)).toBe(1);
  });

  it('④ review 규칙이 비활성이면 이력이 있어도 적립되지 않는다', async () => {
    const original = await getRule();
    await setRuleActive(false);
    cleanups.push(async () => { await setRuleActive(original.is_active); });

    const { client, userId } = await createEphemeralSession();
    const { childId, parentId } = await pickChildAndParent();
    await createReservation(userId, childId, 'completed');

    const before = await getPoints(userId);
    const { data: reviewId, error } = await submitReview(client, parentId, '비활성 규칙 테스트');
    expect(error).toBeNull();
    if (reviewId) cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', reviewId); });

    const after = await getPoints(userId);
    expect(after).toBe(before);
  });
});
