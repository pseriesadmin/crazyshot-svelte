// 본인증명·외국인증명 등록/승인 게이트 판정 (2026-10-02)
// 예약신청 전 단계: 'none'(서류 미등록) → 'pending'(등록했으나 관리자 승인 대기) → 'approved'(승인 완료)
// 승인 판정식은 migration #526과 동일 — 승인시각이 있고 제출시각 이후여야 승인(승인 후 재제출 시 다시 대기).
// 본인증명·외국인증명 중 하나라도 승인되면 통과한다.

export type DocGateStatus = 'none' | 'pending' | 'approved'

// 필수 파일 조합 (2026-10-02, Stephen 확정) — 하나라도 누락되면 "등록되지 않음"으로 본다.
//   본인증명: (주민등록증 또는 운전면허증) + 주민등록등본
//   외국인증명: 체류 유형별 증명서 4종 전부(Migration #495 — 4종 완료 시에만 제출 완료 시각이 기록돼 CMS 승인 가능)
//     단기: 여권사진면·숙소예약확인서·입국 E-Ticket·출국 E-Ticket / 장기: 외국인등록증 앞면·뒷면·여권사진면·외국인사실증명서
export const FOREIGN_SHORT_REQUIRED = ['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'] as const
export const FOREIGN_LONG_REQUIRED = ['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'] as const

export function identityRequiredMet(types: readonly string[] | null | undefined): boolean {
  const t = types ?? []
  return (t.includes('resident') || t.includes('driver')) && t.includes('resident_copy')
}

export function foreignRequiredMet(types: readonly string[] | null | undefined): boolean {
  const t = types ?? []
  return FOREIGN_SHORT_REQUIRED.every(x => t.includes(x)) || FOREIGN_LONG_REQUIRED.every(x => t.includes(x))
}

export interface DocGateRow {
  identity_doc_url?: string[] | null
  identity_type?: string[] | null
  identity_verified_at?: string | null
  identity_approved_at?: string | null
  foreign_doc_url?: string | null
  foreign_doc_urls?: string[] | null
  foreign_type?: string[] | null
  foreign_verified_at?: string | null
  foreign_approved_at?: string | null
}

export const DOC_GATE_MESSAGES = {
  none: '본인증명정보를 등록해주세요.',
  pending: '본인증명정보를 승인 중입니다. 조금만 기다려 주세요.',
} as const

// 등록 직후 "빠진 서류" 안내용 이름(2026-10-05) — 서버(upload-doc 응답 missing)·화면이 같은 헬퍼를 쓴다.
export const DOC_TYPE_LABELS: Record<string, string> = {
  resident: '주민등록증',
  driver: '운전면허증',
  resident_copy: '주민등록등본',
  passport_photo: '여권사진면',
  accommodation_reservation: '숙소예약확인서',
  entry_eticket: '입국 E-Ticket',
  exit_eticket: '출국 E-Ticket',
  arc_front: '외국인등록증 앞면',
  arc_back: '외국인등록증 뒷면',
  foreign_fact_cert: '외국인사실증명서',
}

/** 본인증명에서 아직 등록되지 않은 필수 서류 이름 목록(충족이면 빈 배열). 신분증은 주민등록증·운전면허증 중 하나면 된다. */
export function missingIdentityDocs(types: readonly string[] | null | undefined): string[] {
  const t = types ?? []
  const missing: string[] = []
  if (!t.includes('resident') && !t.includes('driver')) missing.push('주민등록증(또는 운전면허증)')
  if (!t.includes('resident_copy')) missing.push(DOC_TYPE_LABELS.resident_copy)
  return missing
}

/**
 * 외국인증명에서 아직 등록되지 않은 필수 서류 이름 목록(충족이면 빈 배열).
 * 체류 유형은 이미 등록된 서류로 먼저 판별(장기 전용 서류가 있으면 장기, 단기 전용이 있으면 단기)하고,
 * 공통 서류(여권사진면)만 있거나 비어 있으면 stayType(기본 단기)을 따른다.
 */
export function missingForeignDocs(
  types: readonly string[] | null | undefined,
  stayType?: string | null,
): string[] {
  const t = types ?? []
  const hasLongOnly = ['arc_front', 'arc_back', 'foreign_fact_cert'].some(x => t.includes(x))
  const hasShortOnly = ['accommodation_reservation', 'entry_eticket', 'exit_eticket'].some(x => t.includes(x))
  const long = hasLongOnly ? true : hasShortOnly ? false : stayType === 'long'
  const required = long ? FOREIGN_LONG_REQUIRED : FOREIGN_SHORT_REQUIRED
  return required.filter(x => !t.includes(x)).map(x => DOC_TYPE_LABELS[x])
}

function hasFinalConsonant(word: string): boolean {
  const ch = word.trim().slice(-1)
  if (!ch) return false
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
  return false // 한글이 아니면(예: 'E-Ticket') 받침 없음으로 간주 — 구어체에서 "를"이 자연스럽다
}

/** "A, B를 추가 등록해주세요." — 마지막 항목의 받침에 맞춰 을/를 선택 */
export function buildMissingDocsMessage(labels: readonly string[]): string {
  if (labels.length === 0) return ''
  const last = labels[labels.length - 1]
  const particle = hasFinalConsonant(last.replace(/\(.*\)$/, '')) ? '을' : '를'
  return `${labels.join(', ')}${particle} 추가 등록해주세요.`
}

function isApproved(verifiedAt: string | null | undefined, approvedAt: string | null | undefined): boolean {
  if (!approvedAt) return false
  return !verifiedAt || approvedAt >= verifiedAt
}

// 필수 파일을 모두 갖춘 증명만 "등록됨"으로 인정 → 그중 하나라도 승인되면 approved, 아니면 pending.
// 필수 파일을 갖춘 증명이 하나도 없으면(일부만 등록 포함) none — 승인 여부와 무관하게 등록 안내로 차단.
export function getDocGateStatus(row: DocGateRow | null | undefined): DocGateStatus {
  if (!row) return 'none'
  const identityOk = (row.identity_doc_url?.length ?? 0) > 0 && identityRequiredMet(row.identity_type)
  const foreignOk = ((row.foreign_doc_urls?.length ?? 0) > 0 || !!row.foreign_doc_url) && foreignRequiredMet(row.foreign_type)
  if (!identityOk && !foreignOk) return 'none'
  if (identityOk && isApproved(row.identity_verified_at, row.identity_approved_at)) return 'approved'
  if (foreignOk && isApproved(row.foreign_verified_at, row.foreign_approved_at)) return 'approved'
  return 'pending'
}

/**
 * 서류 등록 화면으로 보낼 때 열 탭(2026-10-05) — 외국인증명만 등록(또는 시작)한 고객은 foreign, 그 외는 identity.
 * 예약 차단 토스트 [확인]이 항상 본인증명 탭으로만 가던 문제(외국인 고객이 엉뚱한 탭에 도착) 해소.
 */
export function docLandingKind(row: DocGateRow | null | undefined): 'identity' | 'foreign' {
  if (!row) return 'identity'
  const hasIdentity = (row.identity_type?.length ?? 0) > 0 || (row.identity_doc_url?.length ?? 0) > 0
  const hasForeign = (row.foreign_type?.length ?? 0) > 0 || (row.foreign_doc_urls?.length ?? 0) > 0 || !!row.foreign_doc_url
  return hasForeign && !hasIdentity ? 'foreign' : 'identity'
}
