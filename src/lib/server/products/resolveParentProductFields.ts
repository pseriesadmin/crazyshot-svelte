import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 자식 재고(products.parent_product_id IS NOT NULL)가 부모 정보를 "참조"하도록 읽는 공용 헬퍼.
 *
 * 정책: 자식은 재고 품번·이력·장치정보 외에는 부모 값을 따른다. 기존 자식 칼럼에는 과거에
 * 복사된 값이 남아 있으므로 지우지 않고 "부모 우선, 자식 폴백"으로 해석한다 — 부모가
 * 비활성·삭제돼 고객 계정(RLS)이 부모 행을 못 읽거나 부모 값이 비어 있으면 자식 값을 그대로 쓴다.
 */

/** 화면에 보이는 값(이름·브랜드·분류·슬러그·캡션·이미지) */
export const PARENT_DISPLAY_FIELDS = ['name', 'brand', 'category', 'slug', 'product_caption', 'image_urls'] as const

/** 금액·대여 정책 값(판매전용·대여방식·방문지점·배송옵션) */
export const PARENT_POLICY_FIELDS = [
  'sale_only', 'sale_price', 'allowed_method_ids', 'allowed_pickup_ids', 'allowed_period_ids',
  'shipping_round_trip', 'shipping_delivery', 'shipping_return',
] as const

/** 상세 콘텐츠(설명·사양·구성품·콘텐츠블록·키워드) */
export const PARENT_CONTENT_FIELDS = ['description', 'specifications', 'components', 'content_blocks', 'keywords'] as const

/** 자식 재고 고유 값 — 요청받아도 부모 값으로 절대 덮어쓰지 않는다 */
export const CHILD_OWN_FIELDS: readonly string[] = [
  'id', 'parent_product_id', 'product_code', 'qr_payload', 'is_active', 'deleted_at',
  'code_series', 'auto_deactivated_reservation_id', 'created_at', 'updated_at',
]

type ProductLike = { id?: string; parent_product_id?: string | null }

function isRowWithId(v: unknown): v is Record<string, unknown> & { id: string } {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** 자식 한 행에 부모 값을 합친 새 객체를 돌려준다(원본 불변). 부모 값이 비어 있으면 자식 값 유지. */
export function mergeParentFields<T extends object>(
  child: T,
  parent: Record<string, unknown>,
  fields: readonly string[],
): T {
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(child))
  for (const f of fields) {
    if (CHILD_OWN_FIELDS.includes(f)) continue
    if (hasValue(parent[f])) next[f] = parent[f]
  }
  return next as T
}

/**
 * 행 목록 중 자식(parent_product_id 있음)에게만 부모 값을 합친다. 부모는 한 번의 `.in()` 쿼리로 모아 읽는다.
 * 부모 조회 실패·부모 없음이면 해당 행은 변경 없이 돌려준다(화면이 깨지지 않게 폴백).
 */
export async function resolveParentProductFields<T extends ProductLike>(
  client: SupabaseClient,
  rows: T[],
  fields: readonly string[],
): Promise<T[]> {
  const parentIds = [...new Set(
    rows.map(r => r.parent_product_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )]
  if (parentIds.length === 0) return rows

  const wanted = [...new Set(fields.filter(f => !CHILD_OWN_FIELDS.includes(f)))]
  const { data, error } = await client
    .from('products')
    .select(['id', ...wanted].join(', '))
    .in('id', parentIds)
  if (error || !data) return rows

  const parentMap = new Map<string, Record<string, unknown>>()
  for (const row of data as unknown[]) {
    if (isRowWithId(row)) parentMap.set(row.id, row)
  }
  return rows.map(r => {
    const parent = r.parent_product_id ? parentMap.get(r.parent_product_id) : undefined
    return parent ? mergeParentFields(r, parent, wanted) : r
  })
}

/**
 * 예약 행 등에 임베드된 상품 객체(`products!…(name, parent_product_id)`)를 제자리에서 부모 값으로 바꾼다.
 * null·undefined·부모 없는 객체는 건드리지 않는다. 부모는 한 번의 조회로 모아 읽고(N+1 방지), 실패하면 자식 값 유지.
 * 객체에는 반드시 `parent_product_id`가 select에 포함돼 있어야 한다.
 */
export async function applyParentFieldsInPlace<T extends ProductLike>(
  client: SupabaseClient,
  items: ReadonlyArray<T | null | undefined>,
  fields: readonly string[],
): Promise<void> {
  const present = items.filter((x): x is T => x != null)
  if (present.length === 0) return
  const resolved = await resolveParentProductFields(client, present, fields)
  present.forEach((orig, i) => {
    if (resolved[i] !== orig) Object.assign(orig, resolved[i])
  })
}

/** 부모 값을 읽을 서비스 클라이언트 — 고객 세션(RLS)은 비활성·삭제된 부모를 읽지 못하므로 부모 조회에만 쓴다. */
export function createParentReadClient(): SupabaseClient {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

type EmbeddedProduct = ProductLike & Record<string, unknown>

/**
 * 예약 행 배열에서 각 행의 `products` 임베드(객체 또는 1개짜리 배열)를 모아 제자리에서 부모 값으로 바꾼다.
 * 각 임베드 select에는 `parent_product_id`가 포함돼 있어야 한다. 클라이언트를 생략하면 서비스 클라이언트를 쓴다.
 */
export async function applyParentFieldsToRowProducts(
  rows: ReadonlyArray<unknown>,
  fields: readonly string[],
  client: SupabaseClient = createParentReadClient(),
  key = 'products',
): Promise<void> {
  const items: EmbeddedProduct[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') continue
    const emb = (row as Record<string, unknown>)[key]
    const first = Array.isArray(emb) ? emb[0] : emb
    if (first != null && typeof first === 'object') items.push(first as EmbeddedProduct)
  }
  if (items.length === 0) return
  await applyParentFieldsInPlace(client, items, fields)
}

