/**
 * 포인트 적립 규칙 입력값 해석 (CMS 적립 규칙 설정).
 * 화면은 적립률을 % 단위로 입력받고(3 = 3%), DB·지급 계산은 소수로 저장한다(0.03).
 * 화면 검증을 우회한 요청도 여기서 막는다 — DB 함수(update_point_earn_rule, Migration #850)가 같은 범위를 한 번 더 검사한다.
 */

export type EarnRuleInput =
  | { ok: true; amount: number; rate: number }
  | { ok: false; error: string }

/** DB 저장 소수(0.03)를 입력칸·표시용 % 문자열(3)로 바꾼다 — 부동소수 잡음 없이 소수 둘째 자리까지 */
export function rateToPercentText(rate: number): string {
  if (!Number.isFinite(rate)) return '0'
  return String(Number((rate * 100).toFixed(2)))
}

/** % 문자열(3)을 DB 저장 소수(0.03)로 바꾼다. 소수 둘째 자리까지만 의미가 있다(DB 4자리 소수). */
export function percentToRate(percent: number): number {
  return Math.round(percent * 100) / 10000
}

export function parseEarnRuleInput(amountRaw: unknown, percentRaw: unknown): EarnRuleInput {
  const amountText = String(amountRaw ?? '').trim()
  const percentText = String(percentRaw ?? '').trim()
  if (amountText === '' || percentText === '') {
    return { ok: false, error: '고정 적립 금액과 적립률을 모두 입력해 주세요. 없으면 0을 입력하세요.' }
  }
  const amount = Number(amountText)
  if (!Number.isInteger(amount) || amount < 0) {
    return { ok: false, error: '고정 적립은 0 이상의 정수(P)여야 합니다.' }
  }
  const percent = Number(percentText)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: '적립률은 0~100 사이의 %여야 합니다. 3%는 3으로 입력하세요.' }
  }
  return { ok: true, amount, rate: percentToRate(percent) }
}
