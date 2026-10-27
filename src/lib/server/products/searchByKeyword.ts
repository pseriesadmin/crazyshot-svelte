import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CMS 상품목록 키워드 검색 — 상품 키워드(products.keywords, TEXT[])는 PostgREST or(ilike)로 부분일치할 수 없어
 * 기본 검색(name·brand·description·product_caption)에서 빠져 있었다. 키워드가 있는 부모 상품을 읽어
 * 서버에서 대소문자 무시 부분일치로 비교하고 해당 부모 id를 목록 필터에 합친다(품번 검색과 같은 방식).
 */

type KeywordRow = { id: string; keywords: string[] | null }

/** 키워드 배열 중 하나라도 검색어를 포함하면 매칭 — 대소문자 무시 */
export function matchParentIdsByKeywords(rows: KeywordRow[], q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const ids: string[] = []
  for (const r of rows) {
    if (Array.isArray(r.keywords) && r.keywords.some((k) => typeof k === 'string' && k.toLowerCase().includes(needle))) {
      ids.push(r.id)
    }
  }
  return ids
}

const PAGE = 1000

export async function findParentIdsByKeyword(admin: SupabaseClient, q: string): Promise<string[]> {
  if (!q.trim()) return []
  const found = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('products').select('id, keywords')
      .is('parent_product_id', null).is('deleted_at', null).not('keywords', 'is', null)
      .order('id').range(from, from + PAGE - 1)
    if (error || !data) break
    for (const id of matchParentIdsByKeywords(data as KeywordRow[], q)) found.add(id)
    if (data.length < PAGE) break
  }
  // PostgREST id.in.(...) URL 길이 보호 — 너무 넓은 검색어에서 후보가 폭증하지 않게 상한
  return [...found].slice(0, 100)
}
