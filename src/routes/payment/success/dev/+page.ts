// 개발 전용 결제 완료 미리보기 — 실 Toss/DB 호출 없음
// URL 파라미터로 화면 데이터를 직접 주입해 cart → 결제완료 UI 흐름 테스트용

import type { PageLoad } from './$types'

export interface SuccessItem {
  name: string
  code: string
  startDate: string
  endDate: string
  pickupMethod: string
  returnMethod: string
  options: Array<{ name: string; qty: number }>
  price: number
}

export const load: PageLoad = ({ url }) => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const defaultAt = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}·${pad(now.getHours())}:${pad(now.getMinutes())}`

  let items: SuccessItem[] = []
  try {
    const raw = url.searchParams.get('items')
    if (raw) items = JSON.parse(raw) as SuccessItem[]
  } catch { /* 파싱 실패 시 빈 배열 */ }

  // 구 단일상품 파라미터 폴백 (이전 버전 호환)
  if (items.length === 0) {
    items = [{
      name:         url.searchParams.get('productName')  ?? '테스트 상품',
      code:         url.searchParams.get('orderNumber')  ?? 'CZ99999',
      startDate:    url.searchParams.get('startDate')    ?? '',
      endDate:      url.searchParams.get('endDate')      ?? '',
      pickupMethod: '크레이지배송',
      returnMethod: '크레이지배송',
      options:      [],
      price:        Number(url.searchParams.get('subtotal') ?? '0'),
    }]
  }

  return {
    items,
    amount:             Number(url.searchParams.get('amount')             ?? '0'),
    subtotal:           Number(url.searchParams.get('subtotal')           ?? '0'),
    membershipDiscount: Number(url.searchParams.get('membershipDiscount') ?? '0'),
    couponDiscount:     Number(url.searchParams.get('couponDiscount')     ?? '0'),
    deliveryFee:        Number(url.searchParams.get('deliveryFee')        ?? '0'),
    vat:                Number(url.searchParams.get('vat')                ?? '0'),
    pointsUsed:         Number(url.searchParams.get('pointsUsed')         ?? '0'),
    confirmedAt:        url.searchParams.get('confirmedAt')              ?? defaultAt,
    paymentMethod:      url.searchParams.get('paymentMethod')            ?? '카드(테스트)',
    // 쿠폰 지연채번(sequenced 모드)으로 이번 결제에서 실제 발급된 코드 — manual 모드/쿠폰
    // 미사용 시에는 파라미터 자체가 없어 null
    couponCode:         url.searchParams.get('couponCode'),
    // 2026-08-19: 계약서명 완료 전까지는 예약이 confirmed가 아님(service-operations.md §9) —
    // cart 제출 시점에 확정된 건수 < 체크한 건수였으면 true로 전달돼 화면 문구를 조건부 표시
    pendingContract:    url.searchParams.get('pendingContract') === 'true',
    isDev: true,
  }
}
