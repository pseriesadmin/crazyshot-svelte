/** CMS 유사이름 제안 — 검색 결과 항목 (상품명·브랜드·통합검색 공용) */
export interface SimilarNameItem {
  id: string
  name: string
  brand: string | null
  category: string | null
  product_code: string | null
  /** product_search: 매칭된 필드 (상품명·브랜드·키워드) */
  match_label?: string | null
}

export type SimilarNameSource = 'product_name' | 'brand' | 'product_search'
