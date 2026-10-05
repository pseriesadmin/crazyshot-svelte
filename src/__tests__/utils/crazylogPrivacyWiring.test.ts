import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 크레이지로그 '비공개' 콤보 버튼·관리자 목록 삭제·부제목 엔티티 수정(2026-10-05) 배선 확인 — 화면 파일은 마운트 테스트가 없어 소스 문자열로 핵심 연결만 고정한다.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('크레이지로그 목록 — 관리자 비공개·삭제', () => {
  const server = read('src/routes/crazylog/list/+page.server.ts')
  const page = read('src/routes/crazylog/list/+page.svelte')

  it('관리자는 비공개 글도 목록에 포함(공개 필터 생략), 일반 사용자는 공개+본인 글만', () => {
    expect(server).toContain('isAdmin = !!p?.cms_role')
    expect(server).toContain('if (!isAdmin) {')
    expect(server).toContain("is_public.eq.true,user_id.eq.${userId}")
  })

  it('행 속성(isPublic·isMine)만 내려보내고 작성자 user_id는 노출하지 않는다', () => {
    expect(server).toContain('isMine:       !!userId && p.user_id === userId')
    expect(server).not.toMatch(/userId:\s+p\.user_id/)
  })

  it('비공개 행은 50% 흐림, 관리자에게만 조작 버튼(비공개 콤보·삭제)', () => {
    expect(page).toContain('.row-dim :is(.pc-bar, .pc-thumb')
    expect(page.match(/\{#if data\.isAdmin\}\{@render RowActions\(post\)\}\{\/if\}/g)?.length).toBe(2)
    expect(page).toContain('<div class="meta-row">') // 작성자·날짜 줄 우측 끝 배치
    expect(page).toContain('onclick={(e) => e.preventDefault()}') // 카드 링크 이동 방지
    expect(page).toContain("'set_post_public'")
    expect(page).toContain("'update_post_status', { p_id: post.id, p_status: 'deleted' }")
    expect(page).toContain('deleteSafety.handleAction')
  })
})

describe('크레이지로그 상세 — 작성자 비공개 콤보 버튼', () => {
  const view = read('src/routes/crazylog/view/[slug]/+page.svelte')
  it('PC·모바일 작성자 줄 우측에 작성자 또는 관리자(canManage)에게만 노출(2026-10-05 확대)', () => {
    expect(view.match(/\{#if data\.canManage\}\s*<button type="button" class="priv-btn/g)?.length).toBe(2)
    expect(view).toContain("'set_post_public'")
  })
})

describe('부제목 &nbsp; 노출 수정', () => {
  it('두 서버 로더가 공용 plainTextPreview를 쓰고, DB 함수도 엔티티를 디코딩한다', () => {
    expect(read('src/routes/crazylog/+page.server.ts')).toContain('plainTextPreview(b.html)')
    expect(read('src/routes/+page.server.ts')).toContain('plainTextPreview(b.html)')
    const sql = read('supabase/migrations/20261005040000_646_crazylog_first_text_decode_entities.sql')
    expect(sql).toContain("'&nbsp;', ' '")
    expect(sql).toContain("'&amp;', '&'")
  })
  it('set_post_public RPC는 anon 차단·authenticated만 허용', () => {
    const sql = read('supabase/migrations/20261005030000_645_set_post_public.sql')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.set_post_public(UUID, BOOLEAN) FROM anon')
    expect(sql).toContain('TO authenticated')
    expect(sql).toContain("RAISE EXCEPTION 'forbidden'")
  })
})

describe('목록 검색창 — 관리자 전용(통합 검색 구현 전까지)', () => {
  const page = readFileSync('src/routes/crazylog/list/+page.svelte', 'utf-8')
  it('PC·모바일 검색창 모두 관리자 계정에만 렌더링', () => {
    const open = page.indexOf('<div class="search-wrap">')
    const openPc = page.indexOf('<div class="pc-search-wrap">')
    expect(page.slice(open - 80, open)).toContain('{#if data.isAdmin}')
    expect(page.slice(openPc - 60, openPc)).toContain('{#if data.isAdmin}')
  })
})

