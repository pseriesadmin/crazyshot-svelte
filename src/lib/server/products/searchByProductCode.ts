import type { SupabaseClient } from '@supabase/supabase-js'
import { baseCodeDisplay } from '$lib/utils/baseCodeDisplay'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'

/**
 * CMS 상품목록 품번 검색 — 부모 상품은 product_code가 없고(products.md §2-1) 화면의 '기준 품번'은
 * code_series로 만든 표시용 값이라, name·brand 등 텍스트 컬럼만 보는 기본 검색으로는 찾을 수 없다.
 * 아래 세 경로로 부모 상품 id를 모아 목록 필터에 합친다.
 *  ① 자식(재고) 품번 부분일치 → 그 부모  ② 레거시 부모 자신의 product_code  ③ 기준 품번(표시값) 부분일치
 */

/** 품번처럼 보이는 검색어(공백 없는 영숫자 5자 이상)만 품번 검색을 추가로 수행한다. */
export function isProductCodeQuery(q: string): boolean {
  return /^[A-Za-z0-9]{5,}$/.test(q.trim())
}

type CodeSeriesRow = { id: string; code_series: Record<string, unknown> | null }

/** 기준 품번(baseCodeDisplay) 부분일치 — 대소문자 무시 */
export function matchParentIdsByBaseCode(rows: CodeSeriesRow[], q: string): string[] {
  const needle = q.trim().toLowerCase()
  const ids: string[] = []
  for (const r of rows) {
    const base = baseCodeDisplay({ code_series: r.code_series })
    if (base && base.toLowerCase().includes(needle)) ids.push(r.id)
  }
  return ids
}

const PAGE = 1000

export async function findParentIdsByProductCode(admin: SupabaseClient, q: string): Promise<string[]> {
  if (!isProductCodeQuery(q)) return []
  const pattern = `%${escapeLikePattern(q.trim())}%`
  const found = new Set<string>()

  const [{ data: childRows }, { data: legacyRows }] = await Promise.all([
    admin.from('products').select('parent_product_id')
      .not('parent_product_id', 'is', null).is('deleted_at', null)
      .ilike('product_code', pattern).limit(300),
    admin.from('products').select('id')
      .is('parent_product_id', null).is('deleted_at', null)
      .ilike('product_code', pattern).limit(300),
  ])
  for (const r of (childRows ?? []) as Array<{ parent_product_id: string | null }>) {
    if (r.parent_product_id) found.add(r.parent_product_id)
  }
  for (const r of (legacyRows ?? []) as Array<{ id: string }>) found.add(r.id)

  // 기준 품번은 DB 컬럼이 아니라 계산값이라, code_series가 있는 부모를 페이지 단위로 읽어 서버에서 비교한다.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('products').select('id, code_series')
      .is('parent_product_id', null).is('deleted_at', null).not('code_series', 'is', null)
      .order('id').range(from, from + PAGE - 1)
    if (error || !data) break
    for (const id of matchParentIdsByBaseCode(data as CodeSeriesRow[], q)) found.add(id)
    if (data.length < PAGE) break
  }
  // PostgREST id.in.(...) URL 길이 보호 — 너무 넓은 검색어(예: CS0000)에서 후보가 폭증하지 않게 상한
  return [...found].slice(0, 100)
}
