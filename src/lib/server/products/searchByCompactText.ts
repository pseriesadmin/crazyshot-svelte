import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CMS 상품목록 공백·하이픈 무시 검색 — 기본 검색(ilike)은 글자가 그대로 이어져야 맞는다.
 * 그래서 "R6 Mark II"로 검색하면 키워드 "R6MarkII"를, "r6markii"로 검색하면 상품명 "R6 Mark II"를,
 * "AGCX10"으로 검색하면 "AG-CX10"을 찾지 못했다. 공백·하이픈을 지우고 소문자로 맞춘 뒤 부분일치로 비교해
 * 기본 검색이 놓치는 부모 상품 id를 목록 필터에 합친다(키워드 검색과 같은 방식, DB 변경 없음).
 */

type TextRow = {
  id: string
  name: string | null
  brand: string | null
  product_caption: string | null
  keywords: string[] | null
}

/** 비교용 정규화 — 소문자 + 공백·하이픈 제거 */
export function compactText(s: string): string {
  return s.toLowerCase().replace(/[\s\-‐-―]+/g, '')
}

/** 정규화한 검색어가 3자 미만이면 비교하지 않는다(너무 넓은 매칭 방지) */
const MIN_COMPACT_LENGTH = 3

export function matchParentIdsByCompactText(rows: TextRow[], q: string): string[] {
  const needle = compactText(q)
  if (needle.length < MIN_COMPACT_LENGTH) return []
  const ids: string[] = []
  for (const r of rows) {
    const parts = [r.name, r.brand, r.product_caption, ...(Array.isArray(r.keywords) ? r.keywords : [])]
    if (parts.some((p) => typeof p === 'string' && compactText(p).includes(needle))) ids.push(r.id)
  }
  return ids
}

const PAGE = 1000

export async function findParentIdsByCompactText(admin: SupabaseClient, q: string): Promise<string[]> {
  if (compactText(q).length < MIN_COMPACT_LENGTH) return []
  const found = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('products').select('id, name, brand, product_caption, keywords')
      .is('parent_product_id', null).is('deleted_at', null)
      .order('id').range(from, from + PAGE - 1)
    if (error || !data) break
    for (const id of matchParentIdsByCompactText(data as TextRow[], q)) found.add(id)
    if (data.length < PAGE) break
  }
  // PostgREST id.in.(...) URL 길이 보호 — 너무 넓은 검색어에서 후보가 폭증하지 않게 상한
  return [...found].slice(0, 100)
}
