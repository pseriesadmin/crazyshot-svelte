// replyCandidateFilter.ts — 빠른답변 후보(고객 메시지 + 관리자 답변 쌍) 선별 (순수 함수, 서버 전용)
//
// 목적: 관리자가 직접 쓴 답변 중 "상품 기능·이용 방법·정책 안내"처럼 다른 고객에게도 재사용 가능한 쌍만
//       후보로 남기고, 인사·확인·이미지·개별 응대·개인정보·짝이 안 맞는 쌍은 걸러낸다(균형 기준, Stephen 확정 2026-11-10).
// 검색엔진 재사용: 한국어 토크나이저(koreanTokenize·stripTrailingParticle)로 핵심 단어를 뽑아 두 문장의 겹침을 본다.
// 함수 계약: DB·네트워크 호출 없음. 판정에 필요한 값은 모두 인자로 받는다.
import { koreanTokenize, stripTrailingParticle } from '$lib/server/searchEngine/core/koreanTokenizer'

export type ExclusionReason =
  | 'attachment_only' // 고객 메시지가 이미지 파일명·주소뿐
  | 'system_phrase' // 시스템/반복 정형문(본인증명 승인 문의 등)
  | 'greeting_ack' // 인사·확인·감사 등 내용 없는 응답
  | 'personal_info' // 이름·아이디·연락처·주소·긴 숫자 포함
  | 'individual_case' // 개별 고객 응대(예약 확인·완료 보고·보관함 번호 등)
  | 'pair_mismatch' // 고객 메시지와 답변이 서로 관련 없음
  | 'low_value' // 재사용 가치 낮음(너무 짧은 답변·점수 미달)

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  attachment_only: '이미지·주소만 있음',
  system_phrase: '정형 안내문',
  greeting_ack: '인사·확인 문장',
  personal_info: '개인정보 포함',
  individual_case: '개별 고객 응대',
  pair_mismatch: '질문과 답변 불일치',
  low_value: '재사용 가치 낮음',
}

export interface ReplyCandidateVerdict {
  keep: boolean
  reason: ExclusionReason | null
  score: number
}

export interface JudgeOptions {
  /** 상품명·브랜드 등 추가 주제어(검색엔진 사전에서 읽어 넘기면 상품 관련도로 반영) */
  extraTopicTerms?: ReadonlySet<string>
}

// ── 사전 ────────────────────────────────────────────────────────────────────
const TOPIC_GROUPS: Record<string, readonly string[]> = {
  reservation: ['예약', '일정', '스케줄', '재고', '연장', '대여'],
  cancel: ['취소', '환불', '위약', '수수료'],
  payment: ['결제', '카드', '영수증', '세금계산서', '현금영수증', '쿠폰', '포인트', '할인', '요금', '금액', '가격', '비용', '보증금', '입금'],
  logistics: ['수령', '픽업', '반납', '반환', '퀵', '배송', '택배', '보관함', '무인함', '방문', '매장', '영업시간', '연체', '지연'],
  account: ['본인인증', '본인증명', '가입', '회원', '로그인', '비밀번호', '탈퇴'],
  gear: ['렌즈', '호환', '메모리', '배터리', '충전', '삼각대', '마운트', '필터', '세트', '카메라', '캠코더', '조명', '마이크', '짐벌', '설정', '촬영', '영상', '사진', '백업', '코덱', '재생', '파일', '화질', '모드', '감도', '조리개'],
  damage: ['파손', '고장', '분실', '보험', '수리', '오염', '손상'],
}

// 주제어에서 빠지는 일반 안내어(겹침 계산 시 제외)
const STOP_TOKENS = new Set([
  '고객', '안녕하세요', '감사합니다', '확인', '부탁', '드립니다', '드려요', '있습니다', '합니다', '입니다', '그리고', '그럼', '혹시', '문의', '말씀', '안내', '진행',
])

const QUESTION_CUE = /[?？]|나요|까요|가능|어떻게|얼마|언제|방법|궁금|되는지|있는지|인가요|어디|왜/
const POLICY_CUE = /순서|방법|가능합니다|불가|경우|이내|해\s?주시|하시면|됩니다|부과|무료|원\b|%|시간|이상|이하/
const DATE_CUE = /\d{1,2}\s*월\s*\d{1,2}\s*일|오늘|내일|모레|방금|아까|지금|이따|있다가|\d{1,2}\s*시/
const COMPLETION_CUE = /(했습니다|했어요|했는데|넣었|올렸|두었|보냈|드렸|도착했|출발했|받았)/
const REPLY_INDIVIDUAL_CUE = /반려되었|확정되었|확인\s?후\s?(연락|안내|말씀)|확인해\s?보겠|있다가|이따|잠시만|늦어서|늦었|전달\s?드리겠|연락\s?드리겠|\d+\s*번\s*(보관함|무인함)|테스트/
const SYSTEM_PHRASE = /회원\s*본인증명정보|본인증명\s*서류|^상담\s?연결$|업로드했|재업로드/
const GENERIC_HONORIFIC = new Set(['고객', '회원', '담당자', '관리자', '매니저', '선생', '사장', '대표', '직원', '운영자', '사용자', '기사', '업체', '점장', '팀장', '실장', '부장', '과장', '이사', '원장', '손님'])

const FILE_OR_URL = /https?:\/\/\S+|\S+\.(?:jpe?g|png|heic|gif|webp|mp4|mov|pdf)\b|IMG_\d+/gi

