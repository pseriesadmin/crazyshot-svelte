/**
 * TDD: questionNormalize.test.ts — 빠른답변 매처가 버리는 "한 글자 명사·띄어 쓴 복합어"를 질문 앞단에서 정규화한다 (2026-10-08)
 * 이유: 매처는 조사를 뗀 뒤 2자 미만 단어를 버린다. "퀵으로"→"퀵", "몇 시까지"→"시"가 사라져 퀵배송·영업시간 FAQ가 걸리지 못했다.
 * 규칙(정책과 무관한 표기 정규화만): ① "몇 시" → "몇시" ② 단독 "퀵" → "퀵배송"(이미 퀵배송·퀵서비스·퀵비용 등이면 그대로)
 */
import { describe, it, expect } from 'vitest'
import { normalizeQuestion } from '$lib/server/questionNormalize'

describe('normalizeQuestion', () => {
  it('"몇 시"를 "몇시"로 붙인다', () => {
    expect(normalizeQuestion('몇 시까지 해요')).toBe('몇시까지 해요')
    expect(normalizeQuestion('몇시부터 가능해요?')).toBe('몇시부터 가능해요?')
    expect(normalizeQuestion('상담은 몇   시에 끝나요')).toBe('상담은 몇시에 끝나요')
  })
  it('단독 "퀵"은 "퀵배송"으로 바꾼다(조사 보존)', () => {
    expect(normalizeQuestion('퀵으로 받을 수 있나요')).toBe('퀵배송으로 받을 수 있나요')
    expect(normalizeQuestion('퀵 가능해요?')).toBe('퀵배송 가능해요?')
    expect(normalizeQuestion('반납은 퀵이 편해요')).toBe('반납은 퀵배송이 편해요')
  })
  it('띄어 쓴 "퀵 비용"류는 붙여서 복합어로 만든다(2026-10-08)', () => {
    expect(normalizeQuestion('퀵 비용은 누가 내요')).toBe('퀵비용은 누가 내요')
    expect(normalizeQuestion('퀵   서비스 되나요')).toBe('퀵서비스 되나요')
    expect(normalizeQuestion('퀵 기사님 연락')).toBe('퀵기사님 연락')
    expect(normalizeQuestion('스퀵 비용')).toBe('스퀵 비용')
  })
  it('이미 복합어면 건드리지 않는다', () => {
    for (const t of ['퀵배송 비용이 얼마예요', '퀵서비스 되나요', '퀵비용은요', '퀵기사님 연락', '퀵수령 가능해요', '퀵배달로 보내주세요']) expect(normalizeQuestion(t)).toBe(t)
  })
  it('한글 단어 안의 "퀵"은 건드리지 않는다', () => {
    expect(normalizeQuestion('스퀵 같은 건 몰라요')).toBe('스퀵 같은 건 몰라요')
  })
  it('해당 없는 문장·빈 문자열은 그대로', () => {
    expect(normalizeQuestion('보증금은 얼마예요?')).toBe('보증금은 얼마예요?')
    expect(normalizeQuestion('')).toBe('')
  })
})
