// GET /api/search/crazylog?q=&log_type=&page=&limit=
// 크레이지로그 자연어 검색 API — 순수 MiniSearch 기반 (RPC 랭킹 자산 없음)
//
// 설계 원칙 (nlsearch.md §2 대조):
//   - 하이브리드(RPC + MiniSearch) 구조 없음 — crazylog는 search_products류 RPC가 없으므로 MiniSearch만 사용
//   - 응답 shape: { results, query, page, limit } — 상품검색 API와 통일
//   - log_type 파라미터: 결과를 특정 카테고리로 후필터 (탭 필터와 AND 조합)
//   - RLS 안전: 인덱스 빌드 시 status='published' AND is_public=true 조건으로 이미 필터됨

import { json, error as httpError } from '@sveltejs/kit'
import { getCrazylogSearchIndex } from '$lib/server/searchEngine/adapters/crazylogSearchIndex'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const q       = (url.searchParams.get('q') ?? '').trim()
  const logType = url.searchParams.get('log_type') || null
  const page    = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit   = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')))

  if (!q) {
    return json({ results: [], query: q, page, limit })
  }

  try {
    const index = await getCrazylogSearchIndex()

    const searchResults = index.search(q, {
      fuzzy:  0.2,
      prefix: true,
      limit:  limit * 3, // log_type 후필터를 위한 여유분
    })

    // log_type 필터 (탭 필터와 AND 조합) — 인덱스에 category 필드로 저장됨
    const filtered = logType
      ? searchResults.filter((r) => r.document.category === logType)
      : searchResults

    // 페이지네이션 적용
    const start = (page - 1) * limit
    const paged = filtered.slice(start, start + limit)

    const results = paged.map((r) => ({
      id:           r.document.id,
      title:        r.document['title'],
      category:     r.document['category'],
      author:       r.document['author_name'] ?? '익명',
      thumbnail_url: r.document['thumbnail_url'] ?? null,
      created_at:   r.document['created_at'],
      user_id:      r.document['user_id'],
      score:        r.score,
    }))

    return json({ results, query: q, page, limit })
  } catch (e) {
    console.error('[search/crazylog] MiniSearch 오류:', e)
    return httpError(500, '검색 처리 중 오류가 발생했습니다.')
  }
}
