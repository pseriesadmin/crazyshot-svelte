import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * 세그먼트 RPC CMS 가드 TDD 통합테스트 — Migration #614
 *
 * 정책: get_segment_stats / get_segment_users는 회원 연락처·집계를 반환하므로 CMS 직원(is_cms_user)만 호출 가능해야 한다.
 *  - 익명 키(로그인 없음): 실행 권한 자체가 없어 거절
 *  - 일반 로그인 사용자(cms_role 없음): 본문 가드로 거절 (42501)
 *  - CMS 직원: 정상 응답
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw)에 ephemeral 사용자를 만드는 라이브 통합테스트.
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

async function createSession(cmsRole: string | null): Promise<SupabaseClient> {
  const email = `tdd-seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

  if (cmsRole) {
    const { error: roleErr } = await admin.from('user_profiles').update({ cms_role: cmsRole }).eq('user_id', userId);
    if (roleErr) throw new Error(`cms_role 설정 실패: ${roleErr.message}`);
  }

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`);
  return asUser;
}

type RpcFn = (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpcOf = (c: SupabaseClient): RpcFn => c.rpc.bind(c) as unknown as RpcFn;

describe('세그먼트 RPC CMS 가드 (#614)', () => {
  it('익명 키 호출은 get_segment_users·get_segment_stats 모두 거절된다', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
    const users = await rpcOf(anon)('get_segment_users', { p_segment: 'vip', p_limit: 1, p_offset: 0 });
    const stats = await rpcOf(anon)('get_segment_stats');
    expect(users.error).not.toBeNull();
    expect(stats.error).not.toBeNull();
  });

  it('cms_role 없는 일반 로그인 사용자는 두 RPC 모두 거절된다 (연락처 노출 차단)', async () => {
    const customer = await createSession(null);
    const users = await rpcOf(customer)('get_segment_users', { p_segment: 'vip', p_limit: 1, p_offset: 0 });
    const stats = await rpcOf(customer)('get_segment_stats');
    expect(users.error).not.toBeNull();
    expect(users.data).toBeNull();
    expect(stats.error).not.toBeNull();
    expect(stats.data).toBeNull();
  });

  it('CMS 직원(manager)은 두 RPC를 정상 호출한다 (회귀 없음)', async () => {
    const cms = await createSession('manager');
    const users = await rpcOf(cms)('get_segment_users', { p_segment: 'vip', p_limit: 1, p_offset: 0 });
    const stats = await rpcOf(cms)('get_segment_stats');
    expect(users.error).toBeNull();
    expect(Array.isArray(users.data)).toBe(true);
    expect(stats.error).toBeNull();
    expect(stats.data).not.toBeNull();
  });
});
