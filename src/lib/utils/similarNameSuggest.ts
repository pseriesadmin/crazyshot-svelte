/** Supabase ilike용 키워드 이스케이프 */
export function toIlikePattern(kw: string): string {
  const cleaned = kw.replace(/,/g, ' ').trim()
  const sqlEscaped = cleaned.replace(/[%_\\]/g, '\\$&')
  const pattern = `%${sqlEscaped}%`
  // PostgREST or() 필터 DSL은 값 안의 `(` `)` `.` `:` 등을 자체 문법기호로 해석한다 —
  // 이스케이프 없이 그대로 넣으면 조용히 0건 매칭(에러 없음)으로 실패한다. 검색어에
  // "ULANZI Ombra XIANG II (T154)"처럼 괄호가 포함된 상품명이 있으면 전수 검색·자동완성
  // 둘 다 이 문제로 항상 매칭 실패했다(2026-09-29 실사용 중 발견 — production REST API
  // 직접 재현으로 확진: 괄호 미이스케이프 시 [] 빈 배열, 큰따옴표로 감싸면 정상 매칭).
  // 값을 큰따옴표로 감싸 리터럴 문자열로 강제하고, 그 안의 백슬래시·큰따옴표 자체는
  // PostgREST 인용 규칙대로 다시 이스케이프한다(백슬래시 먼저 → 큰따옴표 순서 필수,
  // 순서를 바꾸면 방금 추가한 백슬래시가 다시 이스케이프돼 값이 깨진다).
  const dslEscaped = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${dslEscaped}"`
}

export function productSearchOrFilter(kw: string): string {
  const pattern = toIlikePattern(kw)
  return [
    `name.ilike.${pattern}`,
    `brand.ilike.${pattern}`,
    `description.ilike.${pattern}`,
    `product_caption.ilike.${pattern}`,
  ].join(',')
}

type ProductSearchRow = {
  name: string
  brand?: string | null
  description?: string | null
  product_caption?: string | null
}

export function resolveProductSearchMatchLabel(row: ProductSearchRow, kw: string): string {
  const needle = kw.toLowerCase()
  if (row.name?.toLowerCase().includes(needle)) return '상품명'
  if (row.brand?.toLowerCase().includes(needle)) return '브랜드'
  if (row.product_caption?.toLowerCase().includes(needle)) return '키워드'
  if (row.description?.toLowerCase().includes(needle)) return '키워드'
  return '상품'
}
