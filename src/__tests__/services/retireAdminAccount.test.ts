import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
  retireAdminAccount,
  hasDbErrorMessage,
  isAuthDbDeleteError,
  retiredEmailFor,
  RETIRED_NAME,
} from '../../lib/server/retireAdminAccount';

/**
 * 관리자 계정 삭제 — 업무 이력이 있으면 계정을 지우지 않고 퇴직 처리(2026-10-23)
 *  ① 단위: 오류 문구 판별·처리 순서·실패 시 보고(스텁)
 *  ② 라이브(Stage): 이력(auto_reply_settings.updated_by)이 참조하는 계정은 실제로 deleteUser가 "Database error"로 막히고,
 *     퇴직 처리 후에는 이력 행이 그대로 남고·관리자 목록에서 빠지고·원래 이메일이 풀리고·로그인이 막히는지 확인한다.
 */

describe('isAuthDbDeleteError', () => {
  it('Supabase 인증의 DB 제약 오류만 퇴직 처리 대상으로 본다', () => {
    expect(isAuthDbDeleteError({ message: 'Database error deleting user', status: 500 })).toBe(true);
    expect(isAuthDbDeleteError({ message: 'database error' })).toBe(true);
    expect(isAuthDbDeleteError({ message: '{}', status: 500 })).toBe(true); // 문구 없는 500(실측)
    expect(isAuthDbDeleteError({ message: 'fetch failed', status: 0 })).toBe(false);
    expect(isAuthDbDeleteError({ message: 'fetch failed' })).toBe(false);
    expect(isAuthDbDeleteError({ message: 'User not found', status: 404 })).toBe(false);
    expect(isAuthDbDeleteError(null)).toBe(false);
    expect(isAuthDbDeleteError(undefined)).toBe(false);
  });
});

function makeStub(opts: { profileError?: string; authError?: string; permsThrows?: boolean; targetRole?: string | null; noTarget?: boolean; updatedRows?: number } = {}) {
  const calls: string[] = [];
  const updatePayloads: Record<string, unknown>[] = [];
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          // 0) 대상 조회
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                calls.push('lookup');
                if (opts.noTarget) return { data: null, error: null };
                return { data: { id: 'x', cms_role: opts.targetRole === undefined ? 'partner' : opts.targetRole }, error: null };
              },
            }),
          }),
          // 2) 프로필 갱신 — update().eq().not().select()
          update: (payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return {
              eq: () => ({
                not: () => ({
                  select: async () => {
                    calls.push('profile');
                    if (opts.profileError) return { data: null, error: { message: opts.profileError } };
                    const n = opts.updatedRows ?? 1;
                    return { data: Array.from({ length: n }, () => ({ id: 'x' })), error: null };
                  },
                }),
              }),
            };
          },
        };
      }
      return {
        delete: () => ({
          eq: async () => {
            calls.push('perms');
            if (opts.permsThrows) throw new Error('boom');
            return { error: null };
          },
        }),
      };
    }),
    auth: {
      admin: {
        updateUserById: vi.fn(async () => {
          calls.push('auth');
          return { error: opts.authError ? { message: opts.authError } : null };
        }),
      },
    },
  };
  return { admin: admin as never, calls, updatePayloads, updateUserById: admin.auth.admin.updateUserById };
}

describe('hasDbErrorMessage', () => {
  it('문구에 database error가 있을 때만 확정적인 DB 거절로 본다', () => {
    expect(hasDbErrorMessage({ message: 'Database error deleting user' })).toBe(true);
    expect(hasDbErrorMessage({ message: '{}' })).toBe(false);
    expect(hasDbErrorMessage(null)).toBe(false);
  });
});

describe('retireAdminAccount — 처리 순서·보고', () => {
  const UID = 'user-1';

  it('대상 확인 → 로그인 계정(차단) → 프로필(역할 제거·익명화) → 메뉴 권한 순으로 처리한다', async () => {
    const s = makeStub();
    const r = await retireAdminAccount(s.admin, UID);
    expect(r).toEqual({ ok: true });
    expect(s.calls).toEqual(['lookup', 'auth', 'profile', 'perms']);
    expect(s.updatePayloads[0]).toMatchObject({
      cms_role: null,
      full_name: RETIRED_NAME,
      email: retiredEmailFor(UID),
      phone: null,
      blacklisted: false,
    });
    expect(typeof s.updatePayloads[0].deleted_at).toBe('string');
    const authArgs = (s.updateUserById.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(authArgs).toMatchObject({ email: retiredEmailFor(UID), email_confirm: true, ban_duration: '876000h' });
    expect(String(authArgs.password).length).toBeGreaterThanOrEqual(64);
  });

  it('관리자가 아닌 계정(고객)은 아무것도 바꾸지 않고 거절한다', async () => {
    const s = makeStub({ targetRole: null });
    const r = await retireAdminAccount(s.admin, UID);
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['lookup']);
  });

  it('대상 프로필이 없으면 거절한다', async () => {
    const s = makeStub({ noTarget: true });
    expect((await retireAdminAccount(s.admin, UID)).ok).toBe(false);
    expect(s.calls).toEqual(['lookup']);
  });

  it('로그인 차단이 실패하면 프로필은 건드리지 않는다(여전히 관리자 목록에 남아 다시 삭제할 수 있다)', async () => {
    const s = makeStub({ authError: 'auth down' });
    const r = await retireAdminAccount(s.admin, UID);
    expect(r.ok).toBe(false);
    expect(s.calls).toEqual(['lookup', 'auth']);
  });

  it('프로필 갱신이 실패하거나 갱신된 행이 없으면 실패로 보고하고, 로그인은 이미 차단됐음을 안내한다', async () => {
    for (const opts of [{ profileError: 'db down' }, { updatedRows: 0 }]) {
      const s = makeStub(opts);
      const r = await retireAdminAccount(s.admin, UID);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('다시 삭제');
      expect(s.calls).toEqual(['lookup', 'auth', 'profile']);
    }
  });

  it('메뉴 권한 정리가 예외를 던져도 삭제 결과는 성공이다', async () => {
    const s = makeStub({ permsThrows: true });
    expect(await retireAdminAccount(s.admin, UID)).toEqual({ ok: true });
  });
});

