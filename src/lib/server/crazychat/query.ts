// query.ts — 크레이지챗 조회형(읽기 전용) 순수 로직 (서버 전용)
//
// 고객이 "내 예약 상태 알려줘"처럼 본인 정보의 현재 상태를 물으면, DB에서 읽은 값을 "정해진 문장 틀"에 채워 답한다.
//   · 허용 항목은 4가지뿐: 예약 진행 단계 · 반납 예정일 · 서류 승인 단계 · 결제 완료 여부(Stephen 확정 2026-10-07).
//   · 금액·카드·연락처·주소·타인 정보는 어떤 경우에도 답변에 넣지 않는다(질문에 나오면 조회 자체를 하지 않는다).
//   · 사람 전용 주제(환불·취소·파손 등)가 섞이면 조회하지 않는다(topics.ts).
//   · 의도 판정은 규칙(키워드)만 사용한다 — LLM이 값을 만들지 않으므로 환각이 있을 수 없다.
//   · 이 파일은 DB를 읽지 않는다(순수 함수). 읽기·권한은 agent.ts가 "세션 소유자 user_id"로만 수행한다.

import { getDocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { detectHumanOnlyTopic } from './topics'

export type QueryIntent = 'reservation_status' | 'return_date' | 'doc_status' | 'payment_status'

/** 조회에 쓰는 예약 컬럼은 이것뿐(금액·주소·연락처·메모·운송장 등은 아예 읽지 않는다). */
export const RESERVATION_QUERY_COLUMNS = 'id, reservation_code, status, start_date, end_date, return_time, payment_confirmed_at, created_at'

/** 서류 조회에 쓰는 프로필 컬럼(서류 파일 경로 배열은 "등록 여부 판정"에만 쓰고 답변에 싣지 않는다). */
export const PROFILE_QUERY_COLUMNS =
  'identity_doc_url, identity_type, identity_verified_at, identity_approved_at, foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at'

export interface ReservationRowForQuery {
  id: number
  reservation_code: string | null
  status: string
  start_date: string | null
  end_date: string | null
  return_time: string | null
  payment_confirmed_at: string | null
  created_at: string
}

export const MAX_QUESTION_LENGTH = 300
const MAX_GROUPS_IN_REPLY = 3
/** 반납·종료된 예약을 "진행 목록"에 계속 보여주는 기간(일) */
const FINISHED_VISIBLE_DAYS = 14

// 허용 밖 정보(금액·결제수단·연락처·주소·혜택)를 묻는 질문은 조회하지 않는다.
export const OUT_OF_SCOPE_RE = /금액|가격|요금|얼마|카드|연락처|전화|주소|계좌|포인트|쿠폰|할인|보증금|이메일|비밀\s?번호|주민|통장/
// 방법·안내를 묻는 질문은 조회가 아니라 빠른답변 영역이다.
export const HOW_TO_RE = /방법|어떻게\s?(하|해|올|등록|신청|예약|결제|반납|제출|받)|어디서|어디에|어디로|뭐가\s?필요|필요한가|꼭\s|해야/

export function classifyQueryIntent(message: string | null | undefined): QueryIntent | null {
  if (typeof message !== 'string') return null
  const m = message.trim()
  if (!m || m.length > MAX_QUESTION_LENGTH) return null
  if (detectHumanOnlyTopic(m)) return null
  if (OUT_OF_SCOPE_RE.test(m)) return null
  if (HOW_TO_RE.test(m)) return null
  // 예약번호를 말한 것 같은데 번호로 인식되지 않으면(형식 불명) 엉뚱한 본인 예약으로 답하지 않고 넘긴다
  if (/예약\s?(번호|코드)|주문\s?번호/.test(m) && extractAllReservationCodes(m).length === 0 && /\d{3,}/.test(m)) return null

  if (/반납/.test(m) && /언제|며칠|몇\s?일|몇\s?시|날짜|일정|예정|기한|마감|까지/.test(m) && !/지연|늦|연체|연장/.test(m)) return 'return_date'
  if (/서류|등본|신분증|본인\s?증명|본인\s?인증|인증/.test(m) && /승인|됐|되었|됬|완료|상태|심사|검토|언제|확인/.test(m)) return 'doc_status'
  if (/예약|대여|신청/.test(m) && /상태|확인|조회|됐|되었|됬|진행|단계|확정|승인|완료/.test(m)) return 'reservation_status'
  if (/결제/.test(m) && /됐|되었|됬|완료|확인|상태|여부|처리/.test(m)) return 'payment_status'
  return null
}

/**
 * 예약번호처럼 보이는 값을 대문자로 통일해 반환. 없으면 null.
 * 실제 번호 형식이 시기별로 다르다(CS2608475·CS26081012·CS260910352·CSREV260700001·CZ-20260716-00009 …) —
 * 형식을 하나로 단정하지 않고 "영문 2~8자(+하이픈) + 숫자 6자리 이상(+하이픈 숫자)" 모양이면 번호로 본다.
 * 번호로 보이는데 본인 예약 목록에 없으면 호출부가 "확인할 수 없음"으로 처리해야 한다(다른 사람의 번호일 수 있다).
 */
const CODE_RE = /(?<![A-Za-z0-9])([A-Za-z]{2,8}[-\s]?\d{6,}(?:-\d{3,})?)(?![A-Za-z0-9])/g

/** 질문 속 예약번호 모양을 모두 찾아 대문자·공백 제거로 통일(중복 제거). */
export function extractAllReservationCodes(message: string | null | undefined): string[] {
  if (typeof message !== 'string') return []
  const out: string[] = []
  for (const m of message.matchAll(CODE_RE)) {
    const c = m[1].replace(/\s+/g, '').toUpperCase()
    if (!out.includes(c)) out.push(c)
  }
  return out
}

export function extractReservationCode(message: string | null | undefined): string | null {
  return extractAllReservationCodes(message)[0] ?? null
}

// ── 예약 묶음(주문 단위) ──────────────────────────────────────────────────────────
const STAGE_ORDER = ['pending', 'hold', 'confirmed', 'shipped', 'in_use', 'damage_claimed', 'return_requested', 'returned', 'completed'] as const
const INACTIVE = new Set(['cancelled', 'expired'])
const FINISHED = new Set(['returned', 'completed'])

export interface ReservationGroup {
  code: string | null
  stage: string
  mixed: boolean
  paymentConfirmed: boolean
  endDate: string | null
  returnTime: string | null
  createdAt: string
}

const stageIndex = (s: string): number => {
  const i = (STAGE_ORDER as readonly string[]).indexOf(s)
  return i < 0 ? 0 : i
}

/**
 * 본인 예약 행(호출부가 user_id로 이미 거른 것)을 주문(예약코드) 단위로 묶는다.
 * requestedCode를 주면 그 코드의 묶음만(취소·종료 포함), 본인 목록에 없으면 빈 배열 — 존재 여부를 드러내지 않는다.
 * 안 주면 진행 중인 묶음 + 최근(14일) 종료 묶음만 최근 생성순으로.
 */
export function groupReservations(
  rows: readonly ReservationRowForQuery[],
  requestedCode?: string | null,
  now: Date = new Date(),
): ReservationGroup[] {
  const buckets = new Map<string, ReservationRowForQuery[]>()
  for (const r of rows) {
    const key = r.reservation_code ? r.reservation_code.toUpperCase() : `#${r.id}`
    const list = buckets.get(key)
    if (list) list.push(r)
    else buckets.set(key, [r])
  }

  const wanted = requestedCode ? requestedCode.toUpperCase() : null
  const cutoff = new Date(now.getTime() - FINISHED_VISIBLE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const groups: ReservationGroup[] = []

  for (const [key, list] of buckets) {
    if (wanted && key !== wanted) continue
    const active = list.filter((r) => !INACTIVE.has(r.status))
    const createdAt = list.map((r) => r.created_at).sort().at(-1) ?? ''

    if (active.length === 0) {
      if (!wanted) continue
      const latest = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)
      groups.push({ code: list[0].reservation_code, stage: latest?.status ?? 'cancelled', mixed: false, paymentConfirmed: false, endDate: null, returnTime: null, createdAt })
      continue
    }

    const stages = new Set(active.map((r) => r.status))
    const lowest = [...stages].sort((a, b) => stageIndex(a) - stageIndex(b))[0]
    const endRow = [...active].sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? '')).at(-1)
    const endDate = endRow?.end_date ?? null

    if (!wanted && FINISHED.has(lowest) && (endDate ?? '') < cutoff) continue

    groups.push({
      code: list[0].reservation_code,
      stage: lowest,
      mixed: stages.size > 1,
      paymentConfirmed: active.every((r) => !!r.payment_confirmed_at),
      endDate,
      returnTime: endRow?.return_time ?? null,
      createdAt,
    })
  }

  return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ── 문장 틀 ───────────────────────────────────────────────────────────────────────
