// 'MD 추천' 바텀 팝업 — 열림 상태 (전역 1개, 루트 레이아웃에서 렌더링)
//   requested : 찜 추가(wish)·예약신청(reserve)이 열기를 요청한 계기. 팝업은 MD 추천 설정의 '노출조건'(찜/예약 ON·OFF)을 확인한 뒤
//               허용될 때만 open 이 된다(허용되지 않으면 요청만 지우고 열지 않음).
//   open      : 실제로 화면에 보이는 상태
import type { MdPopupTrigger } from '$lib/utils/mdPopupCondition'

export const wishMdSheet = $state<{ open: boolean; requested: MdPopupTrigger | null }>({ open: false, requested: null })

export function openWishMdSheet(trigger: MdPopupTrigger = 'wish'): void {
  wishMdSheet.requested = trigger
}

export function closeWishMdSheet(): void {
  wishMdSheet.open = false
  wishMdSheet.requested = null
}