describe('retireAdminAccount — 라이브(Stage): 이력이 참조하는 계정', () => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  it('deleteUser는 막히고, 퇴직 처리 후 이력은 보존·목록에서 제외·이메일 재사용 가능·로그인 차단', async () => {
    const email = `tdd-retire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Test1234!';
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr || !created.user) throw new Error(`시험 계정 생성 실패: ${createErr?.message}`);
    const userId = created.user.id;

    // 이 계정을 "관리자"로 만들고(프로필 id = 계정 id), 이력 한 줄이 이 계정을 가리키게 한다
    const { error: roleErr } = await admin.from('user_profiles').update({ cms_role: 'partner', full_name: '퇴직시험', phone: '01055550099' }).eq('id', userId);
    if (roleErr) throw new Error(`역할 설정 실패: ${roleErr.message}`);

    const { data: setting, error: settingErr } = await admin.from('auto_reply_settings').select('id, updated_by').limit(1).single();
    if (settingErr || !setting) throw new Error(`자동응답 설정 조회 실패: ${settingErr?.message}`);
    const settingId = (setting as { id: string }).id;
    const originalUpdatedBy = (setting as { updated_by: string | null }).updated_by;

    try {
      const { error: refErr } = await admin.from('auto_reply_settings').update({ updated_by: userId }).eq('id', settingId);
      if (refErr) throw new Error(`이력 참조 설정 실패: ${refErr.message}`);

      // ① 실제로 완전 삭제는 DB 제약으로 막힌다 — 이 오류 문구가 퇴직 처리로 넘어가는 신호
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      expect(delErr).not.toBeNull();
      expect(isAuthDbDeleteError(delErr), `실제 오류: ${delErr?.message} / status=${delErr?.status}`).toBe(true);

      // ② 퇴직 처리
      expect(await retireAdminAccount(admin, userId)).toEqual({ ok: true });

      // 이력 행은 그대로(참조 유지)
      const { data: kept } = await admin.from('auto_reply_settings').select('updated_by').eq('id', settingId).single();
      expect((kept as { updated_by: string | null }).updated_by).toBe(userId);

      // 프로필: 관리자 아님·익명화·삭제 표시
      const { data: profile } = await admin.from('user_profiles').select('cms_role, full_name, email, phone, deleted_at').eq('id', userId).single();
      const p = profile as { cms_role: string | null; full_name: string | null; email: string; phone: string | null; deleted_at: string | null };
      expect(p.cms_role).toBeNull();
      expect(p.full_name).toBe(RETIRED_NAME);
      expect(p.email).toBe(retiredEmailFor(userId));
      expect(p.phone).toBeNull();
      expect(p.deleted_at).not.toBeNull();

      // 관리자 목록 조회(cms_role 있는 프로필)에 나오지 않는다
      const { data: listed } = await admin.from('user_profiles').select('id').not('cms_role', 'is', null).eq('id', userId);
      expect(listed ?? []).toHaveLength(0);

      // 원래 이메일로는 더 이상 로그인할 수 없다(계정 이메일이 바뀌고 차단됨)
      const anon = createClient(PUBLIC_SUPABASE_URL, (await import('$env/static/public')).PUBLIC_SUPABASE_ANON_KEY);
      const { error: loginErr } = await anon.auth.signInWithPassword({ email, password });
      expect(loginErr).not.toBeNull();

      // 이미 퇴직 처리된 계정에 다시 호출하면 관리자가 아니므로 거절(고객 계정 보호와 같은 규칙)
      const again = await retireAdminAccount(admin, userId);
      expect(again.ok).toBe(false);
    } finally {
      // 이력 참조를 원래대로 되돌린 뒤 시험 계정 정리(참조가 남아 있으면 삭제가 막힌다)
      await admin.from('auto_reply_settings').update({ updated_by: originalUpdatedBy }).eq('id', settingId);
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });
});
