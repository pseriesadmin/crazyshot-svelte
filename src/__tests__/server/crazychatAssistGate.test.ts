/**
 * TDD: AI 조력 생성기 — 시뮬레이션 안전 게이트 (2026-10-08)
 * 즉시 운영 반영 전, 제안 키워드·신규 자동답변이 기존 질문의 답을 망치지 않는지 decideAutoReply로 사전 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { gateAssistOutput } from '$lib/server/crazychat/assist/gate'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

const mk = (id: string, title: string, kw: string[]): CannedResponseForMatch => ({
  id, title, content: `${title} 본문`, category: null, shortcut: null, match_keywords: kw, usage_count: 0,
})
const faqs: CannedResponseForMatch[] = [
  mk('aaaa1111-0000', '보증금은 얼마인가요?', ['보증금', '예치금', '보증금얼마']),
  mk('bbbb2222-0000', '반납 안내 기본', ['반납방법', '반납장소', '반납절차', '택배반납']),
  mk('cccc3333-0000', '퀵 배송 이용 안내', ['퀵배송', '퀵서비스', '퀵비용']),
]

describe('gateAssistOutput — 키워드', () => {
  it('무해한 키워드는 통과한다', () => {
    const r = gateAssistOutput({ keywords: [{ faq: 'aaaa1111', add: ['보증금환급'] }], newFaqs: [] }, faqs, [])
    expect(r.keywords).toEqual([{ faqId: 'aaaa1111-0000', add: ['보증금환급'] }])
  })
  it('다른 FAQ의 질문을 가로채는 키워드는 걸러낸다', () => {
    // '반납방법'은 반납 FAQ의 핵심 키워드 — 보증금 FAQ에 붙이면 반납 질문이 보증금 안내로 갈 위험
    const r = gateAssistOutput({ keywords: [{ faq: 'aaaa1111', add: ['반납방법', '보증금환급'] }], newFaqs: [] }, faqs, [])
    const added = r.keywords.flatMap((k) => k.add)
    expect(added).toContain('보증금환급')
    expect(added).not.toContain('반납방법')
  })
  it('결과 요약에 걸러낸 개수를 담는다', () => {
    const r = gateAssistOutput({ keywords: [{ faq: 'aaaa1111', add: ['반납방법'] }], newFaqs: [] }, faqs, [])
    expect(r.rejected.keywords).toBeGreaterThanOrEqual(1)
  })
})

describe('gateAssistOutput — 신규 자동답변', () => {
  const nf = (keywords: string[]) => ({ title: '촬영 전날 수령 문의', keywords, answer: '반납은 택배 또는 직접 방문으로 가능합니다.', sources: ['bbbb2222'] })
  it('기존 질문을 가로채지 않으면 통과', () => {
    const r = gateAssistOutput({ keywords: [], newFaqs: [nf(['전날수령', '미리수령', '전날픽업'])] }, faqs, [])
    expect(r.newFaqs.length).toBe(1)
  })
  it('기존 FAQ의 핵심 키워드를 훔치는 신규 항목은 걸러낸다', () => {
    const r = gateAssistOutput({ keywords: [], newFaqs: [nf(['보증금', '예치금', '전날수령'])] }, faqs, [])
    expect(r.newFaqs.length).toBe(0)
  })
})
