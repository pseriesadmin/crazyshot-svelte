import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * 추천인/피추천인(referrer/referee) 적립 규칙 "준비중" 고정 TDD 통합테스트 — Migration #599
 * Harness Flow v3.2 — RED → GREEN
 *
 * plan_source: /Users/stevenmac/.claude/plans/misty-scribbling-wand.md §4
 *
 * 정책: 추천 시스템(추천코드 발급·추적) 자체가 없어 referrer/referee는 CMS 화면 조작이든
 * API 직접 호출이든 절대 활성화될 수 없어야 한다(update_point_earn_rule RPC 레벨 강제).
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 실제 ephemeral CMS 세션을 만드는 라이브
 * 통합테스트다 — ephemeral auth 사용자를 만든 뒤 user_profiles.cms_role을 manager로
 * 설정해 is_cms_user() 게이트를 통과하는 실제 세션으로 RPC를 호출한다.
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

async function createEphemeralCmsSession(): Promise<SupabaseClient> {
  const email = `tdd-refguard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test1234!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`);
  const userId = data.user.id;
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined); });

  const { error: roleErr } = await admin
    .from('user_profiles')
    .update({ cms_role: 'manager' })
    .eq('user_id', userId);
  if (roleErr) throw new Error(`cms_role 설정 실패: ${roleErr.message}`);

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`);

  return asUser;
}

async function getIsActive(eventType: string): Promise<boolean> {
  const { data, error } = await admin
    .from('point_earn_rules')
    .select('is_active')
    .eq('event_type', eventType)
    .single();
  if (error || !data) throw new Error(`규칙 조회 실패: ${error?.message}`);
  return data.is_active as boolean;
}

async function updateRule(client: SupabaseClient, eventType: string, isActive: boolean) {
  return (client.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: { ok: boolean } | null; error: { message: string } | null }>)(
    'update_point_earn_rule',
    { p_event_type: eventType, p_amount: null, p_rate: null, p_is_active: isActive, p_grade_multipliers: null },
  );
}

describe('[TDD] update_point_earn_rule referrer/referee 준비중 고정 — Migration #599', () => {
  it('① referrer를 is_active=true로 요청해도 실제로는 false로 저장된다', async () => {
    const client = await createEphemeralCmsSession();
    const { data, error } = await updateRule(client, 'referrer', true);
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(await getIsActive('referrer')).toBe(false);
  });

  it('② referee를 is_active=true로 요청해도 실제로는 false로 저장된다', async () => {
    const client = await createEphemeralCmsSession();
    const { data, error } = await updateRule(client, 'referee', true);
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(await getIsActive('referee')).toBe(false);
  });

  it('③ 다른 이벤트(rental_complete)는 이 가드의 영향을 받지 않고 정상적으로 토글된다', async () => {
    const original = await getIsActive('rental_complete');
    cleanups.push(async () => {
      await admin.from('point_earn_rules').update({ is_active: original }).eq('event_type', 'rental_complete');
    });

    const client = await createEphemeralCmsSession();
    const target = !original;
    const { data, error } = await updateRule(client, 'rental_complete', target);
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
    expect(await getIsActive('rental_complete')).toBe(target);
  });
});
