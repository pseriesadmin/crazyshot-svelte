/**
 * TDD: 복합 키워드 분해 매칭 — 2026-10-08
 *  배경: 운영 FAQ 키워드는 "반납장소"·"퀵비용"·"카드결제"처럼 붙여 쓰지만 고객은 "반납 장소가 어디예요"처럼 띄어 쓴다.
 *        매처는 질문을 공백 단위로 쪼개 비교하므로 "장소"·"비용"·"카드"가 "설명 안 되는 말"로 남아 정답이 1등이어도 담당자 대기로 넘어갔다.
 *  규칙: 질문에서 서로 이웃한 두 단어를 붙여서 만든 말이 키워드와 같거나 그 키워드로 시작하면 두 단어를 함께 설명된 것으로 본다.
 *  원칙: ① 순서가 뒤바뀌거나 이웃하지 않으면 붙이지 않는다 ② 다른 주제의 합성어로 오인하지 않는다 ③ 단독 일반어는 여전히 답하지 않는다
 */
import { describe, it, expect } from 'vitest'
import { decideAutoReply } from '$lib/server/cannedAutoReply'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

const mk = (id: string, title: string, kw: string[], shortcut: string | null = null): CannedResponseForMatch => ({
  id, title, content: `${title} 본문`, category: null, shortcut, match_keywords: kw, usage_count: 0,
})

const candidates: CannedResponseForMatch[] = [
  mk('pay', '결제 방법 안내', ['카드결제', '결제수단', '포인트결제']),
  mk('ret', '반납 안내 기본', ['반납장소', '반납방법', '반납절차']),
  mk('parcel', '택배 반납 신청', ['택배반납', '택배수거']),
  mk('quick', '퀵 배송 이용 안내', ['퀵비용', '퀵서비스', '퀵기사']),
  mk('area', '배송 업체 안내', ['배송지역', '배송업체', '배송가능']),
  mk('doc', '첫거래 인증서류 요청', ['서류제출', '인증서류', '신분증']),
  mk('cancel', '예약 취소 안내', ['예약취소', '취소수수료', '환불규정']),
]

const answerId = (q: string): string | null => decideAutoReply(q, candidates, []).answer?.id ?? null

describe('띄어 쓴 두 단어가 붙여 쓴 키워드와 같으면 함께 설명된 것으로 본다', () => {
  const mustAnswer: [string, string][] = [
    ['반납 장소가 어디예요', 'ret'],
    ['반납 장소 알려주세요', 'ret'],
    ['반납 방법이 궁금해요', 'ret'],
    ['퀵 비용은 누가 내요', 'quick'],
    ['퀵 비용 얼마에요', 'quick'],
    ['카드로 결제할 수 있나요', 'pay'],
    ['카드 결제 되나요', 'pay'],
    ['포인트 결제 가능한가요', 'pay'],
    ['배송 지역이 어디예요', 'area'],
    ['배송 가능 지역 알려주세요', 'area'],
    ['택배 반납해도 되나요', 'parcel'],
    ['예약 취소하고 싶어요', 'cancel'],
    ['취소 수수료가 있나요', 'cancel'],
  ]
  for (const [q, id] of mustAnswer) {
    it(`답변: ${q} → ${id}`, () => {
      expect(answerId(q)).toBe(id)
    })
  }
})

describe('붙여 쓴 질문은 기존처럼 동작한다(회귀 없음)', () => {
  for (const [q, id] of [['반납장소 어디예요', 'ret'], ['퀵비용 얼마에요', 'quick'], ['카드결제 되나요', 'pay']] as [string, string][]) {
    it(`답변: ${q} → ${id}`, () => {
      expect(answerId(q)).toBe(id)
    })
  }
})

describe('잘못 붙여서 엉뚱한 안내로 가지 않는다', () => {
  const mustNotMatch: [string, string][] = [
    ['장소 반납', '순서가 뒤바뀐 말은 합치지 않는다 → "장소반납"은 키워드가 아님'],
    ['결제 카드 잃어버렸어요', '순서가 뒤바뀐 말은 합치지 않는다'],
    ['비용 퀵', '순서가 뒤바뀐 말'],
    ['퀵 반납', '다른 주제의 합성어("퀵반납")는 택배반납으로 이어지지 않는다'],
    ['장소', '단독 일반어'],
    ['비용', '단독 일반어'],
    ['지역', '단독 일반어'],
    ['카드', '단독 일반어'],
  ]
  for (const [q, why] of mustNotMatch) {
    it(`미매칭: ${q} (${why})`, () => {
      expect(answerId(q)).toBeNull()
    })
  }
  it('이웃하지 않은 두 단어는 합치지 않는다("반납" … "장소" 사이에 다른 핵심어)', () => {
    expect(answerId('반납 전에 사진 찍을 장소')).toBeNull()
  })
})
