import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 크레이지로그 '댓글 허용' 옵션 연결(2026-10-05, Migration #648) — 화면 파일은 마운트 테스트가 없어 소스 문자열로 핵심 연결만 고정한다.
 * 작성 화면이 저장한 allow_comments 를 상세 화면(입력 비활성)과 DB(트리거)가 모두 따른다.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('댓글 허용 옵션 — 상세 서버·화면', () => {
  const server = read('src/routes/crazylog/view/[slug]/+page.server.ts')
  const page = read('src/routes/crazylog/view/[slug]/+page.svelte')

  it('서버가 allow_comments 를 읽어 allowComments 로 내려보낸다(NULL·미설정은 열림)', () => {
    expect(server).toContain('thumbnail_url, status, is_public, allow_comments')
    expect(server).toContain('const allowComments = postData.allow_comments !== false')
    expect(server).toMatch(/return \{[^}]*allowComments/)
  })

  it('화면: 댓글을 막은 글이면 PC·모바일 입력·등록 버튼을 모두 비활성화하고 안내 문구를 보여준다', () => {
    expect(page).toContain('const commentsOpen = $derived(data.allowComments !== false)')
    expect(page).toContain('if (!content || commentBusy || !commentsOpen) return')
    expect(page.match(/disabled=\{commentBusy \|\| !data\.isLoggedIn \|\| !commentsOpen\}/g)?.length).toBe(4)
    expect(page.match(/작성자가 댓글을 허용하지 않은 글입니다\./g)?.length).toBe(2)
  })

  it('이미 달린 댓글 목록은 막은 글에서도 그대로 표시된다(목록 렌더링은 commentsOpen 조건 없음)', () => {
    expect(page).toContain('{#each comments as c (c.id)}')
    expect(page).not.toMatch(/\{#if commentsOpen\}\s*\{#each comments/)
  })
})

describe('댓글 허용 옵션 — 작성 화면 저장', () => {
  const write = read('src/routes/crazylog/[slug]/+page.svelte')
  it('신규·수정 모두 allow_comments 값을 RPC로 저장하고 수정 시 기존 값을 불러온다', () => {
    expect(write).toContain("let allowComments = $state((ep?.allow_comments as boolean) ?? true)")
    expect(write.match(/p_allow_comments: allowComments/g)?.length).toBe(2)
  })
})

describe('DB(#648) — RPC·직접 INSERT 양쪽을 트리거로 집행', () => {
  const sql = read('supabase/migrations/20261005060000_648_post_comments_respect_allow_comments.sql')
  it('BEFORE INSERT 트리거 + 서버 신뢰 경로(auth.uid() NULL) 통과 + 비공개 글도 읽도록 SECURITY DEFINER', () => {
    expect(sql).toContain('BEFORE INSERT ON public.post_comments')
    expect(sql).toContain('IF auth.uid() IS NULL THEN')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('IF FOUND AND v_allow IS FALSE THEN')
    expect(sql).toContain("RAISE EXCEPTION '작성자가 댓글을 허용하지 않은 글입니다.'")
  })
  it('트리거 함수는 직접 호출 불가(REVOKE) 이고 기존 댓글 데이터를 건드리지 않는다', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.post_comments_guard_allow_comments() FROM anon, authenticated;')
    expect(sql).not.toMatch(/UPDATE\s+public\.post_comments|DELETE\s+FROM\s+public\.post_comments/i)
  })
})
