// action.ts — 크레이지챗 접수형 순수 로직 (서버 전용)
//
// 고객이 "예약 시간 바꿀 수 있나요?", "연장하고 싶어요", "상담원 연결해 주세요", "서류 다시 올릴게요"라고 하면:
//   · time_change / extend  → 요청을 "접수"만 한다(chat_agent_requests). 변경·확정은 관리자가 기존 절차로 처리한다.
//   · call_agent            → 기존 긴급 배지·긴급 푸시를 재사용해 사람을 호출한다.
//   · doc_guide             → 서류 미등록이면 기존 '서류 등록 요청 카드'를 바로 보내고, 등록·승인 상태면 안내 문구만 보낸다.
// 이 파일은 DB를 읽지 않는 순수 함수다. 확정·약속을 뜻하는 표현은 절대 쓰지 않는다(접수 ≠ 확정).

import { HOW_TO_RE, MAX_QUESTION_LENGTH, OUT_OF_SCOPE_RE, type ReservationGroup } from './query'
import { detectHumanOnlyTopic } from './topics'

export type ActionIntent = 'time_change' | 'extend' | 'call_agent' | 'doc_guide'
export type AgentRequestKind = 'time_change' | 'extend'

const CALL_AGENT_RE =
  /(상담원|상담사|담당자|직원|사람|관리자|매니저).{0,8}(연결|호출|불러|바꿔|통화|얘기|이야기|말하|만나)|(연결|호출|통화).{0,6}(상담원|담당자|직원|사람)/
const DOC_GUIDE_RE =
  /(서류|등본|신분증|본인\s?증명|인증\s?서류).{0,10}(다시|재\s?제출|재\s?등록|재\s?업로드|추가\s?제출)/
const TIME_WORD_RE = /(픽업|수령|반납|예약|대여|이용).{0,8}시간|시간.{0,6}(변경|조정|바꿔|바꾸|바꿀|앞당|늦추|늦출|당기|당길|미루|미룰|연기)/
const CHANGE_VERB_RE = /변경|조정|바꿔|바꾸|바꿀|앞당|늦추|늦출|당기|당길|미루|미룰|연기/
const NOT_RESERVATION_TIME_RE = /운영\s?시간|영업\s?시간|상담\s?시간/
const EXTEND_RE = /연장/
const EXTEND_ASK_RE = /하고\s?싶|할\s?수|가능|문의|부탁|해\s?주|신청|할게|하려|원합니다|원해|되나|돼요|되는지|될까|궁금/
// 연장 "방법·절차" 질문도 접수로 처리한다(2026-10-08, Stephen 지시 — 안내용 연장 FAQ를 접수형으로 통합). 금액 질문·지연 건은 계속 제외.
const EXTEND_HOW_RE = /방법|절차|어떻게|어디서|어디에|어디로|언제까지|기한|마감|해야/
// 연장을 하지 않겠다는 말("연장 안 할게요", "연장 필요 없어요")은 접수하지 않는다
const EXTEND_NEGATION_RE = /연장\s?(은|도)?\s?(안|못)\s?(할|하|해|함|합)|연장\s?하지\s?(않|말)|연장\s?(은|이)?\s?필요\s?없|연장\s?취소|연장\s?철회/
// 말이 짧은 "장비 연장", "연장이요"처럼 요청 어미가 없어도 연장 의도가 분명한 경우
const EXTEND_SHORT_MAX = 14
const DELAY_RE = /지연|연체/

/** 접수형 의도 판정(규칙). 사람 전용 주제·타인 정보·긴 글은 항상 null. */
export function classifyActionIntent(message: string | null | undefined): ActionIntent | null {
  if (typeof message !== 'string') return null
  const m = message.trim()
  if (!m || m.length > MAX_QUESTION_LENGTH) return null
  if (detectHumanOnlyTopic(m)) return null

  // 상담원 호출은 "금액·방법 질문이라 봇이 답할 수 없는 경우"의 정상 출구이므로 허용 밖 항목 검사를 적용하지 않는다
  if (CALL_AGENT_RE.test(m)) return 'call_agent'
  // 서류는 주민등록 같은 단어가 자연스럽게 들어가므로 허용 밖 항목 검사를 적용하지 않는다
  if (DOC_GUIDE_RE.test(m)) return 'doc_guide'

  if (OUT_OF_SCOPE_RE.test(m)) return null
  // 연장은 방법·절차 질문도 접수로 처리하므로 HOW_TO 제외보다 먼저 판정한다(금액·지연·부정은 제외)
  if (EXTEND_RE.test(m) && !DELAY_RE.test(m) && !EXTEND_NEGATION_RE.test(m)) {
    if (EXTEND_ASK_RE.test(m) || EXTEND_HOW_RE.test(m) || HOW_TO_RE.test(m) || m.length <= EXTEND_SHORT_MAX) return 'extend'
    return null
  }
  if (HOW_TO_RE.test(m)) return null
  if (TIME_WORD_RE.test(m) && CHANGE_VERB_RE.test(m) && !NOT_RESERVATION_TIME_RE.test(m)) return 'time_change'
  return null
}

