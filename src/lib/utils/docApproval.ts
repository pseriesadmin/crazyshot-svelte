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
  pending: '본인증명정보 승인을 기다려주세요.',
} as const

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
