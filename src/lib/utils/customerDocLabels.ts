// 본인증명·외국인증명 표시 라벨·날짜 규칙 — 고객 관리 패널과 예약 패널 고객정보 탭이 같은 규칙을 쓴다(2026-10-15, CustomerDocRows.svelte).
export const IDENTITY_TYPE_LABELS: Record<string, string> = {
  student: '학생증', enrollment: '재학증명서', resident: '주민등록증', resident_copy: '주민등록등본',
  driver: '운전면허증', other: '기타 증명', general: '일반 증명',
}

export const FOREIGN_STAY_LABELS: Record<string, string> = {
  short: '단기체류(90일 내)', long: '장기체류(90일 이상)',
}

export const FOREIGN_TYPE_LABELS: Record<string, string> = {
  passport_photo: '여권사진면', accommodation_reservation: '숙소예약확인서',
  entry_eticket: '입국 E-Ticket', exit_eticket: '출국 E-Ticket',
  arc_front: '외국인등록증 앞면', arc_back: '외국인등록증 뒷면', foreign_fact_cert: '외국인사실증명서',
}

export function identityTypeLabel(types: string[] | null | undefined): string {
  if (!types || types.length === 0) return '일반 증명'
  return types.map(t => IDENTITY_TYPE_LABELS[t] ?? '증명서').join(', ')
}

// identity_type[i]는 identity_doc_url[i]와 항상 같은 인덱스(슬롯형 업로드)
export function identityFileLabel(types: string[] | null | undefined, i: number, count: number): string {
  const t = types?.[i]
  if (t) return IDENTITY_TYPE_LABELS[t] ?? '증명서'
  return count > 1 ? `파일 ${i + 1}` : '파일'
}

export function foreignTypeLabel(stayType: string | null | undefined, types: string[] | null | undefined): string {
  const stay = stayType ? (FOREIGN_STAY_LABELS[stayType] ?? stayType) : null
  const label = types && types.length > 0 ? types.map(t => FOREIGN_TYPE_LABELS[t] ?? '증명서').join(', ') : '외국인증명'
  return stay ? `${stay} · ${label}` : label
}

export function foreignFileLabel(types: string[] | null | undefined, i: number, count: number): string {
  const t = types?.[i]
  if (t) return FOREIGN_TYPE_LABELS[t] ?? '증명서'
  return count > 1 ? `파일 ${i + 1}` : '파일'
}

export function formatDocDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export function isDocExpired(iso: string): boolean {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  return new Date(iso) < sixMonthsAgo
}

// 제출은 됐는데(verified_at) 아직 승인 안 됐거나 승인 후 재제출된 경우 — 승인 대기
export function needsDocApproval(verifiedAt: string | null | undefined, approvedAt: string | null | undefined): boolean {
  if (!verifiedAt) return false
  if (!approvedAt) return true
  return new Date(approvedAt) < new Date(verifiedAt)
}