const STAGE: Record<string, { name: string; hint?: string }> = {
  pending: { name: '예약 접수' },
  hold: { name: '예약 신청 접수', hint: '담당자가 확인한 뒤 계약서·서류·결제 링크를 보내 드려요.' },
  confirmed: { name: '계약 완료' },
  shipped: { name: '장비 반출 중' },
  in_use: { name: '대여 중' },
  damage_claimed: { name: '담당자 확인 중' },
  return_requested: { name: '반납 접수' },
  returned: { name: '반납 완료' },
  completed: { name: '대여 종료' },
  cancelled: { name: '취소' },
  expired: { name: '만료' },
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const FOOTER = '\n\n자세한 내용은 마이페이지 > 렌탈내역에서 확인할 수 있어요.'

function label(g: ReservationGroup): string {
  return g.code ? `예약 ${g.code}` : '예약'
}

function formatDate(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const wd = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  return `${mo}월 ${d}일(${wd})`
}

function paymentSentence(g: ReservationGroup): string {
  if (g.stage === 'cancelled' || g.stage === 'expired') return ''
  return g.paymentConfirmed ? '결제는 완료됐어요.' : '결제는 아직 확인되지 않았어요.'
}

function lineFor(intent: QueryIntent, g: ReservationGroup): string {
  const st = STAGE[g.stage] ?? { name: '확인 중' }
  const mixed = g.mixed ? ' (상품별로 진행 단계가 조금 달라요.)' : ''
  switch (intent) {
    case 'reservation_status':
      return [`${label(g)}: 현재 '${st.name}' 상태예요.${mixed}`, st.hint, paymentSentence(g)].filter(Boolean).join(' ')
    case 'payment_status': {
      const p = paymentSentence(g)
      return `${label(g)}: ${p || `현재 '${st.name}' 상태예요.`}`
    }
    case 'return_date': {
      if (FINISHED.has(g.stage)) return `${label(g)}: 이미 반납이 완료됐어요.`
      if (g.stage === 'cancelled' || g.stage === 'expired') return `${label(g)}: 현재 '${st.name}' 상태예요.`
      const date = formatDate(g.endDate)
      if (!date) return `${label(g)}: 반납 예정일은 담당자가 확인한 뒤 안내해 드려요.`
      const time = g.returnTime ? ` ${g.returnTime.slice(0, 5)}` : ''
      return `${label(g)}: 반납 예정일은 ${date}${time}이에요.`
    }
    default:
      return ''
  }
}

/** 예약 조회 답변. 해당 묶음이 없으면 null(호출부가 대기 안내로 처리). doc_status는 buildDocStatusReply 사용. */
export function buildQueryReply(intent: QueryIntent, groups: readonly ReservationGroup[]): string | null {
  if (intent === 'doc_status' || groups.length === 0) return null
  const shown = groups.slice(0, MAX_GROUPS_IN_REPLY)
  const lines = shown.map((g) => lineFor(intent, g)).filter(Boolean)
  if (lines.length === 0) return null
  const rest = groups.length - shown.length
  const more = rest > 0 ? `\n외 ${rest}건의 예약이 더 있어요.` : ''
  return lines.join('\n') + more + FOOTER
}

/** 서류 승인 단계 답변. 프로필이 없으면(비회원 등) null. */
export function buildDocStatusReply(profile: DocGateRow | null | undefined): string | null {
  if (!profile) return null
  const status = getDocGateStatus(profile)
  if (status === 'approved') return '서류 승인이 완료되었어요. 이제 예약을 진행하실 수 있어요.'
  if (status === 'pending') return '서류를 확인하는 중이에요. 조금만 기다려 주세요.'
  return '아직 필수 서류가 모두 등록되지 않았어요. 마이페이지에서 서류를 등록해 주세요.'
}
