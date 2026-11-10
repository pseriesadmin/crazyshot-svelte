// dheroSyncNotFound.ts — 두발히어로가 "존재하지 않는 배송건"(404)이라고 답하는 접수번호를 크론이 10분마다 계속 조회하지 않게 하는 순수 규칙 (2026-11-10)
//
// 배경: 접수번호가 두발히어로 서버에 없는 예약(예: Production 테스트 예약 id 335)을 동기화 크론이 10분마다 재조회해 같은 오류 로그가 하루 144건씩 쌓였다.
// 규칙: 연속 NOT_FOUND_CONFIRM_COUNT 번(약 30분) 404 가 나오면 그 건은 NOT_FOUND_SKIP_MS(12시간) 동안 조회를 건너뛰고, 기간이 지나면 한 번 다시 확인한다.
//       일시적 오류·두발히어로 장애로 404 가 한꺼번에 나와도 멈춤이 곧바로 걸리지 않게 확정 횟수를 두었고, 장애 때 자동 전이(배송완료→여정)가 오래 밀리지 않도록 건너뜀은 12시간으로 짧게 둔다(sp3 2026-11-10 권고, Stephen 확정).
//       다시 조회해 성공하면(메타가 상태 응답으로 교체됨) 표시는 저절로 사라진다. 표시는 그 표시를 남긴 접수번호에만 유효하다(접수번호가 바뀌면 낡은 표시는 무시).
// 표시 위치: rental_reservations.dhero_meta 안의 syncNotFoundCount / syncNotFoundAt(ISO) — 기존 취소 표시(canceledAt)와 같은 방식. 컬럼·마이그레이션 변경 없음.

export const NOT_FOUND_CONFIRM_COUNT = 3
export const NOT_FOUND_SKIP_MS = 12 * 60 * 60 * 1000

type Meta = Record<string, unknown> | null | undefined

/** 지금 이 건의 조회를 건너뛰어야 하는지: 404 가 확정(syncNotFoundAt)된 뒤 12시간 이내이고, 표시를 남긴 접수번호가 지금 접수번호(bookId)와 같을 때만. 값이 깨졌거나 접수번호가 바뀌었으면 건너뛰지 않는다(조회 쪽으로 안전). */
export function isNotFoundSkipped(meta: Meta, bookId: string | null | undefined, now: number = Date.now()): boolean {
  const at = meta?.syncNotFoundAt
  if (typeof at !== 'string') return false
  if (!bookId || meta?.syncNotFoundBookId !== bookId) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now - t >= 0 && now - t < NOT_FOUND_SKIP_MS
}

/** 404 를 받았을 때 저장할 메타: 기존 메타를 그대로 두고 연속 횟수를 올리며, 확정 횟수에 이르면 확정 시각을 기록한다. 표시를 남긴 접수번호와 다른 접수번호면 이전 표시(횟수·확정 시각)는 이어받지 않는다. */
export function withNotFoundMark(meta: Meta, bookId: string, now: number = Date.now()): Record<string, unknown> {
  const sameBook = meta?.syncNotFoundBookId === bookId
  const base: Record<string, unknown> = { ...(meta ?? {}) }
  if (!sameBook) {
    delete base.syncNotFoundCount
    delete base.syncNotFoundAt
  }
  const prev = sameBook && typeof meta?.syncNotFoundCount === 'number' && Number.isFinite(meta.syncNotFoundCount) ? meta.syncNotFoundCount : 0
  const count = prev + 1
  const next: Record<string, unknown> = { ...base, syncNotFoundCount: count, syncNotFoundBookId: bookId }
  if (count >= NOT_FOUND_CONFIRM_COUNT) next.syncNotFoundAt = new Date(now).toISOString()
  return next
}
