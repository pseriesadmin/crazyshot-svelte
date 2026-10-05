import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { canManagePost, canDeletePost, describePostActionError } from '$lib/utils/crazylogPostPermissions'

/**
 * 크레이지로그 글 관리 권한(2026-10-05, Migration #647): 수정·비공개 = 작성자 또는 모든 관리자(파트너 포함),
 * 삭제 = 작성자 · 관리자 글은 모든 관리자 · 사용자 글은 매니저 이상.
 */
const base = { isOwner: false, viewerRole: null as string | null, authorIsAdmin: false }

describe('canManagePost (수정·비공개)', () => {
  it('작성자 본인', () => expect(canManagePost({ ...base, isOwner: true })).toBe(true))
  it.each(['partner', 'manager', 'superadmin'])('%s 관리자는 어떤 글이든 가능', (role) => {
    expect(canManagePost({ ...base, viewerRole: role })).toBe(true)
    expect(canManagePost({ ...base, viewerRole: role, authorIsAdmin: true })).toBe(true)
  })
  it('관리자도 작성자도 아니면 불가', () => expect(canManagePost(base)).toBe(false))
})

describe('canDeletePost (삭제)', () => {
  it('작성자 본인은 자기 글 삭제 가능', () => expect(canDeletePost({ ...base, isOwner: true })).toBe(true))
  it('관리자가 쓴 글 — 파트너 포함 모든 관리자 삭제 가능', () => {
    for (const role of ['partner', 'manager', 'superadmin']) {
      expect(canDeletePost({ ...base, viewerRole: role, authorIsAdmin: true })).toBe(true)
    }
  })
  it('사용자가 쓴 글 — 파트너는 불가, 매니저·슈퍼마스터는 가능', () => {
    expect(canDeletePost({ ...base, viewerRole: 'partner' })).toBe(false)
    expect(canDeletePost({ ...base, viewerRole: 'manager' })).toBe(true)
    expect(canDeletePost({ ...base, viewerRole: 'superadmin' })).toBe(true)
  })
  it('관리자가 아닌 타인은 불가(관리자 글이어도)', () => {
    expect(canDeletePost(base)).toBe(false)
    expect(canDeletePost({ ...base, authorIsAdmin: true })).toBe(false)
  })
  it('알 수 없는 역할 문자열은 사용자 글 삭제 불가', () => {
    expect(canDeletePost({ ...base, viewerRole: 'unknown' })).toBe(false)
  })
})

describe('describePostActionError', () => {
  it('DB 거부 메시지를 안내 문구로 바꾼다', () => {
    expect(describePostActionError('forbidden: manager role required to delete user content')).toContain('매니저 이상')
  })
  it('그 외 오류는 원문 유지, 없으면 기본 문구', () => {
    expect(describePostActionError('post_not_found')).toBe('post_not_found')
    expect(describePostActionError(undefined)).toBe('처리 중 오류가 발생했습니다.')
  })
})

describe('배선 — 서버 판정 플래그·화면 노출·DB 규칙 일치', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')
  const viewServer = read('src/routes/crazylog/view/[slug]/+page.server.ts')
  const viewPage = read('src/routes/crazylog/view/[slug]/+page.svelte')
  const listServer = read('src/routes/crazylog/list/+page.server.ts')
  const listPage = read('src/routes/crazylog/list/+page.svelte')
  const card = read('src/lib/components/common/CrazylogWriteCard.svelte')
  const sql = read('supabase/migrations/20261005050000_647_post_delete_role_rules.sql')

  it('상세: 서버가 canManage·canDelete를 내리고 작성자 역할값은 내리지 않는다', () => {
    expect(viewServer).toContain('canManagePost(permInput)')
    expect(viewServer).toContain('canDeletePost(permInput)')
    expect(viewServer).toMatch(/return \{[^}]*canManage, canDelete/)
    expect(viewServer).not.toMatch(/authorIsAdmin,\s*\n?\s*(currentUser|postId)/)
  })

  it('상세: 비공개 버튼 2곳은 canManage, 작성 카드는 canEdit·canDelete 분리', () => {
    expect(viewPage.match(/\{#if data\.canManage\}\s*<button type="button" class="priv-btn/g)?.length).toBe(2)
    expect(viewPage).toContain('canEdit={data.canManage ?? false}')
    expect(viewPage).toContain('canDelete={data.canDelete ?? false}')
    expect(card).toContain('{#if canEdit && postId}')
    expect(card).toContain('{#if canDelete && postId}')
  })

  it('목록: 행마다 canDelete로 삭제 아이콘을 조건부 노출, 비공개 콤보는 모든 관리자', () => {
    expect(listServer).toContain('canDelete:    isAdmin && canDeletePost(')
    expect(listPage).toContain('{#if post.canDelete}')
    expect(listPage).toContain('onclick={() => togglePublic(post)}')
  })

  it('DB(#647): 삭제는 can_delete_user_post로 RPC·트리거 양쪽 집행, 매니저 이상 판정은 manager·superadmin', () => {
    expect(sql).toContain("cms_role IN ('manager', 'superadmin')")
    expect(sql).toContain('NOT public.can_delete_user_post(v_owner)')
    expect(sql).toContain('BEFORE UPDATE OF status ON public.user_posts')
    expect(sql).toContain('auth.uid() IS NOT NULL AND NOT public.can_delete_user_post(OLD.user_id)')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.can_delete_user_post(UUID) FROM anon;')
  })
})
