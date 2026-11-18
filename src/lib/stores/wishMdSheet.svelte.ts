// 찜 추가 직후 열리는 'MD 추천' 바텀 팝업 — 열림 상태 (전역 1개, 루트 레이아웃에서 렌더링)
export const wishMdSheet = $state({ open: false })

export function openWishMdSheet(): void {
  wishMdSheet.open = true
}

export function closeWishMdSheet(): void {
  wishMdSheet.open = false
}
