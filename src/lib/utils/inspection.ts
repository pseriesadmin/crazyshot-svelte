// 반납 검수(2단계, Migration #724) 순수 정의 — 화면(검수 탭)과 서버(검수 API)가 같은 규칙을 쓴다.
// DB 상태값 inspection_status: NULL/'pending'(검수 대기) · 'issue'(이슈 검수중) · 'pass'(통과 완료) · 'resolved'(이슈 해소 후 완료-추가청구)

export type InspectionStatus = 'pending' | 'issue' | 'pass' | 'resolved'

export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  pending: '검수 대기',
  issue: '이슈 검수중',
  pass: '검수 통과',
  resolved: '완료(추가청구)',
}

/** returned 이전에 만들어진 건(NULL)은 검수 대기로 본다 */
export function normalizeInspectionStatus(value: string | null | undefined): InspectionStatus {
  return value === 'issue' || value === 'pass' || value === 'resolved' ? value : 'pending'
}

/** 요구서의 검수 이슈 항목 — key 는 저장값이라 바꾸지 않는다 */
export const INSPECTION_ISSUE_TYPES: { key: string; label: string }[] = [
  { key: 'missing_part', label: '구성품 누락' },
  { key: 'mismatch', label: '구성품 불일치' },
  { key: 'exterior_damage', label: '외관 파손' },
  { key: 'malfunction', label: '작동 이상' },
  { key: 'consumable_lost', label: '소모품 분실' },
]

export const INSPECTION_DETAIL_MAX = 1000
export const INSPECTION_NOTE_MAX = 500
export const INSPECTION_MEDIA_MAX = 10

const TYPE_LABEL = new Map(INSPECTION_ISSUE_TYPES.map((t) => [t.key, t.label] as const))
export function issueTypeLabel(key: string): string {
  return TYPE_LABEL.get(key) ?? key
}

export interface InspectionIssueMediaInput {
  path: string
  kind: 'photo' | 'video'
}

export interface InspectionIssueInput {
  types: string[]
  detail: string
  media: InspectionIssueMediaInput[]
}

/** 증빙 경로 확인은 호출부가 주입한다(서버 전용 returnSubmission.isOwnedEvidencePath) — 이 파일은 브라우저에서도 import 가능하게 순수 유지 */
export function validateIssueInput(
  body: unknown,
  isOwnedPath: (path: string) => boolean,
): { ok: true; value: InspectionIssueInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const rawTypes = Array.isArray(b.types) ? b.types.filter((x): x is string => typeof x === 'string') : []
  const types = [...new Set(rawTypes.filter((k) => TYPE_LABEL.has(k)))]
  if (types.length === 0) return { ok: false, error: '이슈 항목을 1개 이상 선택해 주세요.' }

  const detail = typeof b.detail === 'string' ? b.detail.trim() : ''
  if (detail.length > INSPECTION_DETAIL_MAX) return { ok: false, error: `상세 사유는 ${INSPECTION_DETAIL_MAX}자 이하로 입력해 주세요.` }

  const rawMedia = Array.isArray(b.media) ? b.media : []
  if (rawMedia.length > INSPECTION_MEDIA_MAX) return { ok: false, error: `증빙은 최대 ${INSPECTION_MEDIA_MAX}개까지 첨부할 수 있어요.` }
  const media: InspectionIssueMediaInput[] = []
  for (const m of rawMedia) {
    const o = (m ?? {}) as Record<string, unknown>
    const path = typeof o.path === 'string' ? o.path : ''
    if (!isOwnedPath(path)) return { ok: false, error: '첨부 파일 정보가 올바르지 않아요. 다시 올려 주세요.' }
    media.push({ path, kind: o.kind === 'video' ? 'video' : 'photo' })
  }
  return { ok: true, value: { types, detail, media } }
}

// ── CS 사전 이슈 접수(3단계, Migration #728) ─────────────────────────────────────────
// 고객이 증빙 폼에서 고르는 유형(요구서: 장비 이상/파손/분실). key 는 저장값이라 바꾸지 않는다.
export const PRIOR_ISSUE_KINDS: { key: string; label: string }[] = [
  { key: 'malfunction', label: '장비 이상' },
  { key: 'damage', label: '파손' },
  { key: 'lost', label: '분실' },
]
const PRIOR_KIND_LABEL = new Map(PRIOR_ISSUE_KINDS.map((k) => [k.key, k.label] as const))
export function priorKindLabel(key: string): string {
  return PRIOR_KIND_LABEL.get(key) ?? key
}

export interface PriorIssueReportInput {
  types: string[]
  detail: string
  media: InspectionIssueMediaInput[]
}

/** 고객 증빙 폼 제출 검증 — 증빙 경로 소유 확인은 호출부가 주입한다(순수 유지) */
export function validatePriorReportInput(
  body: unknown,
  isOwnedPath: (path: string) => boolean,
): { ok: true; value: PriorIssueReportInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const rawTypes = Array.isArray(b.types) ? b.types.filter((x): x is string => typeof x === 'string') : []
  const types = [...new Set(rawTypes.filter((k) => PRIOR_KIND_LABEL.has(k)))]
  if (types.length === 0) return { ok: false, error: '이상 유형을 1개 이상 선택해 주세요.' }

  const detail = typeof b.detail === 'string' ? b.detail.trim() : ''
  if (detail.length > INSPECTION_DETAIL_MAX) return { ok: false, error: `상세 내용은 ${INSPECTION_DETAIL_MAX}자 이하로 입력해 주세요.` }

  const rawMedia = Array.isArray(b.media) ? b.media : []
  if (rawMedia.length > INSPECTION_MEDIA_MAX) return { ok: false, error: `사진·영상은 최대 ${INSPECTION_MEDIA_MAX}개까지 올릴 수 있어요.` }
  const media: InspectionIssueMediaInput[] = []
  for (const m of rawMedia) {
    const o = (m ?? {}) as Record<string, unknown>
    const path = typeof o.path === 'string' ? o.path : ''
    if (!isOwnedPath(path)) return { ok: false, error: '올린 파일 정보가 올바르지 않아요. 다시 올려 주세요.' }
    media.push({ path, kind: o.kind === 'video' ? 'video' : 'photo' })
  }
  return { ok: true, value: { types, detail, media } }
}

/** 증빙 폼 토큰 형식(DB 기본값: uuid 두 개를 하이픈 없이 이은 64자 16진수) */
export function isIssueReportToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}
