/**
 * productSearchRanking.ts — CMS 상품 목록 검색 결과의 "근접도순" 정렬 (순수 함수)
 *
 * 자동완성(search-suggestions API)과 같은 등급 기준(relevanceTier)을 목록 결과에도 적용한다.
 * 같은 등급 안에서는 검색어가 상품명 앞쪽에서 일치할수록, 이름이 짧을수록(검색어에 가까울수록) 앞에 둔다.
 * pinId가 있으면(제안목록에서 직접 선택한 상품) 등급과 무관하게 맨 앞에 둔다.
 */
import { relevanceTier } from '$lib/utils/similarNameSuggest'

export interface RankableProduct {
  id: string
  name: string
  brand: string | null
  description: string | null
  product_caption: string | null
}

export function rankProductsByRelevance<T extends RankableProduct>(
  rows: T[],
  q: string,
  pinId: string | null = null
): T[] {
  const needle = q.trim().toLowerCase()
  const scored = rows.map((row) => {
    const name = (row.name ?? '').toLowerCase()
    const pos = needle ? name.indexOf(needle) : -1
    return {
      row,
      tier: relevanceTier(
        { name: row.name ?? '', brand: row.brand, description: row.description, product_caption: row.product_caption },
        q
      ),
      pos: pos < 0 ? Number.MAX_SAFE_INTEGER : pos,
      len: name.length,
    }
  })

  scored.sort((a, b) => {
    if (pinId) {
      if (a.row.id === pinId && b.row.id !== pinId) return -1
      if (b.row.id === pinId && a.row.id !== pinId) return 1
    }
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.pos !== b.pos) return a.pos - b.pos
    if (a.len !== b.len) return a.len - b.len
    return (a.row.name ?? '').localeCompare(b.row.name ?? '', 'ko')
  })

  return scored.map((s) => s.row)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** pin 파라미터는 UUID 형식만 허용한다(그 외는 무시). */
export function parsePinId(raw: string | null | undefined): string | null {
  if (!raw) return null
  return UUID_RE.test(raw) ? raw.toLowerCase() : null
}
