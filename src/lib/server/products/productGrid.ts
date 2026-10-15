import type { SupabaseClient } from '@supabase/supabase-js'

// /products 상품 목록(그리드) 조회·가격 합성 공용 모듈
// — 페이지 load(초기 20개)와 무한스크롤 추가 조회 엔드포인트(/products/_more)가 같은 로직을 공유해
//   가격 우선순위(price_rules > base_price_daily)·판매전용 처리·정렬 기준이 갈라지지 않게 한다.

export interface ProductCard {
  id: string
  name: string
  slug: string | null
  category: string
  image_urls: string[] | null
  base_price_daily: number
  product_caption: string | null
  is_active: boolean
  price_12h: number | null
  price_24h: number | null
  sale_only: boolean
  sale_price: number | null
}

export const GRID_SORTS = ['latest', 'random', 'views', 'rentals'] as const

export function resolveGridSort(sort: string | null | undefined): string {
  return GRID_SORTS.includes(sort as (typeof GRID_SORTS)[number]) ? (sort as string) : 'views'
}

// ── 고정노출 정렬(sort='fixed') ────────────────────────────────────────────────
// 관리자가 /products 상품 그리드 설정에서 카테고리별로 고른 상품(목록마다 최대 FIXED_GRID_MAX개 = 30)을 지정한 순서대로 맨 앞에 두고,
// 그 뒤는 조회수순(기본 정렬)으로 이어 붙인다. 카테고리 필터가 걸려 있으면 그 카테고리 상품만 앞에 둔다.
// 설정 저장 위치: cms_settings.product_page_grid.fixedProducts = [{ id, order }] (기존 키라 DB 변경 없음).
export const GRID_SORT_FIXED = 'fixed'
export const FIXED_GRID_MAX = 30
/** get_products_sorted 조회 상한(Migration #579) — 고정 상품 수를 더해도 이 값을 넘기지 않는다 */
const GRID_RPC_MAX = 200

export interface FixedGridItem {
  id: string
  order: number
}

/** 설정값(JSON)을 안전한 고정 상품 목록으로 정리: order 오름차순, 중복·빈 id 제거, 최대 FIXED_GRID_MAX개 */
export function normalizeFixedProducts(raw: unknown): FixedGridItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const items: FixedGridItem[] = []
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    const order = Number(e.order)
    items.push({ id, order: Number.isFinite(order) ? order : index })
  })
  return items.sort((a, b) => a.order - b.order).slice(0, FIXED_GRID_MAX)
}

/** '전체'(카테고리 필터 없음) 탭의 키 */
export const FIXED_ALL_KEY = 'all'

export interface FixedGridSetting {
  /** 카테고리별 고정 상품: { all: […], 카테고리id: […] } (2026-10-15 이후) */
  fixedByCategory?: unknown
  /** 단일 목록(이전 저장 형식) — '전체' 목록으로 읽는다 */
  fixedProducts?: unknown
}

/**
 * 지금 보여 줄 카테고리(null=전체)에 쓸 고정 상품 id 목록(순서대로).
 * - 카테고리 필터가 있으면 그 카테고리의 목록만 쓴다(없으면 빈 목록 = 일반 정렬). 키는 대소문자를 구분하지 않는다.
 * - 전체(null)는 'all' 목록, 없으면 이전 형식의 fixedProducts 를 쓴다.
 */
export function pickFixedIdsForCategory(setting: FixedGridSetting, category: string | null): string[] {
  const key = (category ?? FIXED_ALL_KEY).toLowerCase()
  const byCat = setting.fixedByCategory
  if (byCat && typeof byCat === 'object' && !Array.isArray(byCat)) {
    for (const [k, list] of Object.entries(byCat as Record<string, unknown>)) {
      if (k.toLowerCase() === key) return normalizeFixedProducts(list).map((p) => p.id)
    }
  }
  if (key === FIXED_ALL_KEY) return normalizeFixedProducts(setting.fixedProducts).map((p) => p.id)
  return []
}

/**
 * 주소의 카테고리 값을 등록된 카테고리 표기(대소문자)로 맞춘다 — 대소문자는 구분하지 않는다(2026-10-15).
 * 일반 목록 조회(DB 함수)는 대소문자까지 같아야 매칭되므로, 등록된 카테고리 중 같은 글자(대소문자 무시)가 있으면 그 표기를 쓴다.
 * 등록된 카테고리에 없으면 입력값을 그대로 돌려준다(빈 목록이 정상).
 */
export function resolveCategoryCase(category: string | null, knownIds: string[]): string | null {
  if (!category) return category
  const lower = category.toLowerCase()
  return knownIds.find((id) => id.toLowerCase() === lower) ?? category
}

function rowId(row: Record<string, unknown>): string {
  return String(row['product_id'] ?? row['id'] ?? '')
}

/** 고정 행을 앞에 두고, 같은 상품이 일반 행에 있으면 일반 쪽에서 빼서 중복 없이 limit개로 자른다(순수 함수) */
export function mergeFixedFirst(
  fixedRows: Record<string, unknown>[],
  restRows: Record<string, unknown>[],
  limit: number,
): Record<string, unknown>[] {
  const pinned = new Set(fixedRows.map(rowId))
  return [...fixedRows, ...restRows.filter((r) => !pinned.has(rowId(r)))].slice(0, Math.max(0, limit))
}

