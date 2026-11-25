// 모바일 서브 GNB 가운데 제목을 화면이 직접 정해야 하는 경우(예: 상품 상세의 상품명) — 화면이 채우고, 떠날 때 비운다 (2026-11-25)
export const mobileSubGnb = $state<{ title: string | null; sub: string | null }>({ title: null, sub: null })
