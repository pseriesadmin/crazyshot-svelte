/**
 * /api/cms/mobile-search-rank
 * CMS 모바일(/cms/mobile) 상품 검색 — NLSearch(자연어검색엔진) 랭킹 조회 전용
 * GET ?q=검색어 → 관련도 순 상품 id 배열 반환
 *
 * 실제 필터링(초성·품번 매칭)은 클라이언트의 chosungSearch가 그대로 담당하고,
 * 이 엔드포인트는 필터링된 결과의 "정렬 순서(관련도)"만 보강한다 — nlsearch.md §2 정본 재사용.
 */
import { json, error } from '@sveltejs/kit'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const q = (url.searchParams.get('q') ?? '').trim()
  if (!q) return json({ ids: [] })

  const index = await getProductSearchIndex()
  const results = index.search(q, { fuzzy: 0.2, prefix: true })

  return json({ ids: results.map((r) => r.document.id) })
}
