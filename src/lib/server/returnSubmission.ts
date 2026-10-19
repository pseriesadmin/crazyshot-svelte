// 고객 반납 제출(사진·체크리스트·무인함 정보) 서버 규칙 — Migration #722 (2026-10-17, 1단계)
// 순수 검증·경로 함수만 둔다(DB·스토리지 호출 없음) → 단위 테스트가 쉽고, 고객 API 두 곳(서명·제출)이 같은 규칙을 쓴다.
import { isValidLockerNumber, isValidLockerPassword, LOCKER_NUMBER_ERROR, LOCKER_PASSWORD_ERROR } from '$lib/utils/lockerFields'
import {
  RETURN_CHECKLIST_ITEMS,
  RETURN_MEDIA_ITEMS,
  RETURN_MEDIA_MAX_PER_ITEM,
  RETURN_SUBMIT_RULES,
  toReturnSubmitMethod,
  type ReturnSubmitMethod,
} from '$lib/utils/returnNotice'

export const RETURN_EVIDENCE_BUCKET = 'return-evidence'

/** 제출을 받을 수 있는 예약 상태 — 대여중(최초 제출)·반납요청(재제출) */
export const RETURN_SUBMIT_STATUSES: ReadonlySet<string> = new Set(['in_use', 'return_requested'])

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}
const ALL_EXT = Object.values(MIME_EXT).join('|')

export const RETURN_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const RETURN_VIDEO_MAX_BYTES = 100 * 1024 * 1024

export const RETURN_ACCEPT = Object.keys(MIME_EXT).join(',')

export function mediaKindFromMime(mime: string): 'photo' | 'video' | null {
  if (!(mime in MIME_EXT)) return null
  return mime.startsWith('video/') ? 'video' : 'photo'
}

export function validateMediaFile(mime: string, size: number): { ok: true; kind: 'photo' | 'video' } | { ok: false; error: string } {
  const kind = mediaKindFromMime(mime)
  if (!kind) return { ok: false, error: 'JPEG, PNG, WebP, HEIC 사진 또는 MP4, MOV, WebM 영상만 올릴 수 있어요.' }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: '파일을 확인할 수 없어요.' }
  if (kind === 'photo' && size > RETURN_IMAGE_MAX_BYTES) return { ok: false, error: '사진은 파일당 10MB 이하여야 해요.' }
  if (kind === 'video' && size > RETURN_VIDEO_MAX_BYTES) return { ok: false, error: '영상은 파일당 100MB 이하여야 해요.' }
  return { ok: true, kind }
}

/** 예약 번호 폴더 아래 항목별 경로 — 다른 예약의 경로를 제출에 섞어 넣지 못하게 제출 때 같은 규칙으로 다시 확인한다 */
export function buildEvidencePath(reservationId: number, itemKey: string, mime: string, uuid: string = crypto.randomUUID()): string {
  return `${reservationId}/${itemKey}/${uuid}.${MIME_EXT[mime] ?? 'bin'}`
}

export function isOwnedEvidencePath(path: string, reservationId: number): boolean {
  const re = new RegExp(`^${reservationId}/[a-z_]{1,20}/[0-9a-f-]{36}\\.(${ALL_EXT})$`)
  return re.test(path)
}

export function allowedItemKeys(method: ReturnSubmitMethod): string[] {
  return RETURN_MEDIA_ITEMS[method].map((i) => i.key)
}

export interface ReturnSubmitMediaInput {
  item_key: string
  path: string
  kind: 'photo' | 'video'
}

export interface ReturnSubmitInput {
  checklist: string[]
  locker_number: string | null
  locker_password: string | null
  media: ReturnSubmitMediaInput[]
}

export type ReturnSubmitValidation = { ok: true; value: ReturnSubmitInput } | { ok: false; error: string }

/** 제출 본문 검증 — 방식별 요건(RETURN_SUBMIT_RULES)을 서버에서 다시 집행한다(화면 검증은 UX 보조) */
export function validateReturnSubmit(method: ReturnSubmitMethod, reservationId: number, body: unknown): ReturnSubmitValidation {
  const b = (body ?? {}) as Record<string, unknown>
  const rules = RETURN_SUBMIT_RULES[method]

  // 체크리스트 — 허용 키만, 중복 제거. 택배는 전 항목 확인 필수
  const rawChecklist = Array.isArray(b.checklist) ? b.checklist.filter((x): x is string => typeof x === 'string') : []
  const validKeys = new Set(RETURN_CHECKLIST_ITEMS.map((i) => i.key))
  const checklist = [...new Set(rawChecklist.filter((k) => validKeys.has(k)))]
  if (rules.checklist && checklist.length !== RETURN_CHECKLIST_ITEMS.length) {
    return { ok: false, error: '장비 확인 항목을 모두 체크해 주세요.' }
  }

  // 미디어 — 허용 항목·본인 예약 경로·항목당 장수 상한
  const rawMedia = Array.isArray(b.media) ? b.media : []
  const keys = new Set(allowedItemKeys(method))
  const media: ReturnSubmitMediaInput[] = []
  const perItem = new Map<string, number>()
  for (const m of rawMedia) {
    const o = (m ?? {}) as Record<string, unknown>
    const item_key = typeof o.item_key === 'string' ? o.item_key : ''
    const path = typeof o.path === 'string' ? o.path : ''
    const kind = o.kind === 'video' ? 'video' : 'photo'
    if (!keys.has(item_key)) return { ok: false, error: '올릴 수 없는 사진 항목이에요.' }
    if (!isOwnedEvidencePath(path, reservationId) || !path.startsWith(`${reservationId}/${item_key}/`)) {
      return { ok: false, error: '업로드한 파일 정보가 올바르지 않아요. 다시 올려 주세요.' }
    }
    const n = (perItem.get(item_key) ?? 0) + 1
    if (n > RETURN_MEDIA_MAX_PER_ITEM) return { ok: false, error: `항목당 최대 ${RETURN_MEDIA_MAX_PER_ITEM}장까지 올릴 수 있어요.` }
    perItem.set(item_key, n)
    media.push({ item_key, path, kind })
  }
  if (rules.photosRequired && media.length === 0) return { ok: false, error: '사진을 1장 이상 올려 주세요.' }

  // 무인함 정보 — CMS 입력과 같은 규칙(lockerFields)
  let locker_number: string | null = null
  let locker_password: string | null = null
  if (rules.lockerInfo) {
    locker_number = typeof b.locker_number === 'string' ? b.locker_number.trim() : ''
    locker_password = typeof b.locker_password === 'string' ? b.locker_password.trim() : ''
    if (!isValidLockerNumber(locker_number)) return { ok: false, error: LOCKER_NUMBER_ERROR }
    if (!isValidLockerPassword(locker_password)) return { ok: false, error: LOCKER_PASSWORD_ERROR }
  }

  return { ok: true, value: { checklist, locker_number, locker_password, media } }
}

export { toReturnSubmitMethod }
