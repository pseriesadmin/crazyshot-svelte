// 개발 전용 결제 완료 미리보기 — 실 Toss/DB 호출 없음
// URL 파라미터로 화면 데이터를 직접 주입해 checkout → 결제완료 UI 흐름 테스트용

import type { PageLoad } from './$types'

export const load: PageLoad = ({ url }) => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const defaultAt = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}·${pad(now.getHours())}:${pad(now.getMinutes())}`

  return {
    productName:     url.searchParams.get('productName')    ?? '테스트 상품',
    orderNumber:     url.searchParams.get('orderNumber')    ?? 'CZ99999',
    startDate:       url.searchParams.get('startDate')      ?? '',
    endDate:         url.searchParams.get('endDate')        ?? '',
    amount:          Number(url.searchParams.get('amount')  ?? '0'),
    confirmedAt:     url.searchParams.get('confirmedAt')    ?? defaultAt,
    paymentMethod:   url.searchParams.get('paymentMethod')  ?? '카드(테스트)',
    specialRequests: url.searchParams.get('notes')          ?? '',
    isDev: true,
  }
}
