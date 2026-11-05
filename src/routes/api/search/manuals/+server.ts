// GET /api/search/manuals?ids=<상품id,상품id,...>
// 검색 결과 상품에 연결된 상품설명서(PDF) 목록 — 상품 검색 결과 아래 "상품설명서" 섹션용
//
// 설계 원칙:
//   - 검색 자체는 /api/search/products 가 맡는다(랭킹·로그 보존). 이 API는 "이미 찾은 상품 id"에 붙은 설명서만 읽어 온다.
//   - 읽기는 locals.supabase(anon, RLS 적용) — 고객에게 보이지 않는 상품의 설명서는 내려가지 않는다.
//   - 설명서는 대표(부모) 상품에만 있다(products.manual_files) — 목록은 normalizeManualFiles 로 정리해 잘못된 항목을 버린다.
//   - 응답 순서 = 요청한 id 순서(상품 검색 랭킹 순서) 그대로.

import { json } from '@sveltejs/kit'
import { normalizeManualFiles } from '$lib/utils/productManuals'
import type { RequestHandler } from './$types'

const MAX_IDS = 50
/** 한 번에 내려주는 설명서 최대 개수 — 화면 섹션이 길어지지 않게 */
const MAX_MANUALS = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ProductManualRow {
  id: string
  name: string
  slug: string | null
  manual_files: unknown
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const ids = [...new Set(
    (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s)),
  )].slice(0, MAX_IDS)

  if (ids.length === 0) return json({ results: [] })

  const { data, error } = await locals.supabase
    .from('products')
    .select('id, name, slug, manual_files')
    .in('id', ids)

  if (error) {
    console.error('[search/manuals] 조회 실패:', error.message)
    return json({ results: [] })
  }

  const rowById = new Map<string, ProductManualRow>(
    ((data ?? []) as ProductManualRow[]).map((r) => [r.id, r]),
  )

  const results: {
    product_id: string
    product_name: string
    slug: string | null
    path: string
    name: string
    size: number
  }[] = []

  for (const id of ids) {
    const row = rowById.get(id)
    if (!row) continue
    for (const f of normalizeManualFiles(row.manual_files)) {
      results.push({
        product_id: row.id,
        product_name: row.name,
        slug: row.slug,
        path: f.path,
        name: f.name,
        size: f.size,
      })
      if (results.length >= MAX_MANUALS) return json({ results })
    }
  }

  return json({ results })
}
