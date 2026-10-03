// /cms/chat 고객정보 패널 — 기본정보 타이틀 우측 "더보기" 아이콘 버튼(고객 관리 패널 랜딩) 테스트 (2026-10-03)
import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import CustomerDetailPanel from '$lib/components/chat/CustomerDetailPanel.svelte'

const detail = {
  profile: {
    name: '테스트', phone: '010-0000-0000', is_student: false, is_foreign: false,
    identity_type: null, identity_doc_url: null, identity_verified_at: null,
    foreign_doc_url: null, foreign_doc_urls: null, foreign_verified_at: null,
  },
  subscription: null,
  reservations: [],
}

function html(summary: Record<string, unknown> | null): string {
  return render(CustomerDetailPanel, { props: { detail, summary, isLoading: false } } as never).body
}

describe('고객정보 패널 — 기본정보 더보기 아이콘 버튼', () => {
  it('고객이 있으면 기본정보 타이틀 우측에 새 탭으로 고객 관리 기본정보 탭을 여는 링크가 표시된다', () => {
    const out = html({ user_id: 'u-123', email: 'a@b.c', member_code: 'M1', membership_grade: 'none', credit_score: 100, blacklisted: false })
    expect(out).toContain('href="/cms/customers?selected=u-123&amp;tab=info"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('aria-label="고객 관리에서 기본정보 열기"')
  })

  it('가로 점 3개 아이콘이다', () => {
    const out = html({ user_id: 'u-1', email: null, member_code: null, membership_grade: null, credit_score: null, blacklisted: false })
    expect((out.match(/<circle /g) ?? []).length).toBe(3)
  })

  it('user_id를 알 수 없으면(summary 없음) 버튼을 표시하지 않는다', () => {
    expect(html(null)).not.toContain('/cms/customers?selected=')
  })

  it('다른 섹션(본인증명·멤버십·최근 예약)에는 버튼이 없다 — 링크 1개뿐', () => {
    const out = html({ user_id: 'u-1', email: null, member_code: null, membership_grade: null, credit_score: null, blacklisted: false })
    expect((out.match(/\/cms\/customers\?selected=/g) ?? []).length).toBe(1)
  })
})
