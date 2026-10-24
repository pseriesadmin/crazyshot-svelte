import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** 공통 푸터 '소개 > 팀' → 공통 정책 모달에 팀 정책 콘텐츠 노출 (2026-10-24) — 소스 점검 */
const src = readFileSync('src/routes/+layout.svelte', 'utf-8')

describe('공통 푸터 — 팀 모달', () => {
  it("'팀'은 더 이상 홈 링크가 아니라 모달을 여는 버튼이다", () => {
    expect(src).not.toMatch(/<a href="\/" class="footer-link">팀<\/a>/)
    expect(src).toMatch(/<button class="footer-link footer-link-btn" onclick=\{openTeamModal\}>팀<\/button>/)
  })
  it('기존 정책 모달(policyModal) 하나를 같이 쓰고, 별도 모달을 만들지 않는다', () => {
    expect(src.match(/class="policy-overlay"/g)?.length).toBe(1)
    expect(src).toContain("title: '팀'")
  })
  it('내용은 /api/team-policy(서버 정화본)에서 읽어 ContentBlocksView로 그린다', () => {
    expect(src).toContain("fetch('/api/team-policy')")
    expect(src).toContain('<ContentBlocksView blocks={policyModal.blocks}')
  })
  it('다른 모달로 바뀐 뒤 늦게 도착한 응답이 화면을 덮어쓰지 않는다(요청 번호 확인)', () => {
    expect(src).toContain('modalSeq')
  })
  it('기존 3개 법적 고지 링크는 그대로 있다', () => {
    for (const t of ['개인정보처리방침', '서비스이용정책', '환불규정']) expect(src).toContain(t)
  })
})
