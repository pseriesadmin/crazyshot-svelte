// 반납정보 관리자 직접 등록(Migration #737, 2026-10-22 — 방문·택배·퀵·무인함 등 모든 반납 방식) 서버 규칙 — 순수 검증 함수만(DB·스토리지 호출 없음)
// 등록 API·서명 API 가 같은 규칙을 쓴다. 사진 경로는 {예약}/admin/ 폴더만 인정한다.
import { RETURN_CHECKLIST_ITEMS } from '$lib/utils/returnNotice'
import { INSPECTION_MEDIA_MAX, INSPECTION_NOTE_MAX } from '$lib/utils/inspection'
import { isOwnedEvidencePath } from '$lib/server/returnSubmission'

/** 등록할 수 있는 예약 상태 — 대여중(등록 시 반납중으로 전환)·반납요청·반납완료(검수 중 보완 등록) */
export const ADMIN_RETURN_STATUSES: ReadonlySet<string> = new Set(['in_use', 'return_requested', 'returned'])
export const ADMIN_RETURN_FOLDER = 'admin'

export interface AdminReturnEntryInput {
  memo: string | null
  checklist: string[]
  media: { path: string; kind: 'photo' | 'video' }[]
}

export type AdminReturnEntryValidation = { ok: true; value: AdminReturnEntryInput } | { ok: false; error: string }

export function validateAdminReturnEntry(
  reservationId: number,
  body: unknown,
  checklistItems: { key: string }[] = RETURN_CHECKLIST_ITEMS,
): AdminReturnEntryValidation {
  const b = (body ?? {}) as Record<string, unknown>

  const memoRaw = typeof b.memo === 'string' ? b.memo.trim() : ''
  if (memoRaw.length > INSPECTION_NOTE_MAX) return { ok: false, error: `메모는 ${INSPECTION_NOTE_MAX}자 이하로 입력해 주세요.` }

  const validKeys = new Set(checklistItems.map((i) => i.key))
  const rawChecklist = Array.isArray(b.checklist) ? b.checklist.filter((x): x is string => typeof x === 'string') : []
  const checklist = [...new Set(rawChecklist.filter((k) => validKeys.has(k)))]

  const rawMedia = Array.isArray(b.media) ? b.media : []
  if (rawMedia.length > INSPECTION_MEDIA_MAX) return { ok: false, error: `사진·영상은 최대 ${INSPECTION_MEDIA_MAX}개까지 올릴 수 있어요.` }
  const media: AdminReturnEntryInput['media'] = []
  for (const m of rawMedia) {
    const o = (m ?? {}) as Record<string, unknown>
    const path = typeof o.path === 'string' ? o.path : ''
    const kind = o.kind === 'video' ? 'video' : 'photo'
    if (!isOwnedEvidencePath(path, reservationId) || !path.startsWith(`${reservationId}/${ADMIN_RETURN_FOLDER}/`)) {
      return { ok: false, error: '업로드한 파일 정보가 올바르지 않아요. 다시 올려 주세요.' }
    }
    media.push({ path, kind })
  }

  if (media.length === 0 && !memoRaw) return { ok: false, error: '사진을 올리거나 메모를 입력해 주세요.' }

  return { ok: true, value: { memo: memoRaw || null, checklist, media } }
}
