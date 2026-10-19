// 대여 라이프사이클 상태 전환 규칙 (rental-lifecycle.md nextStatus()/nextLabel() 정본)
// RentalDetailPanel.svelte(/cms/rentals, /cms/reservation)와
// cms/mobile/qr/[product_id](모바일 QR 반출납)이 동일 로직을 공유한다.

export function nextStatus(s: string, pickupMethod?: string | null, returnMethod?: string | null): string | null {
  // 방문 수령: 어드민이 현장 확인 → shipped 단계 스킵, confirmed → in_use 직접 전환
  if (s === 'confirmed' && pickupMethod === 'visit') return 'in_use'
  // 방문 반납: 어드민이 현장 반납 확인 → return_requested 단계 스킵, in_use → returned 직접 전환
  if (s === 'in_use' && returnMethod === 'visit') return 'returned'
  const map: Record<string, string> = {
    confirmed:        'shipped',
    shipped:          'in_use',
    in_use:           'return_requested',
    return_requested: 'returned',
    // returned → completed 는 없다(2026-10-17, Migration #724): 완료는 검수 탭의 [반납 검수 승인]으로만 진행한다
  }
  return map[s] ?? null
}

export function nextLabel(s: string, pickupMethod?: string | null, returnMethod?: string | null): string {
  if (s === 'confirmed') {
    return pickupMethod === 'visit' ? '방문 출고 처리' : '택배 출고 처리'
  }
  if (s === 'shipped') {
    return pickupMethod === 'visit' ? '방문수령 확인' : '택배수령 확인'
  }
  if (s === 'in_use') {
    // 방문 반납: 현장 즉시 반납완료 처리 / 택배·퀵: 고객 채팅 반납접수 후 처리
    return returnMethod === 'visit' ? '방문 반납 처리' : '반납 접수'
  }
  if (s === 'return_requested') {
    // 방식별 운영자 확인 문구(2026-10-17): 택배류는 집하지에서 직접 회수, 무인함은 현장 회수 확인 — 전환 결과(returned)는 그대로
    if (returnMethod === 'locker') return '무인함 회수 확인'
    if (returnMethod === 'epost' || returnMethod === 'delivery' || returnMethod === 'crazydelivery' || returnMethod === 'airport') return '집하지 회수 확인'
    return '반납 처리'
  }
  return '다음 단계'
}
