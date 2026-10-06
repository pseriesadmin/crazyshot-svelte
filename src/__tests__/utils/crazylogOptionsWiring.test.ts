import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 크레이지로그 작성자 옵션 연결(2026-10-06): 'AI·자동 저장'·'카페·블로그 스크랩'·'자동출처'·'CCL'.
 * 작성 화면이 저장한 값(allow_ai_save·allow_scrap·auto_source·ccl)을 검색 인덱스와 상세 화면이 따른다. 화면은 소스 문자열로 핵심 연결만 고정.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('AI·자동 저장 — 검색 인덱스(자동 수집)에서 제외', () => {
  const s = read('src/lib/server/searchEngine/adapters/crazylogSearchIndex.ts')
  it("allow_ai_save=true 인 공개 글만 인덱싱한다(기본값 true라 기존 글은 모두 포함)", () => {
    expect(s).toContain(".eq('status', 'published')")
    expect(s).toContain(".eq('is_public', true)")
    expect(s).toContain(".eq('allow_ai_save', true)")
  })
})

describe('상세 서버 — 옵션 값을 화면에 전달', () => {
  const s = read('src/routes/crazylog/view/[slug]/+page.server.ts')
  it('allow_scrap·auto_source·ccl 을 조회하고 기본값을 안전하게 정한다', () => {
    expect(s).toContain('allow_comments, allow_scrap, auto_source, ccl')
    expect(s).toContain('allowScrap:    postData.allow_scrap !== false')   // NULL·미설정은 허용
    expect(s).toContain('autoSource:    postData.auto_source === true')    // NULL·미설정은 꺼짐
    expect(s).toContain('ccl:           postData.ccl ?? null')
  })
})

describe('상세 화면 — 복사 방지·자동출처·CCL 표기', () => {
  const s = read('src/routes/crazylog/view/[slug]/+page.svelte')
  it('스크랩 꺼짐이면 작성자·관리자(canManage)를 제외하고 복사·잘라내기·우클릭·드래그를 막는다', () => {
    expect(s).toContain('const copyBlocked = $derived(!!post && post.allowScrap === false && !data.canManage)')
    expect(s.match(/class:no-copy=\{copyBlocked\} oncopy=\{onArticleCopy\} oncut=\{blockWhenCopyDisabled\} oncontextmenu=\{blockWhenCopyDisabled\} ondragstart=\{blockWhenCopyDisabled\}/g)?.length).toBe(2) // PC·모바일
    expect(s).toContain('.no-copy { user-select: none;')
  })
  it('자동출처: 복사 시 출처를 붙이되 복사 방지 중이면 붙이지 않고, 본문 아래에 출처 문구를 표시한다', () => {
    expect(s).toContain('if (copyBlocked) { e.preventDefault(); return }')
    expect(s).toContain('if (!post?.autoSource) return')
    expect(s).toContain('출처: ${post.author} · ${window.location.href}')
    expect(s.match(/출처: \{post\.author\} · 크레이지샷 크레이지로그/g)?.length).toBe(2)
  })
  it('CCL: 켜진 글에 CC BY 표기와 라이선스 링크(새 창·opener 차단), PC·모바일 모두', () => {
    expect(s.match(/CC BY\(저작자표시\)/g)?.length).toBe(2)
    expect(s.match(/href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/deed\.ko" target="_blank" rel="noopener noreferrer"/g)?.length).toBe(2)
  })
})

describe('작성 화면 — 옵션 저장은 신규·수정 모두 RPC로 전달(기존 동작 유지)', () => {
  const s = read('src/routes/crazylog/[slug]/+page.svelte')
  it('allow_scrap·allow_ai_save·auto_source·ccl 이 저장된다', () => {
    expect(s.match(/p_allow_scrap: allowScrap/g)?.length).toBe(2)
    expect(s.match(/p_allow_ai_save: allowAiSave/g)?.length).toBe(2)
    expect(s.match(/p_auto_source: autoSource/g)?.length).toBe(2)
    expect(s.match(/p_ccl: cclEnabled \? 'BY' : null/g)?.length).toBe(2)
  })
})
