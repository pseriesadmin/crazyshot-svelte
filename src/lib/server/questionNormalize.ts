// questionNormalize.ts — 빠른답변 매처 입력 앞단의 표기 정규화 (순수 함수, 서버 전용)
//
// 매처(matchCannedResponse)는 질문을 공백으로 쪼갠 뒤 조사를 떼고 2자 미만 단어를 버린다. 그래서
//   · "퀵으로 받을 수 있나요" → "퀵으로"의 조사를 떼면 "퀵"(1자)이라 사라진다
//   · "몇 시까지 해요" → "몇"(불용어)과 "시까지"→"시"(1자)가 모두 사라진다
// 여기서는 정책과 무관한 "표기"만 바로잡는다 — 의미를 바꾸지 않고, 키워드가 걸릴 수 있는 모양으로 붙이거나 풀어 쓴다.

// 한글 단어 안의 "퀵"(예: 스퀵)이나 이미 복합어(퀵배송·퀵서비스·퀵비용·퀵기사·퀵수령·퀵배달)는 건드리지 않는다.
const SINGLE_QUICK_RE = /(?<![가-힣])퀵(?!배송|서비스|비용|기사|수령|배달)/g
// 띄어 쓴 "퀵 비용"·"퀵 서비스"는 붙여서 복합어로 만든다(키워드가 "퀵비용"처럼 붙여 쓰기 때문)
const SPACED_QUICK_COMPOUND_RE = /(?<![가-힣])퀵\s+(비용|서비스|기사|수령|배달)/g
const KOREAN_HOUR_QUESTION_RE = /몇\s+시/g

export function normalizeQuestion(message: string): string {
  if (!message) return message
  return message.replace(KOREAN_HOUR_QUESTION_RE, '몇시').replace(SPACED_QUICK_COMPOUND_RE, '퀵$1').replace(SINGLE_QUICK_RE, '퀵배송')
}
