/**
 * TDD: AI 조력 생성기 — 전체 파이프라인(입력 → AI → 파싱 → 검증 → 게이트 → 반영) (2026-10-08)
 * AI 호출은 가짜 함수, DB는 가짜 클라이언트. 한 단계라도 실패하면 아무것도 반영하지 않는다.
 */
import { describe, it, expect } from 'vitest'
import { runAssistPipeline } from '$lib/server/crazychat/assist/pipeline'
import type { AssistDb } from '$lib/server/crazychat/assist/apply'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

const faqsForMatch: CannedResponseForMatch[] = [
  { id: 'aaaa1111-0000', title: '보증금은 얼마인가요?', content: '현재 보증금 제도를 채택하지 않았습니다.', category: 'payment', shortcut: null, match_keywords: ['보증금', '예치금', '보증금얼마'], usage_count: 0 },
  { id: 'bbbb2222-0000', title: '반납 안내 기본', content: '반납은 택배 또는 직접 방문으로 가능합니다.', category: 'return', shortcut: null, match_keywords: ['반납방법', '반납장소', '택배반납'], usage_count: 0 },
]
const input = {
  faqs: faqsForMatch.map((f) => ({ id: f.id.slice(0, 8), title: f.title, content: f.content, keywords: f.match_keywords })),
  productTerms: ['소니'],
  questions: ['보증금 돌려받나요'],
}

function fake() {
  const kws = new Map(faqsForMatch.map((f) => [f.id, [...f.match_keywords]]))
  const calls = { insertItem: 0, setKeywords: 0, insertFaq: 0 }
  const db: AssistDb = {
    async createRun() { return 'run1' },
    async getKeywords(id) { return kws.get(id) ?? null },
    async setKeywords(id, k) { calls.setKeywords++; kws.set(id, k) },
    async insertFaq() { calls.insertFaq++; return 'faqNew' },
    async deleteFaq() {},
    async insertItem() { calls.insertItem++ },
    async listItems() { return [] },
    async finishRun() {},
    async runStatus() { return 'done' },
  }
  return { db, kws, calls }
}
const ok = (text: string) => async () => ({ text, inputTokens: 100, outputTokens: 50 })

describe('runAssistPipeline', () => {
  it('정상 응답이면 검증·게이트를 거쳐 반영한다', async () => {
    const f = fake()
    const r = await runAssistPipeline({ input, faqsForMatch, synonyms: [], db: f.db, callModel: ok('{"keywords":[{"faq":"aaaa1111","add":["보증금돌려"]}],"new_faqs":[]}'), model: 'm' })
    expect(r.ok).toBe(true)
    expect(f.kws.get('aaaa1111-0000')).toContain('보증금돌려')
    expect(r.summary?.keywordsAdded).toBe(1)
  })
  it('AI 응답을 읽을 수 없으면 아무것도 반영하지 않는다', async () => {
    const f = fake()
    const r = await runAssistPipeline({ input, faqsForMatch, synonyms: [], db: f.db, callModel: ok('죄송합니다'), model: 'm' })
    expect(r.ok).toBe(false)
    expect(f.calls.setKeywords + f.calls.insertFaq + f.calls.insertItem).toBe(0)
  })
  it('AI 호출이 실패(크레딧 부족 등)해도 던지지 않고 반영도 없다', async () => {
    const f = fake()
    const r = await runAssistPipeline({ input, faqsForMatch, synonyms: [], db: f.db, callModel: async () => { throw new Error('credit balance is too low') }, model: 'm' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('AI 호출')
    expect(f.calls.setKeywords).toBe(0)
  })
  it('검증·게이트에서 모두 걸러지면 반영 없이 정상 종료한다', async () => {
    const f = fake()
    const r = await runAssistPipeline({ input, faqsForMatch, synonyms: [], db: f.db, callModel: ok('{"keywords":[{"faq":"aaaa1111","add":["대여","환불받기"]}],"new_faqs":[]}'), model: 'm' })
    expect(r.ok).toBe(true)
    expect(r.summary?.keywordsAdded).toBe(0)
    expect(f.calls.setKeywords).toBe(0)
  })
  it('외부로 보내는 프롬프트에는 원본 연락처가 남지 않는다(2차 마스킹)', async () => {
    const f = fake()
    let seen = ''
    const r = await runAssistPipeline({
      input: { ...input, questions: ['01012345678 입니다 반납 문의', 'hong@test.com 으로 답해주세요'] }, faqsForMatch, synonyms: [], db: f.db,
      callModel: async ({ userTurn }) => { seen = userTurn; return { text: '{"keywords":[],"new_faqs":[]}', inputTokens: 1, outputTokens: 1 } }, model: 'm',
    })
    expect(r.ok).toBe(true)
    expect(seen).not.toMatch(/01012345678|hong@test\.com/)
    expect(seen).toContain('[전화]')
  })
})
