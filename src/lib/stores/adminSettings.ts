import { writable } from 'svelte/store'

// SSR isCms 결과를 클라이언트 전역에 공유.
// 보안 gate 아님 — UI 표시 조건 전용.
// 각 페이지 +page.svelte 에서 isCmsMode.set(data.isCms) 호출.
export const isCmsMode = writable<boolean>(false)