/** RPC 행(get_products_sorted / search_products) → 카드(가격 미합성) */
export function mapGridRows(rows: Record<string, unknown>[]): ProductCard[] {
  return rows.map((r) => ({
    id:               String(r['product_id'] ?? r['id'] ?? ''),
    name:             String(r['name'] ?? ''),
    slug:             (r['slug'] as string | null) ?? null,
    category:         String(r['category'] ?? ''),
    image_urls:       r['image_urls'] != null
                        ? (r['image_urls'] as string[])
                        : r['image_url'] != null
                          ? [String(r['image_url'])]
                          : null,
    base_price_daily: Number(r['base_price_daily'] ?? r['price_min'] ?? 0),
    product_caption:  (r['product_caption'] as string | null) ?? null,
    is_active:        Boolean(r['is_active'] ?? true),
    price_12h:        null,
    price_24h:        null,
    sale_only:        false,
    sale_price:       null,
  }))
}

/** 노출 순서 설정대로 상위 limit개 조회. RPC 실패 시 search_products(최신순)로 폴백 */
export async function fetchGridRows(
  supabase: SupabaseClient,
  opts: { category: string | null; sort: string; limit: number; seed: string; userId: string | null },
): Promise<{ data: unknown[] | null }> {
  const viewed = await supabase.rpc('get_products_sorted', {
    p_category: opts.category,
    p_sort: opts.sort,
    p_limit: opts.limit,
    p_seed: opts.seed,
  })
  if (!viewed.error) return { data: viewed.data as unknown[] | null }
  console.error('[products] get_products_sorted 실패 — search_products 폴백:', viewed.error.message)
  const fallback = await supabase.rpc('search_products', {
    p_query: '',
    p_category: opts.category,
    p_page: 1,
    p_limit: opts.limit,
    p_session_id: null,
    p_user_id: opts.userId,
  })
  return { data: (fallback.data as unknown[] | null) ?? null }
}

/**
 * 고정노출 정렬을 반영한 그리드 조회. fixedIds 가 비어 있으면 fetchGridRows 와 완전히 같다.
 * 페이지 load(초기 20개)와 무한스크롤(/products/_more, 누적 limit 후 offset 으로 자름)이 같은 결과 순서를 만들도록
 * "고정 행 + 일반 행(고정 제외)"을 항상 같은 규칙으로 합성한다.
 * 고정 상품은 get_products_by_ids 로 읽고(비활성·삭제 상품은 RPC가 제외), 지정한 순서·카테고리 필터를 적용한다.
 */
export async function fetchGridRowsWithFixed(
  supabase: SupabaseClient,
  opts: { category: string | null; sort: string; limit: number; seed: string; userId: string | null; fixedIds: string[] },
): Promise<{ data: unknown[] | null }> {
  const { fixedIds, ...base } = opts
  if (fixedIds.length === 0) return fetchGridRows(supabase, base)

  const { data: fixedData } = await supabase.rpc('get_products_by_ids', { p_ids: fixedIds })
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of (fixedData ?? []) as Record<string, unknown>[]) byId.set(rowId(r), r)
  const wantCategory = base.category ? base.category.toLowerCase() : null
  const fixedRows = fixedIds
    .map((id) => byId.get(id))
    .filter((r): r is Record<string, unknown> => !!r)
    .filter((r) => r['is_active'] !== false)
    .filter((r) => wantCategory === null || String(r['category'] ?? '').toLowerCase() === wantCategory)

  if (fixedRows.length === 0) return fetchGridRows(supabase, base)

  const rest = await fetchGridRows(supabase, { ...base, limit: Math.min(GRID_RPC_MAX, base.limit + fixedRows.length) })
  return { data: mergeFixedFirst(fixedRows, (rest.data ?? []) as Record<string, unknown>[], base.limit) }
}

/**
 * 12H·24H 실가격 + 판매전용 정보를 카드에 합성(입력 순서 그대로 반환).
 * 2026-09-09: CMS 가격정책(price_rules)이 항상 우선 — 24h 값이 있으면 그 값, price_rules가 전혀 없는
 * 레거시 미설정 상품만 옛 base_price_daily로 폴백(products/[id]/+page.server.ts attachPrices()와 동일 우선순위).
 * 판매전용(sale_only) 상품은 대여가격이 없는 게 정상이라 sale_price/sale_only를 별도 조회해 싣는다(products.md §2-9).
 */
export async function attachCardPrices(supabase: SupabaseClient, cards: ProductCard[]): Promise<ProductCard[]> {
  const ids = [...new Set(cards.map((c) => c.id).filter(Boolean))]
  const price12hMap: Record<string, number> = {}
  const price24hMap: Record<string, number> = {}
  const salePriceMap: Record<string, number> = {}
  const saleOnlyMap: Record<string, boolean> = {}

  if (ids.length > 0) {
    const [{ data: priceRules }, { data: saleRows }] = await Promise.all([
      supabase
        .from('price_rules')
        .select('product_id, duration_type, price')
        .in('product_id', ids)
        .in('duration_type', ['12h', '24h'])
        .eq('is_active', true)
        .is('deleted_at', null),
      supabase.from('products').select('id, sale_only, sale_price').in('id', ids),
    ])
    for (const r of (priceRules ?? []) as { product_id: string; duration_type: string; price: number }[]) {
      if (r.duration_type === '12h') price12hMap[r.product_id] = Number(r.price)
      if (r.duration_type === '24h') price24hMap[r.product_id] = Number(r.price)
    }
    for (const r of (saleRows ?? []) as { id: string; sale_only: boolean | null; sale_price: number | null }[]) {
      saleOnlyMap[r.id] = !!r.sale_only
      if (r.sale_price != null) salePriceMap[r.id] = Number(r.sale_price)
    }
  }

  return cards.map((c) => {
    const rule24h = price24hMap[c.id]
    const price_24h = rule24h != null ? rule24h : (c.base_price_daily > 0 ? c.base_price_daily : null)
    return {
      ...c,
      price_12h: price12hMap[c.id] ?? null,
      price_24h,
      sale_only: saleOnlyMap[c.id] ?? false,
      sale_price: salePriceMap[c.id] ?? null,
    }
  })
}