function stripAttachments(text: string): string {
  return text.replace(FILE_OR_URL, ' ').replace(/\s+/g, ' ').trim()
}

function contentTokens(text: string): string[] {
  return koreanTokenize(stripAttachments(text).toLowerCase())
    .map((t) => stripTrailingParticle(t))
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOP_TOKENS.has(t))
}

function topicsOf(text: string, extra?: ReadonlySet<string>): Set<string> {
  const lower = text.toLowerCase()
  const found = new Set<string>()
  for (const [group, words] of Object.entries(TOPIC_GROUPS)) {
    if (words.some((w) => lower.includes(w))) found.add(group)
  }
  if (extra) for (const term of extra) if (term.length >= 2 && lower.includes(term.toLowerCase())) found.add(`term:${term}`)
  return found
}

function hasLexicalOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x === y || (Math.min(x.length, y.length) >= 2 && (x.startsWith(y) || y.startsWith(x)))))
}

export function containsPersonalInfo(text: string): boolean {
  // 주소(URL)·날짜·대표번호(1588-1234 등)는 개인정보가 아니므로 검사 전에 뺀다
  const t = text.replace(/https?:\/\/\S+/gi, ' ').replace(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/g, ' ').replace(/\b1[5-8]\d{2}-\d{4}\b/g, ' ')
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) return true
  if (/(?:\+?82[\s-]?)?0?1[0-9][\s.-]?\d{3,4}[\s.-]?\d{4}/.test(t)) return true
  if (/\b0\d{1,2}[\s.-]\d{3,4}[\s.-]\d{4}\b/.test(t)) return true
  if (/\d[\d\s-]{5,}\d/.test(t) && /\d{6,}/.test(t.replace(/[\s-]/g, ''))) return true
  if (/['"‘’“”][^'"‘’“”\s]{2,}['"‘’“”]\s*회원/.test(t)) return true
  if (/(성함|이름|성명)\s*(?:은|는|이|가|:)?\s*[가-힣]{2,4}/.test(t)) return true
  // 도로명: 시·구·군·읍·면·동 같은 지역어가 앞에 있을 때만 주소로 본다('순서대로 2번' 같은 안내 표현 오탐 방지)
  if (/[가-힣]{1,}(?:시|구|군|읍|면|동)\s?[가-힣]{2,}(?:대로|(?<!으)로|길)\s?\d{1,4}(?:-\d+)?(?!\s?[0-9개회시일분원명대%주월년번가지통장건세트종])/.test(t)) return true
  // 지번: 하이픈 번지(정발산동 1173-1) 또는 'N번지'만
  if (/[가-힣]{2,}동\s?\d+(?:-\d+|번지)/.test(t)) return true
  for (const m of t.matchAll(/([가-힣]{2,4})님/g)) {
    const name = m[1] ?? ''
    // '고객님'처럼 일반 호칭이면 통과, 그 외 2~4자 + '님'은 개인 호칭으로 간주
    if (!GENERIC_HONORIFIC.has(name)) return true
  }
  return false
}

export function judgeReplyCandidate(customerMessage: string, adminReply: string, options: JudgeOptions = {}): ReplyCandidateVerdict {
  const customer = (customerMessage ?? '').trim()
  const reply = (adminReply ?? '').trim()
  const out = (reason: ExclusionReason, score = 0): ReplyCandidateVerdict => ({ keep: false, reason, score })

  // 개인정보 검사가 가장 먼저 — 서버가 이 사유일 때만 원문을 보관하지 않으므로 다른 사유에 가려지면 안 된다
  if (containsPersonalInfo(customer) || containsPersonalInfo(reply)) return out('personal_info')
  const customerBody = stripAttachments(customer)
  if (customerBody.replace(/[^가-힣A-Za-z0-9]/g, '').length < 2) return out('attachment_only')
  if (SYSTEM_PHRASE.test(customerBody)) return out('system_phrase')

  const customerTokens = contentTokens(customer)
  if (customerTokens.length === 0) return out('greeting_ack')

  const isQuestion = QUESTION_CUE.test(customerBody)
  if (!isQuestion && COMPLETION_CUE.test(customerBody)) return out('individual_case')
  if (/\d+\s*번\s*(보관함|무인함)/.test(customerBody + reply)) return out('individual_case')

  const replyBody = stripAttachments(reply)
  const replyCoreLength = replyBody.replace(/[^가-힣A-Za-z0-9]/g, '').length
  if (replyCoreLength < 15 || (replyBody.match(/[가-힣]/g) ?? []).length < 5) return out('low_value')
  if (REPLY_INDIVIDUAL_CUE.test(replyBody) && replyCoreLength < 60) return out('individual_case')

  const customerTopics = topicsOf(customerBody, options.extraTopicTerms)
  const replyTopics = topicsOf(replyBody, options.extraTopicTerms)
  const sharedTopic = [...customerTopics].some((g) => replyTopics.has(g))
  if (!hasLexicalOverlap(customerTokens, contentTokens(reply)) && !sharedTopic) return out('pair_mismatch')

  let score = 0
  if (isQuestion) score += 1
  if (customerTopics.size > 0) score += 1
  if (replyTopics.size > 0 || sharedTopic) score += 1
  if (replyCoreLength >= 30) score += 1
  if (POLICY_CUE.test(replyBody)) score += 1
  if (DATE_CUE.test(customerBody)) score -= 1
  if (REPLY_INDIVIDUAL_CUE.test(replyBody)) score -= 2

  return score >= 3 ? { keep: true, reason: null, score } : out('low_value', score)
}
