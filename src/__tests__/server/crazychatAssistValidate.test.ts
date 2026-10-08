/**
 * TDD: AI 조력 생성기 — 프롬프트·응답 파싱·검증 (2026-10-08)
 * AI 응답은 엄격 JSON만 받고, 키워드는 형식 규칙, 신규 자동답변은 "근거 문장에 있는 숫자·링크만" 허용한다.
 */
import { describe, it, expect } from 'vitest'
import { buildAssistPrompt, parseAssistOutput, validateAssistOutput, type AssistInput } from '$lib/server/crazychat/assist/infer'

const input: AssistInput = {
  faqs: [
    { id: 'aaaa1111', title: '보증금은 얼마인가요?', content: '현재 보증금 제도를 채택하지 않았습니다.', keywords: ['보증금'] },
    { id: 'bbbb2222', title: '반납 안내', content: '반납은 택배 또는 직접 방문으로 가능합니다. 문의 010-8036-9124', keywords: ['반납', '반납방법'] },
  ],
  productTerms: ['소니', 'FX3'],
  questions: ['반납 장소가 어디예요', '보증금 있나요'],
}

describe('buildAssistPrompt', () => {
  it('FAQ·상품어·마스킹된 질문을 담고 창작 금지를 명시한다', () => {
    const p = buildAssistPrompt(input)
    expect(p.system).toContain('JSON')
    expect(p.system).toMatch(/근거|창작/)
    expect(p.userTurn).toContain('보증금은 얼마인가요?')
    expect(p.userTurn).toContain('반납 장소가 어디예요')
    expect(p.userTurn).toContain('aaaa1111')
  })
})

describe('parseAssistOutput', () => {
  it('JSON(코드펜스 포함)을 읽는다', () => {
    const t = '```json\n{"keywords":[{"faq":"aaaa1111","add":["보증금환급"]}],"new_faqs":[]}\n```'
    expect(parseAssistOutput(t)).toEqual({ keywords: [{ faq: 'aaaa1111', add: ['보증금환급'] }], newFaqs: [] })
  })
  it('깨진 응답·구조 위반은 null', () => {
    expect(parseAssistOutput('그냥 문장')).toBeNull()
    expect(parseAssistOutput('{"keywords":"x"}')).toBeNull()
  })
})

describe('validateAssistOutput — 키워드', () => {
  const run = (add: string[]) => validateAssistOutput({ keywords: [{ faq: 'aaaa1111', add }], newFaqs: [] }, input).keywords[0]?.add ?? []
  it('형식에 맞는 키워드만 남긴다', () => {
    expect(run(['보증금환급', '보증 금'])).toEqual(['보증금환급', '보증금'].filter((k) => k !== '보증금'))
  })
  it('이미 있는 키워드·한 글자·숫자뿐·너무 긴 것·일반어는 버린다', () => {
    expect(run(['보증금', '가', '12345', '가나다라마바사아자차카타파하', '대여', '예약'])).toEqual([])
  })
  it('존재하지 않는 FAQ id는 버린다', () => {
    expect(validateAssistOutput({ keywords: [{ faq: 'zzzz9999', add: ['보증금환급'] }], newFaqs: [] }, input).keywords).toEqual([])
  })
  it('FAQ당 최대 8개', () => {
    const many = Array.from({ length: 12 }, (_, i) => `보증금항목${String.fromCharCode(0xac00 + i)}`)
    expect(run(many).length).toBeLessThanOrEqual(8)
  })
})

describe('validateAssistOutput — 신규 자동답변', () => {
  const faq = (over: Record<string, unknown> = {}) => ({
    title: '반납 방법 문의', keywords: ['반납방법문의', '반납어떻게', '반납하는법'], answer: '반납은 택배 또는 직접 방문으로 가능합니다.', sources: ['bbbb2222'], ...over,
  })
  const out = (f: Record<string, unknown>) => validateAssistOutput({ keywords: [], newFaqs: [f as never] }, input).newFaqs
  it('근거가 있고 새 숫자·링크가 없으면 통과', () => {
    expect(out(faq()).length).toBe(1)
  })
  it('근거(source)가 없거나 존재하지 않으면 버린다', () => {
    expect(out(faq({ sources: [] })).length).toBe(0)
    expect(out(faq({ sources: ['nope'] })).length).toBe(0)
  })
  it('근거 문장에 없는 숫자·링크가 답변에 있으면 버린다(정책 창작 방지)', () => {
    expect(out(faq({ answer: '반납은 3일 이내에 해주세요.' })).length).toBe(0)
    expect(out(faq({ answer: '자세한 내용은 https://example.com 에서 확인하세요.' })).length).toBe(0)
  })
  it('근거 문장에 있는 숫자는 허용', () => {
    expect(out(faq({ answer: '문의는 010-8036-9124 로 해주세요.' })).length).toBe(1)
  })
  it('약속·보장 표현, 너무 긴 답변, 키워드 3개 미만은 버린다', () => {
    expect(out(faq({ answer: '반드시 무료로 처리해 드리겠습니다.' })).length).toBe(0)
    expect(out(faq({ answer: '가'.repeat(600) })).length).toBe(0)
    expect(out(faq({ keywords: ['반납방법문의'] })).length).toBe(0)
  })
  it('같은 제목이 이미 있으면 버린다', () => {
    expect(out(faq({ title: '반납 안내' })).length).toBe(0)
  })
  it('사람 전용 주제(파손·분실·환불·취소·법적·개인정보·결제오류)는 AI가 만들 수 없다', () => {
    expect(out(faq({ title: '장비 파손 시 배상 안내' })).length).toBe(0)
    expect(out(faq({ keywords: ['환불규정', '반납방법문의', '반납어떻게'] })).length).toBe(0)
    expect(out(faq({ answer: '분실 시 안내드립니다.' })).length).toBe(0)
  })
})

describe('validateAssistOutput — 사람 전용 주제 키워드', () => {
  it('민감 주제 단어를 키워드로 새로 붙이지 않는다', () => {
    const r = validateAssistOutput({ keywords: [{ faq: 'aaaa1111', add: ['환불받기', '분실보상', '보증금환급'] }], newFaqs: [] }, input)
    expect(r.keywords[0]?.add).toEqual(['보증금환급'])
  })
})
