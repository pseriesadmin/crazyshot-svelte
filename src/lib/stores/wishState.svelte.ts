// 찜 상태 화면 간 공유 — 2026-11-25
// 각 화면(목록·상세·마이페이지 등)은 서버에서 받은 찜 목록을 자기 화면 안의 복사본으로만 들고 있어서,
// 한 화면에서 하트를 눌러도 다른 화면(특히 hover 로 미리 받아 둔 상세 화면 데이터)에는 반영되지 않았다.
// toggleWish 가 성공할 때마다 여기에 "이 상품은 지금 찜/해제"를 기록하고, 하트를 그리는 모든 곳이 서버 값보다 이 값을 우선한다.
// 브라우저에서만 기록한다(서버 렌더링은 요청 사이에 모듈 상태가 공유되므로 절대 쓰지 않는다).
import { browser } from '$app/environment'

const overrides = $state<Record<string, boolean>>({})

/** 찜 토글이 서버에 반영된 직후 호출 — 이후 모든 화면의 하트가 이 값을 따른다 */
export function setWishOverride(productId: string, wished: boolean): void {
  if (!browser || !productId) return
  overrides[productId] = wished
}

/** 하트 표시값 — 이번 접속 중 누른 기록이 있으면 그 값, 없으면 서버가 준 값 */
export function resolveWished(productId: string | undefined | null, serverWished: boolean): boolean {
  if (!productId) return serverWished
  return overrides[productId] ?? serverWished
}
