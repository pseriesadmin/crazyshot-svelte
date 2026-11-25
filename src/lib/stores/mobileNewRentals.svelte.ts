// 모바일 현장앱 '대여 목록' 플로팅 아이콘의 당일 신규 건수(2026-11-25) — /cms/mobile 레이아웃이 갱신하고 두 화면의 아이콘이 읽는다
export const mobileNewRentals = $state<{ count: number }>({ count: 0 })

export async function refreshMobileNewRentals(): Promise<void> {
  try {
    const res = await fetch('/api/cms/mobile-new-count')
    if (!res.ok) return
    const body = (await res.json()) as { count?: number }
    mobileNewRentals.count = typeof body.count === 'number' ? body.count : 0
  } catch {
    // 네트워크 오류는 직전 값 유지
  }
}