/** 요청 종류별로 접수할 수 있는 예약 단계 */
const ALLOWED_STAGES: Record<AgentRequestKind, readonly string[]> = {
  time_change: ['hold', 'confirmed'],
  extend: ['confirmed', 'shipped', 'in_use'],
}

export function stageAllowsKind(stage: string, kind: AgentRequestKind): boolean {
  return ALLOWED_STAGES[kind].includes(stage)
}

export type TargetPick =
  | { kind: 'one'; code: string | null; group: ReservationGroup }
  | { kind: 'need_code'; codes: string[] }
  | { kind: 'not_found' }
  | { kind: 'none' }

/**
 * 접수 대상 예약 선택. groups는 호출부가 "본인 예약 행"으로만 만든 묶음이다.
 * 번호를 말했는데 본인 목록에 없으면 not_found(존재 여부를 드러내지 않음), 접수할 수 있는 단계가 아니면 none.
 */
export function pickTargetReservation(
  groups: readonly ReservationGroup[],
  requestedCode: string | null,
  kind: AgentRequestKind,
): TargetPick {
  if (requestedCode) {
    const wanted = requestedCode.toUpperCase()
    const g = groups.find((x) => x.code?.toUpperCase() === wanted)
    if (!g) return { kind: 'not_found' }
    if (!stageAllowsKind(g.stage, kind)) return { kind: 'none' }
    return { kind: 'one', code: g.code, group: g }
  }
  const eligible = groups.filter((g) => stageAllowsKind(g.stage, kind))
  if (eligible.length === 0) return { kind: 'none' }
  if (eligible.length === 1) return { kind: 'one', code: eligible[0].code, group: eligible[0] }
  return { kind: 'need_code', codes: eligible.map((g) => g.code).filter((c): c is string => !!c) }
}

const KIND_LABEL: Record<AgentRequestKind, string> = { time_change: '예약 시간 변경 요청', extend: '연장 문의' }

/** 고객에게 보내는 안내 문구 — 접수일 뿐 확정이 아님을 항상 밝힌다. */
export const ACTION_REPLY = {
  registered(kind: AgentRequestKind, code: string | null): string {
    const target = code ? `예약 ${code}의 ` : ''
    const end = kind === 'time_change' ? '변경이' : '연장이'
    return `${target}${KIND_LABEL[kind]}을(를) 접수했어요. 담당자가 일정을 확인한 뒤 이 채팅으로 안내해 드릴게요. 아직 ${end} 확정된 것은 아니에요.`
  },
  duplicate: '이미 접수된 요청이 있어요. 담당자가 확인하고 있으니 조금만 기다려 주세요.',
  needCode(codes: readonly string[]): string {
    const shown = codes.slice(0, 3).join(', ')
    return `어느 예약인지 알려주세요. 진행 중인 예약은 ${shown}${codes.length > 3 ? ' 외' : ''}입니다. 예약번호를 함께 보내 주시면 접수해 드릴게요.`
  },
  callAgent: '상담원에게 연결을 요청했어요. 담당자가 확인하면 이 채팅으로 답변드릴게요.',
  docNone: '아직 필수 서류가 등록되지 않았어요. 아래 카드에서 서류를 등록해 주세요.',
  docPending: '서류를 확인하는 중이라 추가로 제출하실 필요가 없어요. 조금만 기다려 주세요.',
  docApproved: '서류 승인이 이미 완료되었어요. 서류를 바꾸고 싶으시면 \'담당자 연결\'이라고 말씀해 주세요.',
} as const

/** 서류 등록 요청 카드(기존 관리자 발송 카드와 같은 모양) */
export const DOC_REQUEST_CARD = {
  type: 'identity_request',
  doc_type: 'identity',
  button_label: '본인증명 등록요청',
  action_url: '/account/profile?tab=profile',
} as const

export { KIND_LABEL as AGENT_REQUEST_KIND_LABEL }
