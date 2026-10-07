// 모바일 하단 탭바 노출 상태 — BottomTabBar가 유일하게 갱신하고, 탭바 위에 떠야 하는 요소(예: /products MD 도크)가 읽는다.
// 두 곳이 각자 스크롤을 추적하면 iOS Safari 스크롤 되튕김에서 판정이 어긋나 탭바 자리가 빈 띠로 남으므로 단일 출처로 통일.
export const tabBarState = $state({ hidden: false })
