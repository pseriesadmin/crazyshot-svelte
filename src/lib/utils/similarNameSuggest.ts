/** Supabase ilike용 키워드 이스케이프 */
export function toIlikePattern(kw: string): string {
  const cleaned = kw.replace(/,/g, ' ').trim()
  const escaped = cleaned.replace(/[%_\\]/g, '\\$&')
  return `%${escaped}%`
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
