// 상품 목록 노출 방식(CMS 모달 '노출 방식') 공용 규칙 — 2026-11-13 '1회 랜덤노출' 추가(Stephen 지시).
//   fixed       : 관리자가 정한 순서 그대로
//   random      : 화면에 들어올 때마다(요청마다) 새로 섞음
//   random_once : 방문자 브라우저 세션에서 처음 들어왔을 때만 섞고, 이후 다시 들어와도 같은 순서를 유지
//                 (All 메뉴를 오가며 쓸 때 상품 순서가 매번 바뀌어 불편하던 문제 해소)
// 섞는 기준은 세션 쿠키에 담긴 시드 — 같은 시드면 같은 순서가 나오는 결정적 정렬이다.

export type ProductListMode = 'fixed' | 'random' | 'random_once'

export const ONCE_SEED_COOKIE = 'cs_once_seed'
const SEED_PATTERN = /^[a-z0-9]{6,16}$/

/** 쿠키에서 읽은 시드가 형식에 맞는지(조작된 값이면 새로 발급) */
export function isValidOnceSeed(value: string | undefined | null): value is string {
  return typeof value === 'string' && SEED_PATTERN.test(value)
}

export function newOnceSeed(): string {
  return Math.random().toString(36).slice(2, 12).padEnd(6, '0')
}

// FNV-1a 32비트 — 문자열을 고르게 흩뿌리는 간단한 해시
function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 시드 기준으로 항목을 섞는다. 같은 시드·같은 항목이면 항상 같은 순서이고,
 * 항목이 늘거나 줄어도 남은 항목끼리의 상대 순서는 유지된다. salt 는 목록(예: 'hero', 'md')마다 다르게 섞이도록 하는 값.
 */
export function orderByOnceSeed<T extends { id: string }>(items: T[], seed: string, salt: string): T[] {
  return items
    .map((item) => ({ item, key: hash32(`${seed}:${salt}:${item.id}`) }))
    .sort((a, b) => a.key - b.key || a.item.id.localeCompare(b.item.id))
    .map((x) => x.item)
}
