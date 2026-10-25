import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

/**
 * Migration #760 라이브 통합테스트 (Stage DB — ezyvffjvuwmtuhpxdjrw)
 *  - 비로그인(anon)은 어떤 표에도 쓸 수 없고, 백업 표를 읽지도 못한다
 *  - 비로그인이 쓰기 계열 함수(관리자·로그인 필요)를 실행할 수 없다(권한 오류)
 *  - 비로그인 조회·확인 함수(check_email_registered 등)와 로그인 사용자의 함수 실행은 그대로 된다
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined);
});

const isPermissionError = (err: { code?: string; message?: string } | null): boolean =>
  !!err && (err.code === '42501' || /permission denied|row-level security/i.test(err.message ?? ''));

describe('#760 anon 쓰기 권한 회수', () => {
  it.each(['banners', 'products', 'rental_reservations', 'cs_posts', 'user_posts', 'product_reviews'])(
    '%s — 비로그인 INSERT 는 권한 오류',
    async (table) => {
      const { error } = await anon.from(table).insert({} as never);
      expect(isPermissionError(error), `${table}: ${error?.code} ${error?.message}`).toBe(true);
    }
  );

  it('비로그인 UPDATE·DELETE 도 권한 오류', async () => {
    const upd = await anon.from('banners').update({ updated_at: new Date().toISOString() } as never).eq('id', '00000000-0000-0000-0000-000000000000');
    expect(isPermissionError(upd.error), `${upd.error?.code} ${upd.error?.message}`).toBe(true);
    const del = await anon.from('banners').delete().eq('id', '00000000-0000-0000-0000-000000000000');
    expect(isPermissionError(del.error), `${del.error?.code} ${del.error?.message}`).toBe(true);
  });

  it('백업 표 2개는 비로그인이 읽을 수 없다', async () => {
    for (const table of ['_migration_500_backup_settings', '_migration_500_backup_theme_groups']) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(isPermissionError(error) || (data ?? []).length === 0, `${table}`).toBe(true);
      const ins = await anon.from(table).insert({} as never);
      expect(isPermissionError(ins.error), `${table} insert: ${ins.error?.code}`).toBe(true);
    }
  });
});

describe('#760 함수 실행 권한', () => {
  const UUID0 = '00000000-0000-0000-0000-000000000000';
  const calls: Array<[string, Record<string, unknown>]> = [
    ['cms_create_banner', { p_slot_key: 'x', p_title: 'x', p_sub_copy: 'x', p_image_url: 'x', p_link_url: 'x', p_device_type: 'x', p_sort_order: 1, p_valid_from: null, p_valid_until: null }],
    ['create_hold_reservation', { p_product_id: UUID0, p_start_date: '2030-01-01', p_end_date: '2030-01-02', p_pickup_method: 'visit', p_return_method: 'visit' }],
    ['update_user_profile', { p_full_name: 'x', p_email: 'x@example.com', p_birth_date: null }],
    ['submit_cs_post', { p_title: 'x', p_content: 'x', p_category: 'x' }],
    ['create_product_review', { p_product_id: UUID0, p_title: 'x', p_content: 'x' }],
    ['delete_own_post', { p_id: UUID0 }],
    ['toggle_product_wishlist', { p_product_id: UUID0 }],
    ['ensure_user_profile', {}],
  ];
  it.each(calls)('%s — 비로그인 실행은 권한 오류', async (fn, args) => {
    const { error } = await anon.rpc(fn as never, args as never);
    expect(isPermissionError(error), `${fn}: ${error?.code} ${error?.message}`).toBe(true);
  });

  it('로그인 전 조회·확인 함수는 그대로 동작한다', async () => {
    const email = await anon.rpc('check_email_registered', { p_email: 'nobody-760@example.com' } as never);
    expect(email.error).toBeNull();
    const phone = await anon.rpc('check_phone_registered', { p_phone: '01099990760' } as never);
    expect(phone.error).toBeNull();
    const search = await anon.rpc('get_products_by_ids', { p_ids: [] } as never);
    expect(isPermissionError(search.error)).toBe(false);
  });

  it('로그인 사용자는 로그인 필요 함수를 여전히 실행할 수 있다(권한 오류 아님)', async () => {
    const email = `tdd-760-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true });
    if (error || !data.user) throw new Error(`시험 계정 생성 실패: ${error?.message}`);
    cleanups.push(async () => { await admin.auth.admin.deleteUser(data.user.id); });
    const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
    const signIn = await client.auth.signInWithPassword({ email, password: 'Test1234!' });
    expect(signIn.error).toBeNull();
    const res = await client.rpc('ensure_user_profile' as never, {} as never);
    expect(isPermissionError(res.error), `${res.error?.code} ${res.error?.message}`).toBe(false);
  });
});
