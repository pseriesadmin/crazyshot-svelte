/**
 * holdContractTimer.ts — 예약신청(hold)의 "전자계약 발송 후 서명·결제 제한 시간" 잔여 계산 (CMS 예약목록 표시용)
 *
 * 정책 정본: DB 함수 release_reservation_hold()(Migration 453/676) — 계약서 발송 시각(contract_signings.sent_at)으로부터
 * 1시간 안에 서명·결제를 마치지 않으면 pg_cron이 hold를 expired로 만든다. 계약서가 발송되지 않았거나 결제가 끝난 hold에는 타이머가 없다.
 * ⚠️ 이 상수는 화면 표시용 사본이다 — DB 제한 시간을 바꾸면(마이그레이션) 반드시 함께 바꿀 것(holdContractTimer.test.ts가 DB 함수 정의와 대조).
 */
export const CONTRACT_SIGN_TIMEOUT_MS = 60 * 60 * 1000

/** 잔여 시간이 이 값(10분) 이하이면 "임박" — 화면에서 레드 계열로 강조한다. */
export const CONTRACT_SIGN_URGENT_SECONDS = 10 * 60

export interface HoldTimerRow {
  status: string
  signing_sent_at: string | null
  payment_confirmed_at: string | null
}

/**
 * 만료까지 남은 밀리초. 타이머가 없거나(발송 전·결제 완료·hold 아님) 이미 끝났으면 null — 호출부는 null이면 표시하지 않는다.
 * 크론이 1분 간격이라 만료 직전~직후 최대 약 1분은 화면과 실제 상태가 어긋날 수 있다.
 */
export function contractSignRemainingMs(row: HoldTimerRow, nowMs: number): number | null {
  if (row.status !== 'hold' || !row.signing_sent_at || row.payment_confirmed_at) return null
  const sent = new Date(row.signing_sent_at).getTime()
  if (!Number.isFinite(sent)) return null
  const remainingMs = sent + CONTRACT_SIGN_TIMEOUT_MS - nowMs
  return remainingMs > 0 ? remainingMs : null
}

/** 만료까지 남은 분(올림). 1분 미만이 남았으면 1(0분 표기 방지). 없거나 종료면 null. */
export function contractSignRemainingMinutes(row: HoldTimerRow, nowMs: number): number | null {
  const ms = contractSignRemainingMs(row, nowMs)
  return ms === null ? null : Math.ceil(ms / 60_000)
}

/** 만료까지 남은 초(올림) — 실시간 카운트다운 표시용. 없거나 종료면 null. */
export function contractSignRemainingSeconds(row: HoldTimerRow, nowMs: number): number | null {
  const ms = contractSignRemainingMs(row, nowMs)
  return ms === null ? null : Math.ceil(ms / 1000)
}

/** 남은 초가 임박 기준(10분) 이하인가 — 정확히 10:00도 임박으로 본다. */
export function isContractSignUrgent(remainingSeconds: number): boolean {
  return remainingSeconds <= CONTRACT_SIGN_URGENT_SECONDS
}

/** 남은 초 → "분:초"(예: 3599 → "59:59", 61 → "01:01", 5 → "00:05"). 60분 이상은 "60:00". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
