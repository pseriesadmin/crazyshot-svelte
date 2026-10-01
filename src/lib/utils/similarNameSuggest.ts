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

// 자동완성 정렬 우선순위 — 상품명 시작일치 > 브랜드 정확/토큰 일치 > 브랜드 시작일치 >
// 상품명 부분일치 > 캡션 부분일치 > 설명 부분일치. 패키지 상품이 brand 컬럼에
// "CANON|SONY|ULANZI"처럼 여러 브랜드를 구분자로 이어붙여 저장하는 관행 때문에, 단순
// 가나다순 정렬만으로는 진짜 단독 브랜드 상품이 limit 밖으로 밀려나 자동완성에서 아예
// 안 보이는 결함이 있었음(2026-09-29, 결합상품 검색 자동완성에서 실사용 중 발견).
export function relevanceTier(
  row: { name: string; brand: string | null; description: string | null; product_caption: string | null },
  kw: string
): number {
  const needle = kw.trim().toLowerCase()
  if (!needle) return 6
  const name = row.name.toLowerCase()
  const brand = (row.brand ?? '').toLowerCase()
  const caption = (row.product_caption ?? '').toLowerCase()
  const desc = (row.description ?? '').toLowerCase()
  const brandTokens = brand.split(/[|,/]/).map((t) => t.trim()).filter(Boolean)

  if (name.startsWith(needle)) return 0
  if (brand === needle || brandTokens.includes(needle)) return 1
  if (brand.startsWith(needle)) return 2
  if (name.includes(needle)) return 3
  if (caption.includes(needle)) return 4
  if (desc.includes(needle)) return 5
  return 6
}
