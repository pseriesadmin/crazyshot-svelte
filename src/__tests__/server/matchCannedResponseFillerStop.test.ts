/**
 * TDD: 불용어(의문·되묻기 말투) 확장 — 2026-10-08
 *  배경: "반납 장소가 어디예요", "신분증 어떤 걸 올려야 해요", "퀵 비용 얼마에요"처럼 정답 후보가 1등인데도
 *        "어디예요·얼마에요·올려야" 같은 말투 단어가 질문 핵심으로 계산돼 설명 비율(커버리지)이 깎여 담당자 대기로 넘어갔다.
 *  원칙: ① 주제를 가리키지 않는 의문·되묻기·행동 군더더기만 불용어로 본다(명사 주제어는 절대 포함하지 않는다)
 *        ② 불용어를 늘려도 주제어가 없는 질문은 계속 답하지 않는다 ③ 엉뚱한 안내로 가던 사례는 늘어나지 않는다
 */
import { describe, it, expect } from 'vitest'
import { decideAutoReply } from '$lib/server/cannedAutoReply'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

const mk = (id: string, title: string, kw: string[], shortcut: string | null = null): CannedResponseForMatch => ({
  id, title, content: `${title} 본문`, category: null, shortcut, match_keywords: kw, usage_count: 0,
})

const candidates: CannedResponseForMatch[] = [
  mk('pay', '결제 방법 안내', ['결제방법', '카드결제', '결제수단'], '결제'),
  mk('doc', '첫거래 인증서류 요청', ['신분증', '인증서류', '서류제출', '운전면허증']),
  mk('ret', '반납 안내 기본', ['반납', '반납방법', '반납장소', '반납안내'], '반납'),
  mk('dep', '보증금은 얼마인가요?', ['보증금', '예치금']),
  mk('quick', '퀵 배송 이용 안내', ['퀵배송', '퀵서비스', '퀵비용', '퀵']),
  mk('loc', '매장정보안내', ['매장위치', '오시는길', '매장주소', '위치']),
]

const answerId = (q: string): string | null => decideAutoReply(q, candidates, []).answer?.id ?? null

describe('말투 군더더기가 붙어도 주제어가 분명하면 답한다', () => {
  const mustAnswer: [string, string][] = [
    ['반납 어디예요', 'ret'],
    ['반납 어디에요', 'ret'],
    ['반납 어딘가요', 'ret'],
    ['반납 어디인가요', 'ret'],
    ['반납하려면 어디로 가야 하나요', 'ret'],
    ['반납 어디로 가면 돼요', 'ret'],
    ['위치 어디예요', 'loc'],
    ['위치가 어디인가요', 'loc'],
    ['신분증 어떤 걸 올려야 해요', 'doc'],
    ['신분증 뭐 올려야 하나요', 'doc'],
    ['퀵 얼마에요', 'quick'],
    ['퀵 얼마나 나와요', 'quick'],
    ['보증금 얼마인지 알고 싶어요', 'dep'],
    ['직접 반납하러 가도 되나요', 'ret'],
    ['반납은 어디로 보내요', 'ret'],
    ['퀵으로 받을 수 있나요', 'quick'],
  ]
  for (const [q, id] of mustAnswer) {
    it(`답변: ${q} → ${id}`, () => {
      expect(answerId(q)).toBe(id)
    })
  }
})

describe('불용어를 늘려도 주제어가 없으면 답하지 않는다', () => {
  const mustWait = [
    '어디예요',
    '얼마에요',
    '뭐예요',
    '어디로 가야 하나요',
    '언제까지 해야 하나요',
    '어떤 걸 올려야 해요',
    '얼마인지 알고 싶어요',
    '안녕하세요 어디예요',
    '직접 빌려도 되나요',
    '바로 받을 수 있나요',
  ]
  for (const q of mustWait) {
    it(`대기: ${q}`, () => {
      expect(answerId(q)).toBeNull()
    })
  }
})

describe('엉뚱한 안내로 가던 사례는 그대로 막힌다', () => {
  const mustNotAnswerWrong: [string, string][] = [
    ['소니 카메라 어디서 사요', '상품 구매 문의가 엉뚱한 안내로'],
    ['캐논 R5 얼마예요', '상품 가격 문의가 보증금 안내로'],
    ['사장님 번호가 어떻게 되나요', '연락처 문의'],
    ['오늘 날씨 어때요', '무관한 질문'],
  ]
  for (const [q, why] of mustNotAnswerWrong) {
    it(`미매칭: ${q} (${why})`, () => {
      expect(answerId(q)).toBeNull()
    })
  }
})
