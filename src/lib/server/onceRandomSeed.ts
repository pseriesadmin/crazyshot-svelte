import type { Cookies } from '@sveltejs/kit'
import { ONCE_SEED_COOKIE, isValidOnceSeed, newOnceSeed } from '$lib/utils/productListOrder'

/**
 * '1회 랜덤노출' 시드 — 브라우저 세션 쿠키에 한 번만 만들어 두고 이후 방문에서는 그대로 읽는다(브라우저를 닫으면 사라져 다음 방문 때 새로 섞인다).
 * 개인 식별 정보가 아닌 무작위 문자열이며, 설정 중에 '1회 랜덤노출'을 쓰는 목록이 있을 때만 호출한다.
 */
export function resolveOnceSeed(cookies: Cookies, secure: boolean): string {
  const existing = cookies.get(ONCE_SEED_COOKIE)
  if (isValidOnceSeed(existing)) return existing
  const seed = newOnceSeed()
  cookies.set(ONCE_SEED_COOKIE, seed, { path: '/', httpOnly: true, sameSite: 'lax', secure })
  return seed
}
