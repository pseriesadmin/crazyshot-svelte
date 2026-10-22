// 고객 화면 여정 — 반납 안내(푸시·문자) 시각 도달 판정(2026-10-22, Stephen 확정).
// DB claim_return_notice_targets(Migration #736)와 같은 규칙이어야 한다:
//   택배류·방문·미지정: 반납일 당일 09:00 KST 이후 / 퀵·무인보관함: 반납 일시(반납일 + 반납시각, 없거나 형식 오류면 18:00) 3시간 전 이후.
export type ReturnDayState = 'before' | 'reached'

const NOTICE_3H_METHODS = new Set(['quick', 'locker'])

export function isReturnNoticeReached(
  returnMethod: string | null | undefined,
  endDate: string | null | undefined,
  returnTime: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const day = (endDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  let dueMin = 9 * 60
  if (returnMethod && NOTICE_3H_METHODS.has(returnMethod)) {
    const valid = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(returnTime ?? '')
    const [h, m] = valid ? (returnTime as string).split(':').map(Number) : [18, 0]
    dueMin = h * 60 + m - 3 * 60
  }
  // 기준 시각을 KST 분 단위 절대값으로 비교(반납일 00:00 KST + 분)
  const dayStartUtcMs = Date.parse(`${day}T00:00:00+09:00`)
  return now.getTime() >= dayStartUtcMs + dueMin * 60 * 1000
}

/** 대여중(in_use)일 때만 의미가 있다 — 그 밖의 상태는 undefined(스텝퍼가 기존 표시 그대로 사용) */
export function returnDayState(
  status: string,
  endDate: string | null | undefined,
  returnMethod: string | null | undefined,
  returnTime: string | null | undefined,
  now: Date = new Date(),
): ReturnDayState | undefined {
  if (status !== 'in_use') return undefined
  return isReturnNoticeReached(returnMethod, endDate, returnTime, now) ? 'reached' : 'before'
}
