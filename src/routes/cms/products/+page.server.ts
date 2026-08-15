import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'
import { productSearchOrFilter } from '$lib/utils/similarNameSuggest'
import { invalidateProductSearchCache, getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { registerCrossLingualCandidatesFromParts } from '$lib/server/crossLingualSynonymScan'

// 하이브리드 검색: ilike 결과 "약한 매칭" 기준 — 이 건수 이하면 NLSearch 자연어 폴백 실행
// (nlsearch.md §2, /api/search/products 및 /api/cms/products/search-suggestions와 동일 임계값)
const WEAK_MATCH_THRESHOLD = 3
import { loadSelectedProductDetail, type RentalStatusBucket, type SelectedProductDetail } from '$lib/server/products/loadSelectedProductDetail'
// 버그 수정(2026-08-12): cloneProduct new_product 파트너코드 분기 조합코드 합산 채번
import { buildComboCategoryCode, getRootCode } from '$lib/utils/comboCategoryCode'

// rental_period_options / rental_method_options 는 database.ts 미등록 — 우회 헬퍼
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}

// PERF-2: 상품 선택/해제와 무관한 전역 메타데이터(카테고리 필터·파트너 조합코드·대여옵션·
// 배송설정)는 선택할 때마다 새로 조회할 필요가 없어 서버 프로세스 인메모리에 60초 TTL로
// 캐시한다. 서버리스 콜드스타트마다 자연 초기화되므로 별도 무효화 로직은 불필요.
type RentalOption = { id: string; name: string; display_order: number }
type PickupPointOption = { id: string; name: string; address: string }
type ShippingSettingsRow = {
  enable_round_trip: boolean
  round_trip_fee: number | null
  enable_delivery: boolean
  delivery_fee: number | null
  enable_return: boolean
  return_fee: number | null
  shipping_guide: string
}
type ProductsMetadata = {
  categories: Array<{ value: string; label: string; categoryCode: string | null }>
  categoryLabels: Record<string, string>
  partnerComboItems: Array<{
    combo_row_id: string
    combo_name: string | null
    combo_keywords: string[]
    group_id: string
    group_name: string
  }>
  rentalPeriods: RentalOption[]
  rentalMethods: RentalOption[]
  pickupPoints: PickupPointOption[]
  shippingSettings: ShippingSettingsRow | null
}

const METADATA_CACHE_TTL_MS = 60_000
let metadataCache: { expiresAt: number; data: ProductsMetadata } | null = null

async function loadProductsMetadata(admin: SupabaseClient): Promise<ProductsMetadata> {
  if (metadataCache && metadataCache.expiresAt > Date.now()) {
    return metadataCache.data
  }

  // 서로 독립적인 6개 쿼리 병렬 실행 (partnerComboItems만 partnerGroupIds에 의존해 아래 별도 처리)
  const [
    { data: rawCategoryGroups },
    { data: rawPartnerGroups },
    periodsRes,
    methodsRes,
    pickupsRes,
    { data: shippingRaw },
  ] = await Promise.all([
    // BUG-FIX(2026-08-10, Stephen 확정): code_mapping_groups가 카테고리 체계의 유일한
    // 정본 — "그룹명"(name)이 곧 /cms/products 카테고리 필터 바 UI에 노출돼야 할 표시
    // 라벨이고, "카테고리 키"(default_category)는 products.category·예약·대여 전역에
    // 걸친 절대 분류 기준값이다(변형·치환 금지). product_category_codes는 이 목적과
    // 무관한 별개 코드체계(품번 프리픽스·쿠폰·회원등급 등이 섞인 테이블)이므로 카테고리
    // 라벨 조회에 관여시키지 않는다. show_in_product_filter 필터 없이 전체를 가져와
    // categoryLabels(카드 배지 등 전역 라벨 조회용)를 만들고, 탭 목록(categories)만
    // show_in_product_filter=true로 별도 필터링한다.
    admin
      .from('code_mapping_groups')
      .select('id, name, sort_order, default_category, show_in_product_filter')
      .not('default_category', 'is', null)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    // 협력사 전용코드 그룹(is_partner_type=true)의 조합코드 목록 (빠른 재고 등록 모달 조합코드 선택용)
    admin
      .from('code_mapping_groups')
      .select('id, name')
      .eq('is_partner_type', true)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    untypedFrom(admin, 'rental_period_options').select('id, name, display_order').eq('is_active', true).is('deleted_at', null).order('display_order'),
    untypedFrom(admin, 'rental_method_options').select('id, name, display_order').eq('is_active', true).is('deleted_at', null).order('display_order'),
    admin.from('pickup_points').select('id, name, address').eq('is_active', true).is('deleted_at', null).order('created_at'),
    untypedFrom(admin, 'rental_shipping_settings')
      .select('enable_round_trip, round_trip_fee, enable_delivery, delivery_fee, enable_return, return_fee, shipping_guide')
      .limit(1)
      .single(),
  ])

  // 카테고리 키(default_category) → 그룹명(name) 전역 라벨 맵(카드 배지 등에서 사용,
  // show_in_product_filter 무관 — 필터에서 숨긴 카테고리도 이미 등록된 상품엔 라벨이 필요)
  const categoryLabels: Record<string, string> = Object.fromEntries(
    (rawCategoryGroups ?? [])
      .filter((g) => g.default_category)
      .map((g) => [g.default_category as string, g.name as string])
  )

  // 카테고리 필터 탭 목록 — show_in_product_filter=true인 그룹만
  const categories = (rawCategoryGroups ?? [])
    .filter((g) => g.show_in_product_filter)
    .map((g) => ({
      value: g.id,
      label: g.name,
      // categoryCode: 상세 패널에서 products.category에 저장할 실제 값 (default_category 문자열)
      categoryCode: (g.default_category ?? null) as string | null,
    }))

  const partnerGroupIds = (rawPartnerGroups ?? []).map((g) => g.id)
  const partnerGroupNameById: Record<string, string> = Object.fromEntries(
    (rawPartnerGroups ?? []).map((g) => [g.id, g.name])
  )

  // combo_row_id 기준으로 중복 제거한 flat 조합코드 목록 (rawPartnerGroups 의존 → 순차)
  const { data: rawPartnerItems } = partnerGroupIds.length > 0
    ? await admin
        .from('code_mapping_items')
        .select('group_id, combo_row_id, combo_name, combo_keywords')
        .in('group_id', partnerGroupIds)
        .order('sort_order', { ascending: true })
    : { data: [] as Array<{ group_id: string; combo_row_id: string; combo_name: string | null; combo_keywords: string[] }> }

  const seenComboRows = new Set<string>()
  const partnerComboItems: ProductsMetadata['partnerComboItems'] = []
  for (const item of rawPartnerItems ?? []) {
    if (!seenComboRows.has(item.combo_row_id)) {
      seenComboRows.add(item.combo_row_id)
      partnerComboItems.push({
        combo_row_id: item.combo_row_id,
        combo_name: item.combo_name,
        combo_keywords: item.combo_keywords ?? [],
        group_id: item.group_id,
        group_name: partnerGroupNameById[item.group_id] ?? '',
      })
    }
  }

  const data: ProductsMetadata = {
    categories,
    categoryLabels,
    partnerComboItems,
    rentalPeriods: ((periodsRes as { data: RentalOption[] | null }).data ?? []),
    rentalMethods: ((methodsRes as { data: RentalOption[] | null }).data ?? []),
    pickupPoints: (pickupsRes.data ?? []) as PickupPointOption[],
    shippingSettings: (shippingRaw as ShippingSettingsRow | null) ?? null,
  }

  metadataCache = { expiresAt: Date.now() + METADATA_CACHE_TTL_MS, data }
  return data
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const category = url.searchParams.get('category') ?? 'all'
  const q = url.searchParams.get('q') ?? ''
  const sort = (url.searchParams.get('sort') ?? 'newest') as 'newest' | 'oldest' | 'asc' | 'desc'
  const pageParam = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const selectedId = url.searchParams.get('selected') ?? null
  const initialTab = url.searchParams.get('tab') ?? null

  // BND-REGWARN-1: 상품 등록 후 경고 파라미터 읽기 (qr/inv/code/price/options/thumb)
  const regWarnParam = url.searchParams.get('regWarn') ?? null
  const regWarn: string[] = regWarnParam
    ? regWarnParam.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const PAGE_SIZE = 20

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // PERF-2: 선택 무관 전역 메타데이터는 60초 TTL 인메모리 캐시에서 서빙(카테고리 필터·
  // 파트너 조합코드·대여옵션·배송설정 — 상품 선택/해제로는 절대 바뀌지 않는 값들)
  const {
    categories,
    categoryLabels,
    partnerComboItems,
    rentalPeriods,
    rentalMethods,
    pickupPoints,
    shippingSettings,
  } = await loadProductsMetadata(admin)

  // 카테고리 필터: code_mapping_groups.default_category → products.category 문자열 매핑
  let categoryValues: string[] | null = null
  if (category !== 'all') {
    const { data: group } = await admin
      .from('code_mapping_groups')
      .select('default_category')
      .eq('id', category)
      .single()

    categoryValues = group?.default_category ? [group.default_category] : ['__none__']
  }

  // 전체 개수 쿼리 (페이지네이션용, 1차: ilike 기본 필터) — 부모 상품만 (재고 자식 제외)
  let countQ = admin
    .from('products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('parent_product_id', null)
  if (categoryValues) countQ = countQ.in('category', categoryValues)
  // BND-5: 자동완성 매치 필드와 동일하게 name·brand·description·product_caption 확장 검색
  if (q) countQ = countQ.or(productSearchOrFilter(q))

  // BND-3: count 먼저 조회해 totalPages 산출 → pageParam을 clamp한 뒤 range 쿼리 실행
  const { count: ilikeCount } = await countQ

  // ── 하이브리드 NLSearch 폴백: ilike 결과 약할 때 자연어 검색으로 보강 (K-3) ─────
  // (nlsearch.md §2 동일 패턴 — ilike 우선, NLSearch는 보강만)
  let totalCount = ilikeCount ?? 0
  let nlsearchFallbackIds: string[] = []

  if (q && (ilikeCount ?? 0) <= WEAK_MATCH_THRESHOLD) {
    try {
      const index = await getProductSearchIndex()
      const naturalResults = index.search(q, {
        fuzzy: 0.2,
        prefix: true,
        limit: 50, // PAGE_SIZE(20)보다 충분히 큰 값 — dedupe 여유 확보
      })

      if (naturalResults.length > 0) {
        nlsearchFallbackIds = naturalResults.map((r) => r.document.id)

        // 확장 OR 필터: ilike + NLSearch 폴백 IDs 합집합
        const expandedOrFilter = `${productSearchOrFilter(q)},id.in.(${nlsearchFallbackIds.join(',')})`

        // 확장 필터로 totalCount 재계산 (정확한 페이지네이션을 위해 countQ 재구성)
        let expandedCountQ = admin
          .from('products')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null)
          .is('parent_product_id', null)
        if (categoryValues) expandedCountQ = expandedCountQ.in('category', categoryValues)
        expandedCountQ = expandedCountQ.or(expandedOrFilter)
        const { count: expandedCount } = await expandedCountQ
        totalCount = expandedCount ?? totalCount
      }
    } catch (e) {
      console.error('[cms/products] NLSearch 폴백 오류:', e)
      // 폴백 실패 시 ilike 카운트로 계속 진행 (서비스 중단 방지)
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(pageParam, totalPages)

  // 목록 쿼리 — 부모 상품만 (재고 자식 제외)
  let listQ = admin
    .from('products')
    .select('id, category, name, slug, brand, image_urls, is_active, created_at')
    .is('deleted_at', null)
    .is('parent_product_id', null)

  if (sort === 'asc')         listQ = listQ.order('name', { ascending: true })
  else if (sort === 'desc')   listQ = listQ.order('name', { ascending: false })
  else if (sort === 'oldest') listQ = listQ.order('created_at', { ascending: true })
  else                        listQ = listQ.order('created_at', { ascending: false })

  if (categoryValues) listQ = listQ.in('category', categoryValues)
  // BND-5 + K-3 하이브리드: ilike 필터 (+ NLSearch 폴백 IDs OR 병합)
  if (q) {
    if (nlsearchFallbackIds.length > 0) {
      listQ = listQ.or(`${productSearchOrFilter(q)},id.in.(${nlsearchFallbackIds.join(',')})`)
    } else {
      listQ = listQ.or(productSearchOrFilter(q))
    }
  }

  listQ = listQ.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  const { data: products } = await listQ

  const productIds = (products ?? []).map((p) => p.id)

  const stockCounts: Record<string, { active: number; total: number }> = {}
  let prices24h: Record<string, number> = {}
  let prices12h: Record<string, number> = {}

  // 자식 price_rules fallback을 위한 맵 (부모에 price_rules 없을 때 카드 표시용)
  const childFallback12h: Record<string, number> = {}
  const childFallback24h: Record<string, number> = {}

  // 대여 라이프사이클 상태별 재고 집계 (자식 id → 부모 id 매핑 + rental_reservations 집계)
  // (RentalStatusBucket 타입은 loadSelectedProductDetail.ts에서 단일 정의 후 재사용)
  const childIdToParentId: Record<string, string> = {}
  const rentalStatusCounts: Record<string, RentalStatusBucket> = {}

  if (productIds.length > 0) {
    // PERF-1: 재고 수(+ 자식 price_rules fallback) / 24h / 12h 가격 — 서로 독립적이므로 병렬 실행
    // (rentalRows만 childIdToParentId 완성 후 실행 필요 — 아래에서 별도 처리)
    const [{ data: childRows }, { data: rules24hRaw }, { data: rules12hRaw }] = await Promise.all([
      admin
        .from('products')
        .select('id, parent_product_id, is_active, price_rules!left(duration_type, price, is_active, deleted_at)')
        .in('parent_product_id', productIds)
        .is('deleted_at', null),
      admin
        .from('price_rules')
        .select('product_id, price')
        .in('product_id', productIds)
        .eq('duration_type', '24h')
        .eq('is_active', true)
        .is('deleted_at', null),
      admin
        .from('price_rules')
        .select('product_id, price')
        .in('product_id', productIds)
        .eq('duration_type', '12h')
        .eq('is_active', true)
        .is('deleted_at', null),
    ])

    type ChildRow = {
      id: string
      parent_product_id: string
      is_active: boolean
      price_rules: Array<{ duration_type: string; price: number; is_active: boolean; deleted_at: string | null }> | null
    }
    for (const row of (childRows ?? []) as ChildRow[]) {
      const pid = row.parent_product_id
      childIdToParentId[row.id] = pid  // rental_reservations 집계용 매핑
      // pid는 DB에서 조회한 parent_product_id — 사용자 입력 아님
      // eslint-disable-next-line security/detect-object-injection
      if (!stockCounts[pid]) stockCounts[pid] = { active: 0, total: 0 }
      // eslint-disable-next-line security/detect-object-injection
      stockCounts[pid].total += 1
      // eslint-disable-next-line security/detect-object-injection
      if (row.is_active) stockCounts[pid].active += 1

      // 자식 가격 수집 (첫 번째 자식 기준 — 부모 price_rules 없을 때 카드 fallback용)
      // eslint-disable-next-line security/detect-object-injection
      if (!childFallback12h[pid] || !childFallback24h[pid]) {
        for (const r of row.price_rules ?? []) {
          if (!r.is_active || r.deleted_at) continue
          // eslint-disable-next-line security/detect-object-injection
          if (r.duration_type === '12h' && !childFallback12h[pid]) childFallback12h[pid] = r.price
          // eslint-disable-next-line security/detect-object-injection
          if (r.duration_type === '24h' && !childFallback24h[pid]) childFallback24h[pid] = r.price
        }
      }
    }

    // 24h/12h 가격 (부모 기준) — 위에서 병렬 조회한 원시 결과를 맵으로 변환
    prices24h = (rules24hRaw ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.product_id] = p.price
      return acc
    }, {})

    prices12h = (rules12hRaw ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.product_id] = p.price
      return acc
    }, {})

    // 대여 라이프사이클 상태별 집계 — 단일 쿼리로 모든 자식의 현재 예약 상태 취득
    // rental_reservations.deleted_at 컬럼 없음 → 필터 없음
    const allChildIds = Object.keys(childIdToParentId)
    if (allChildIds.length > 0) {
      const { data: rentalRows } = await admin
        .from('rental_reservations')
        .select('product_id, status')
        .in('product_id', allChildIds)
        .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])

      type RentalRowEntry = { product_id: string; status: string | null }
      for (const row of (rentalRows ?? []) as unknown as RentalRowEntry[]) {
        // parentId는 DB에서 조회한 childIdToParentId 매핑 결과 — 사용자 입력 아님
        const parentId = childIdToParentId[row.product_id]
        if (!parentId || !row.status) continue
        // eslint-disable-next-line security/detect-object-injection
        if (!rentalStatusCounts[parentId]) {
          // eslint-disable-next-line security/detect-object-injection
          rentalStatusCounts[parentId] = { holding: 0, outgoing: 0, renting: 0, returning: 0, returned: 0 }
        }
        // eslint-disable-next-line security/detect-object-injection
        const sc = rentalStatusCounts[parentId]
        const s = row.status
        if (s === 'hold') sc.holding += 1
        else if (s === 'confirmed' || s === 'shipped') sc.outgoing += 1
        else if (s === 'in_use') sc.renting += 1
        else if (s === 'return_requested') sc.returning += 1
        else if (s === 'returned' || s === 'completed') sc.returned += 1
      }
    }
  }

  // PERF-3: 선택된 상품 상세 데이터 로드 — loadSelectedProductDetail.ts로 이관된 로직 호출
  // (+page.server.ts는 selectedId가 있을 때만 이 헬퍼를 호출, 응답 형태는 이관 전과 동일)
  let selectedProduct: SelectedProductDetail['selectedProduct'] = null
  let selectedPriceRules: SelectedProductDetail['selectedPriceRules'] = []
  let rootProduct: SelectedProductDetail['rootProduct'] = null
  let inventoryList: SelectedProductDetail['inventoryList'] = []

  if (selectedId) {
    const detail = await loadSelectedProductDetail(admin, selectedId)
    selectedProduct = detail.selectedProduct
    selectedPriceRules = detail.selectedPriceRules
    rootProduct = detail.rootProduct
    inventoryList = detail.inventoryList
    // rootRentalStatusCounts를 페이지 목록의 rentalStatusCounts 맵에 병합 — 이관 전 동작과 동일
    if (rootProduct && detail.rootRentalStatusCounts) {
      rentalStatusCounts[rootProduct.id] = detail.rootRentalStatusCounts
    }
  }

  // PERF-2: shippingSettings도 loadProductsMetadata()에서 이미 제공됨(위 상단 구조분해) — 재조회 없음

  return {
    products: (products ?? []).map((p) => ({
      ...p,
      assetCount: stockCounts[p.id]?.active ?? 0,
      assetTotal: stockCounts[p.id]?.total ?? 0,
      price24h: (prices24h[p.id] ?? childFallback24h[p.id] ?? null) as number | null,
      price12h: (prices12h[p.id] ?? childFallback12h[p.id] ?? null) as number | null,
    })),
    categories,
    categoryLabels,
    category,
    q,
    sort,
    page,
    totalPages,
    selectedId,
    initialTab,
    selectedProduct,
    selectedPriceRules,
    rootProduct,
    inventoryList,
    partnerComboItems,
    rentalPeriods,
    rentalMethods,
    pickupPoints,
    shippingSettings,
    rentalStatusCounts,
    regWarn,  // BND-REGWARN-1: 상품 등록 경고 코드 목록
  }
}

export const actions: Actions = {
  // QR-RETRY-1: 과거 '빠른 재고 등록' 당시 품번 채번(generate_inventory_product_code)이 실패해
  // 영구히 품번 없이 남은 자식(재고) 상품을 위한 자가복구 액션. 이미 품번이 있으면 아무 것도 하지
  // 않음(§2-2 영구불변 — 재발급 아님, 미완료 채번을 완료시키는 것뿐).
  retryProductCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const productId = form.get('product_id') as string | null
    if (!productId) return fail(400, { error: '상품 ID 누락' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: child, error: childErr } = await admin
      .from('products')
      .select('id, product_code, parent_product_id')
      .eq('id', productId)
      .is('deleted_at', null)
      .single()

    if (childErr || !child) return fail(404, { error: '상품을 찾을 수 없습니다.' })
    if (!child.parent_product_id) return fail(400, { error: '대표 상품에는 품번을 채번할 수 없습니다.' })
    if (child.product_code) return { success: true, alreadyIssued: true }

    let { error: codeErr } = await admin.rpc('generate_inventory_product_code', {
      p_product_id: child.id,
      p_parent_product_id: child.parent_product_id,
    })

    // QR-RETRY-3: 레거시 부모(product_code는 있으나 code_series 없음)의 품번 문자열 역산 폴백은
    // prefix가 관례값 'CS'가 아니면 실패한다(migration 194 — 실사용 중 확인된 한계). 그런
    // 경우 정공법(카테고리 기준 code_series 정식 설정)으로 자동 전환 후 1회 재시도한다.
    if (codeErr) {
      const { data: parent } = await admin
        .from('products')
        .select('category, code_series')
        .eq('id', child.parent_product_id)
        .is('deleted_at', null)
        .single()

      if (parent && !parent.code_series) {
        const { error: seriesErr } = await admin.rpc('generate_product_code', {
          p_product_id: child.parent_product_id,
          p_category: parent.category,
          p_code_id: null,
        })
        if (!seriesErr) {
          ;({ error: codeErr } = await admin.rpc('generate_inventory_product_code', {
            p_product_id: child.id,
            p_parent_product_id: child.parent_product_id,
          }))
        }
      }
    }

    if (codeErr) return fail(500, { error: `품번 채번에 실패했습니다: ${codeErr.message}` })

    return { success: true }
  },

  // QR-RETRY-2: 등록 당시 generate_product_code 호출이 실패해(regWarn=code) code_series가
  // 영구히 비어있는 대표 상품을 위한 자가복구 액션. code_series가 이미 있으면 아무 것도 하지
  // 않음(generate_product_code 자체에도 동일 가드가 있어 이중 안전).
  retryCodeSeries: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const productId = form.get('product_id') as string | null
    if (!productId) return fail(400, { error: '상품 ID 누락' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: parent, error: parentErr } = await admin
      .from('products')
      .select('id, category, code_series, parent_product_id')
      .eq('id', productId)
      .is('deleted_at', null)
      .single()

    if (parentErr || !parent) return fail(404, { error: '상품을 찾을 수 없습니다.' })
    if (parent.parent_product_id) return fail(400, { error: '자식(재고) 상품에는 품번 체계를 설정할 수 없습니다. 대표 상품에서 진행하세요.' })
    if (parent.code_series) return { success: true, alreadySet: true }

    const { error: seriesErr } = await admin.rpc('generate_product_code', {
      p_product_id: parent.id,
      p_category: parent.category,
      p_code_id: null,
    })
    if (seriesErr) return fail(500, { error: `품번 체계 설정에 실패했습니다: ${seriesErr.message}` })

    return { success: true }
  },

  toggleStatus: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const id = form.get('id') as string
    const isActive = form.get('is_active') === 'true'

    if (!id) return fail(400, { error: '상품 ID 누락' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    // BND-4: 서버 UPDATE 실패 시 fail() 반환
    const { error: toggleErr } = await admin
      .from('products')
      .update({ is_active: !isActive })
      .eq('id', id)

    if (toggleErr) return fail(500, { error: '상태 변경에 실패했습니다.' })

    invalidateProductSearchCache() // is_active 변경 → 검색 인덱스 즉시 무효화
    return { success: true }
  },

  updateSection: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const productId = form.get('product_id') as string | null
    const sectionType = form.get('section_type') as string | null

    if (!productId || !sectionType) {
      return fail(400, { error: '필수 파라미터 누락' })
    }

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    // 재고 단위(자식) 상품은 images 외 모든 section 저장 차단 — 대표(부모) 기준 조회이므로
    // 자식에 저장된 데이터는 고객 화면에 반영되지 않으며 데이터 불일치 사고로 이어짐
    const childBlockedSections = ['basic', 'slug', 'pricing', 'content', 'components', 'specs', 'options', 'rental']
    if (childBlockedSections.includes(sectionType)) {
      const { data: childCheck } = await admin
        .from('products')
        .select('parent_product_id')
        .eq('id', productId)
        .single()
      if ((childCheck as { parent_product_id: string | null } | null)?.parent_product_id) {
        return fail(400, { error: '재고 단위 상품은 대표 상품에서 수정하세요.' })
      }
    }

    if (sectionType === 'basic') {
      const name = ((form.get('name') as string | null) ?? '').trim()
      const brand = ((form.get('brand') as string | null) ?? '').trim() || null
      const caption = ((form.get('caption') as string | null) ?? '').trim().slice(0, 20) || null
      const is_active = form.get('is_active') === 'true'
      const category = ((form.get('category') as string | null) ?? '').trim() || null

      if (!name) return fail(400, { error: '상품명은 필수입니다.' })

      const updatePayload: Record<string, unknown> = { name, brand, product_caption: caption, is_active }
      if (category) updatePayload.category = category

      const { error: updateError } = await admin
        .from('products')
        .update(updatePayload)
        .eq('id', productId)

      if (updateError) return fail(500, { error: '수정에 실패했습니다.' })

      // §C-2: 기본정보 저장 시 이중언어 병기 패턴 학습 훅 (fire-and-forget)
      registerCrossLingualCandidatesFromParts([name, brand, caption]).catch(() => {})
    }

    if (sectionType === 'slug') {
      const newSlug = ((form.get('slug') as string | null) ?? '').trim().toLowerCase()
      if (!newSlug || !/^[a-z0-9-]+$/.test(newSlug)) {
        return fail(400, { error: '코드는 영소문자·숫자·하이픈(-)만 사용 가능합니다.' })
      }
      const { data: existing } = await admin
        .from('products')
        .select('id')
        .eq('slug', newSlug)
        .neq('id', productId)
        .is('deleted_at', null)
        .maybeSingle()
      if (existing) return fail(409, { error: '이미 사용 중인 코드입니다.' })
      const { error: updateError } = await admin
        .from('products')
        .update({ slug: newSlug })
        .eq('id', productId)
      if (updateError) return fail(500, { error: '저장에 실패했습니다.' })
    }

    if (sectionType === 'pricing') {
      const salePrice = parseInt((form.get('sale_price') as string | null) ?? '0') || null
      const saleOnly = form.get('sale_only') === 'true'

      const depositAmount = parseFloat((form.get('deposit_amount') as string | null) ?? '0') || 0
      const lateFeePerHour = parseFloat((form.get('late_fee_per_hour') as string | null) ?? '0') || 0
      const damageFeePercentage = parseFloat((form.get('damage_fee_percentage') as string | null) ?? '0') || 0

      // BND-8: 서버측 범위 검증 (클라이언트 min/max 우회 방어)
      if (depositAmount < 0 || depositAmount > 10_000_000)
        return fail(400, { error: '보증금은 0~1,000만원 사이여야 합니다.' })
      if (lateFeePerHour < 0 || lateFeePerHour > 500_000)
        return fail(400, { error: '연체료는 0~500,000원 사이여야 합니다.' })
      if (damageFeePercentage < 0 || damageFeePercentage > 100)
        return fail(400, { error: '파손비율은 0~100 사이여야 합니다.' })
      if (salePrice !== null && (salePrice < 0 || salePrice > 99_999_999))
        return fail(400, { error: '판매가 범위를 초과했습니다.' })

      type DurationTypeEnum = '12h' | '24h' | 'monthly'
      const durationTypes: DurationTypeEnum[] = ['12h', '24h', 'monthly']
      const priceMap: Record<DurationTypeEnum, number | null> = {
        '12h': parseFloat((form.get('price_12h') as string | null) ?? '') || null,
        '24h': parseFloat((form.get('price_24h') as string | null) ?? '') || null,
        'monthly': parseFloat((form.get('price_monthly') as string | null) ?? '') || null,
      }

      // BND-9: 24시간 가격 필수 강제 (sale_only 상품은 대여가격 불필요 — 스킵)
      if (!saleOnly && (!priceMap['24h'] || priceMap['24h'] <= 0))
        return fail(400, { error: '24시간(1일) 가격은 필수입니다.' })

      // sale_price / sale_only → products 테이블
      await admin.from('products').update({ sale_price: salePrice, sale_only: saleOnly }).eq('id', productId)

      for (const dtype of durationTypes) {
        // eslint-disable-next-line security/detect-object-injection
        const price = priceMap[dtype]
        // soft-delete된 행 포함 조회 (partial unique index WHERE deleted_at IS NULL 대응)
        const { data: anyRule } = await admin
          .from('price_rules')
          .select('id, deleted_at')
          .eq('product_id', productId)
          .eq('duration_type', dtype)
          .maybeSingle()

        if (price && price > 0) {
          // 가격 입력 있음 → 기존 행 재활성화 또는 신규 INSERT
          if (anyRule) {
            await admin.from('price_rules').update({
              price,
              deposit_amount: depositAmount,
              late_fee_per_hour: lateFeePerHour,
              damage_fee_percentage: damageFeePercentage,
              is_active: true,
              deleted_at: null,
            }).eq('id', anyRule.id)
          } else {
            await admin.from('price_rules').insert({
              product_id: productId,
              duration_type: dtype,
              price,
              deposit_amount: depositAmount,
              late_fee_per_hour: lateFeePerHour,
              damage_fee_percentage: damageFeePercentage,
            })
          }
        } else if (dtype !== '24h' && anyRule && !anyRule.deleted_at) {
          // BND-PRICEDEL-1: 12h/monthly 가격을 비워서 저장하면 소프트삭제 (24h 제외 — 필수 보호됨)
          // anyRule.deleted_at이 null인 active 행만 대상 (이미 soft-deleted인 행은 변경 불필요)
          await admin.from('price_rules').update({
            is_active: false,
            deleted_at: new Date().toISOString(),
          }).eq('id', anyRule.id)
        }
      }
    }

    if (sectionType === 'images') {
      let image_urls: string[] = []
      const imagesStr = form.get('image_urls') as string | null
      if (imagesStr) {
        try { image_urls = JSON.parse(imagesStr) } catch { /* ignore */ }
      }
      image_urls = image_urls.filter(Boolean)

      // 자식 상품인 경우 부모 ID 기준으로 저장 (카드·목록 썸네일에 반영)
      let imgTargetId = productId
      const { data: imgSelfCheck } = await admin
        .from('products')
        .select('parent_product_id')
        .eq('id', productId)
        .single()
      const imgParentId = (imgSelfCheck as Record<string, unknown> | null)?.parent_product_id as string | null
      if (imgParentId) imgTargetId = imgParentId

      const { error: updateError } = await admin
        .from('products')
        .update({ image_urls })
        .eq('id', imgTargetId)

      if (updateError) return fail(500, { error: '이미지 수정에 실패했습니다.' })
    }

    if (sectionType === 'specs') {
      let specifications: Record<string, string> | null = null
      const specsStr = form.get('specifications') as string | null
      if (specsStr) {
        try { specifications = JSON.parse(specsStr) } catch { /* ignore */ }
      }

      const { error: updateError } = await admin
        .from('products')
        .update({ specifications })
        .eq('id', productId)

      if (updateError) return fail(500, { error: '사양 수정에 실패했습니다.' })
    }

    if (sectionType === 'components') {
      let components: Record<string, string> | null = null
      const compStr = form.get('components') as string | null
      if (compStr) {
        try { components = JSON.parse(compStr) } catch { /* ignore */ }
      }

      const { error: updateError } = await admin
        .from('products')
        .update({ components })
        .eq('id', productId)

      if (updateError) return fail(500, { error: '구성품 수정에 실패했습니다.' })
    }

    if (sectionType === 'content') {
      let content_blocks: unknown = null
      let keywords: string[] = []
      const blocksStr = form.get('content_blocks') as string | null
      const keywordsStr = form.get('keywords') as string | null
      if (blocksStr) { try { content_blocks = JSON.parse(blocksStr) } catch { /* ignore */ } }
      if (keywordsStr) { try { keywords = JSON.parse(keywordsStr) } catch { /* ignore */ } }
      // RTN-LOW-1(3): 등록과 동일하게 최대 10개 cap
      keywords = (Array.isArray(keywords) ? keywords : []).filter(Boolean).slice(0, 10)

      const { error: updateError } = await admin
        .from('products')
        .update({ content_blocks, keywords })
        .eq('id', productId)

      if (updateError) return fail(500, { error: '상품설명 수정에 실패했습니다.' })

      // §C-2: 상품설명 저장 시 이중언어 병기 패턴 학습 훅 (fire-and-forget)
      // blocksStr는 Tiptap JSON 원문 — 문자열에 포함된 "한글(영문)" 패턴도 추출 대상
      registerCrossLingualCandidatesFromParts([keywords.join(' '), blocksStr]).catch(() => {})
    }

    if (sectionType === 'options') {
      const optionsStr = form.get('option_links') as string | null
      let option_links: unknown[] = []
      if (optionsStr) { try { option_links = JSON.parse(optionsStr) } catch { /* ignore */ } }

      // JSONB 파라미터는 JS 배열 직접 전달 (JSON.stringify 금지 — string으로 처리되어 silent fail)
      const { error: updateError } = await admin
        .rpc('upsert_product_option_links', {
          p_product_id:   productId,
          p_option_links: option_links,
        })

      if (updateError) return fail(500, { error: `옵션상품 수정에 실패했습니다: ${updateError.message}` })
    }

    if (sectionType === 'rental') {
      let allowed_period_ids: string[] = []
      let allowed_method_ids: string[] = []
      let allowed_pickup_ids: string[] = []
      const periodStr = form.get('allowed_period_ids') as string | null
      const methodStr = form.get('allowed_method_ids') as string | null
      const pickupStr = form.get('allowed_pickup_ids') as string | null
      if (periodStr) { try { allowed_period_ids = JSON.parse(periodStr) } catch { /* ignore */ } }
      if (methodStr) { try { allowed_method_ids = JSON.parse(methodStr) } catch { /* ignore */ } }
      if (pickupStr) { try { allowed_pickup_ids = JSON.parse(pickupStr) } catch { /* ignore */ } }

      const { error: updateError } = await admin
        .from('products')
        .update({ allowed_period_ids, allowed_method_ids, allowed_pickup_ids })
        .eq('id', productId)

      if (updateError) return fail(500, { error: '대여정책 수정에 실패했습니다.' })

      // 배송 옵션 (대여정책 탭에 통합 저장)
      const shipRoundTripStr = form.get('shipping_round_trip')
      if (shipRoundTripStr !== null) {
        const { error: shipError } = await admin.rpc('update_product_shipping_options', {
          p_product_id: productId,
          p_round_trip: shipRoundTripStr === 'true',
          p_delivery:   form.get('shipping_delivery') === 'true',
          p_return:     form.get('shipping_return') === 'true',
        })
        if (shipError) return fail(500, { error: '배송 옵션 저장에 실패했습니다.' })
      }
    }

    // 검색 인덱스 대상 필드(name/brand/category/product_caption/content_blocks/slug)를 변경한 경우 즉시 무효화
    if (['basic', 'slug', 'content'].includes(sectionType ?? '')) {
      invalidateProductSearchCache()
    }
    return { success: true, sectionType }
  },

  deleteProduct: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const productId = form.get('product_id') as string | null
    if (!productId) return fail(400, { error: '상품 ID 누락' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: target } = await admin
      .from('products')
      .select('parent_product_id')
      .eq('id', productId)
      .single()

    const now = new Date().toISOString()
    const { error } = await admin
      .from('products')
      .update({ deleted_at: now })
      .eq('id', productId)

    if (error) return fail(500, { error: '삭제에 실패했습니다.' })

    const parentId = (target as { parent_product_id: string | null } | null)?.parent_product_id

    if (parentId) {
      // 자식(재고 단위) 삭제 — 부모의 남은 재고가 0이 되면 부모 노출 자동 OFF
      const { count } = await admin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('parent_product_id', parentId)
        .is('deleted_at', null)
      if ((count ?? 0) === 0) {
        await admin.from('products').update({ is_active: false }).eq('id', parentId)
      }
    } else {
      // BND-1: 부모 삭제 시 활성 자식(재고) 모두 소프트삭제 → 예약 배정 대상 제외
      await admin
        .from('products')
        .update({ deleted_at: now })
        .eq('parent_product_id', productId)
        .is('deleted_at', null)
    }

    invalidateProductSearchCache() // 상품 삭제 → 검색 인덱스 즉시 무효화
    return { success: true, action: 'deleteProduct' }
  },

  // INV-DEL-1: 인벤토리 아코디언 "N개 삭제" — 체크된 자식(재고) 일괄 소프트삭제.
  // deleteProduct의 자식 삭제 분기(부모 남은 재고 0이면 부모 노출 자동 OFF)와 동일 정책을
  // 여러 건에 적용한다.
  deleteSelectedInventory: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const idsRaw = (form.get('ids') as string | null) ?? ''
    const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) return fail(400, { error: '삭제할 항목이 없습니다.' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: targets } = await admin
      .from('products')
      .select('id, parent_product_id')
      .in('id', ids)
      .not('parent_product_id', 'is', null)
      .is('deleted_at', null)

    if (!targets || targets.length === 0) return fail(404, { error: '삭제할 항목을 찾을 수 없습니다.' })

    const now = new Date().toISOString()
    const { error } = await admin
      .from('products')
      .update({ deleted_at: now })
      .in('id', ids)

    if (error) return fail(500, { error: '삭제에 실패했습니다.' })

    // 부모의 남은 재고가 0이 되면 부모 노출 자동 OFF (단일 삭제와 동일 정책)
    const parentIds = [...new Set(
      targets.map((t) => (t as { parent_product_id: string | null }).parent_product_id).filter((id): id is string => !!id)
    )]
    for (const parentId of parentIds) {
      const { count } = await admin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('parent_product_id', parentId)
        .is('deleted_at', null)
      if ((count ?? 0) === 0) {
        await admin.from('products').update({ is_active: false }).eq('id', parentId)
      }
    }

    return { success: true, action: 'deleteSelectedInventory', count: targets.length }
  },

  cloneProduct: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const sourceProductId = form.get('source_product_id') as string | null
    const count = Math.min(20, Math.max(1, Number(form.get('count')) || 1))
    const autoCode = form.get('auto_code') !== 'false'
    const partnerCode = form.get('partner_code') === 'true'
    const partnerComboRowId = (form.get('partner_combo_row_id') as string | null) ?? ''
    const mode = (form.get('mode') as string | null) ?? 'new_product'

    if (!sourceProductId) return fail(400, { error: '원본 상품 ID가 누락됐습니다.' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: source, error: sourceError } = await admin
      .from('products')
      .select('id, category, name, slug, brand, description, product_caption, image_urls, specifications, sale_price, sale_only, product_code, code_series, parent_product_id, content_blocks, keywords')
      .eq('id', sourceProductId)
      .is('deleted_at', null)
      .single()

    if (sourceError || !source) return fail(404, { error: '원본 상품을 찾을 수 없습니다.' })

    // ── add_inventory 모드: 동일 상품 재고 추가 ──────────────────
    if (mode === 'add_inventory') {
      // CODE-SERIES-5: product_code 체크 → code_series 체크로 변경
      // 부모에 채번 구조(code_series)가 없으면 자식 품번 채번 불가.
      // 단, code_series 정책 이전에 이미 product_code를 발급받은 레거시 부모는
      // generate_inventory_product_code의 즉석 역산 폴백(Migration 194)으로 계속 동작 가능하므로 허용.
      const codeSeries = (source as Record<string, unknown>).code_series
      const legacyProductCode = (source as Record<string, unknown>).product_code
      if (!codeSeries && !legacyProductCode) {
        return fail(400, { error: '부모 상품의 품번 체계가 설정되지 않았습니다. 먼저 상품을 다시 등록하거나 관리자에게 문의하세요.' })
      }

      // source가 이미 재고 자식 상품인 경우 루트 ID 사용 (2단계 이상 중첩 방지)
      const srcParentId = (source as Record<string, unknown>).parent_product_id as string | null
      const rootProductId = srcParentId ?? sourceProductId

      const { data: sourcePriceRulesInv } = await admin
        .from('price_rules')
        .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
        .eq('product_id', sourceProductId)
        .eq('is_active', true)
        .is('deleted_at', null)

      const createdIds: string[] = []
      const invWarnings: string[] = []
      for (let i = 1; i <= count; i++) {
        // RTN-3: new_product 모드와 동일하게 slug 중복 확인 루프 적용
        let slug = `${source.slug}-inv`
        let invSuffix = 1
        while (true) {
          const { data: slugCheck } = await admin
            .from('products').select('id').eq('slug', slug).is('deleted_at', null).maybeSingle()
          if (!slugCheck) break
          slug = `${source.slug}-inv-${invSuffix++}`
        }
        const newId = crypto.randomUUID()

        const { data: newProduct, error: insertError } = await admin
          .from('products')
          .insert({
            id: newId,
            qr_payload: `https://crazyshot.kr/qr/product/${newId}`,
            category: source.category,
            name: source.name,
            slug,
            brand: source.brand,
            description: source.description,
            product_caption: source.product_caption,
            image_urls: source.image_urls,
            specifications: source.specifications,
            content_blocks: (source as Record<string, unknown>).content_blocks ?? [],
            keywords: (source as Record<string, unknown>).keywords ?? [],
            is_active: true, // products.md §3: 신규 자식 기본값 true (즉시 대여 가능)
            sale_price: source.sale_price,
            sale_only: source.sale_only,
            parent_product_id: rootProductId,
          })
          .select('id')
          .single()

        if (insertError || !newProduct) {
          return fail(500, { error: `${i}번째 재고 추가에 실패했습니다.` })
        }

        let { error: codeErr } = await admin.rpc('generate_inventory_product_code', {
          p_product_id: newProduct.id,
          p_parent_product_id: rootProductId,
        })
        if (codeErr) {
          // 순번 상한(max_sequence_exceeded): 재시도 없이 즉시 실패 반환 — 이 부모의 자식을 더 생성할 수 없음
          if (codeErr.message?.includes('max_sequence_exceeded')) {
            return fail(400, { error: `재고 순번 상한에 도달했습니다. 코드설정에서 해당 조합코드의 순번2(자식) 상한을 늘려주세요.` })
          }
          // products.md §2-3: 모든 재고는 생성과 동시에 품번(QR 콘텐츠)을 반드시 가져야 함 —
          // 일시적 오류(락 경합 등) 대비 1회 재시도 후에도 실패하면 경고로 알림
          ;({ error: codeErr } = await admin.rpc('generate_inventory_product_code', {
            p_product_id: newProduct.id,
            p_parent_product_id: rootProductId,
          }))
        }
        if (codeErr) {
          if (codeErr.message?.includes('max_sequence_exceeded')) {
            return fail(400, { error: `재고 순번 상한에 도달했습니다. 코드설정에서 해당 조합코드의 순번2(자식) 상한을 늘려주세요.` })
          }
          invWarnings.push(`${i}번째 재고 품번 발행 실패 (수동 확인 필요)`)
        }

        if (sourcePriceRulesInv && sourcePriceRulesInv.length > 0) {
          const { error: priceErr } = await admin.from('price_rules').insert(
            sourcePriceRulesInv.map((rule) => ({
              product_id: newProduct.id,
              duration_type: rule.duration_type,
              price: rule.price,
              deposit_amount: rule.deposit_amount,
              late_fee_per_hour: rule.late_fee_per_hour,
              damage_fee_percentage: rule.damage_fee_percentage,
            }))
          )
          if (priceErr) invWarnings.push(`${i}번째 재고 가격정책 복사 실패 (수동 확인 필요)`)
        }

        const { data: invSourceOptions } = await admin
          .rpc('get_product_option_links', { p_product_id: rootProductId })
        if (invSourceOptions && Array.isArray(invSourceOptions) && invSourceOptions.length > 0) {
          // JSONB 파라미터는 JS 배열 직접 전달 (JSON.stringify 금지 — string으로 처리되어 silent fail)
          const { error: optErr } = await admin.rpc('upsert_product_option_links', {
            p_product_id: newProduct.id,
            p_option_links: invSourceOptions,
          })
          if (optErr) invWarnings.push(`${i}번째 재고 옵션링크 복사 실패 (수동 확인 필요)`)
        }

        createdIds.push(newProduct.id)
      }
      return {
        success: true,
        cloned: createdIds.length,
        createdIds,
        mode: 'add_inventory',
        partnerCode: false,
        warnings: invWarnings.length > 0 ? invWarnings : undefined,
      }
    }

    // ── new_product 모드: 기존 복제 로직 ─────────────────────────
    // 선택된 조합코드(combo_row_id) 기반 파트너 품번 해석
    // 버그 수정(2026-08-12): 기존에는 depth=1 subCode 단 하나만 p_code_id로 전달 →
    //   콤보에 코드가 2개 이상이어도 1개만 채번에 반영. new/+page.server.ts와 동일 패턴으로 수정.
    let partnerCodeId: string | null = null            // p_code_id (대분류 루트 코드 — code_rule 조회용)
    let partnerComboCategoryCode: string | null = null // p_category_code_override (TIER_ORDER 합산 분류코드)
    let partnerDateOption: string | null = null
    let partnerMaxSequence: number | null = null
    let partnerParentMaxSequence: number | null = null

    if (partnerCode && partnerComboRowId) {
      // 1. 선택 combo_row의 taxonomy_code_id + 공통 속성 수집
      const { data: comboItems } = await admin
        .from('code_mapping_items')
        .select('taxonomy_code_id, date_option, max_sequence, parent_max_sequence')
        .eq('combo_row_id', partnerComboRowId)

      const tcIds = (comboItems ?? []).map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id).filter(Boolean)

      if (tcIds.length > 0) {
        // 콤보 행 공통 속성 추출 (모든 아이템이 동일한 값을 가짐)
        partnerDateOption = (comboItems![0] as { date_option: string }).date_option
        partnerMaxSequence = (comboItems![0] as { max_sequence: number | null }).max_sequence ?? null
        partnerParentMaxSequence = (comboItems![0] as { parent_max_sequence: number | null }).parent_max_sequence ?? null

        // 2. source.category 기준 depth=0 코드 조회 (BND-PARTNERCODE-1 검증용)
        const { data: mainCode } = await admin
          .from('product_category_codes')
          .select('id')
          .eq('product_category', source.category)
          .eq('depth', 0)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle()

        if (mainCode) {
          // 3. 해당 카테고리 depth=1 자식 코드 중 이 combo_row에 포함된 것 탐색 (카테고리 일치성 검증)
          const { data: subCode } = await admin
            .from('product_category_codes')
            .select('id')
            .eq('parent_id', mainCode.id)
            .eq('depth', 1)
            .eq('is_active', true)
            .is('deleted_at', null)
            .in('id', tcIds)
            .limit(1)
            .maybeSingle()

          // BND-PARTNERCODE-1: 카테고리 불일치 시 조용한 폴백 제거 → 명확 차단
          if (!subCode) {
            return fail(400, { error: '선택한 조합코드가 이 상품의 카테고리와 맞지 않습니다. 올바른 조합코드를 선택해주세요.' })
          }

          // 4. 전체 코드 조회 (depth 무관 — TIER_ORDER 합산 분류코드 빌드용)
          // 버그 수정(2026-08-13): 2-3단계(mainCode/subCode) 검증 쿼리와 동일한 활성/미삭제
          // 필터가 없어, 콤보에 비활성/삭제 코드가 섞여 있으면 검증은 통과하고 실제 저장되는
          // category_code에는 그 코드까지 합산돼 들어가던 비대칭 버그(new/+page.server.ts와
          // 동일 클래스, 2026-08-13 세션에서 발견)
          const { data: allCodes } = await admin
            .from('product_category_codes')
            .select('id, code, code_tier, depth')
            .in('id', tcIds)
            .eq('is_active', true)
            .is('deleted_at', null)

          if (allCodes && allCodes.length > 0) {
            partnerComboCategoryCode = buildComboCategoryCode(
              allCodes as Array<{ id: string; code: string; code_tier?: string | null; depth?: number }>
            )
            const rootCode = getRootCode(
              allCodes as Array<{ id: string; code: string; code_tier?: string | null; depth?: number }>
            )
            partnerCodeId = rootCode?.id ?? null
          }
        }

        // BND-PARTNERCODE-1: mainCode 미발견 또는 allCodes 조회 실패 시 차단
        if (!partnerCodeId || !partnerComboCategoryCode) {
          return fail(400, { error: '선택한 조합코드가 이 상품의 카테고리와 맞지 않습니다. 올바른 조합코드를 선택해주세요.' })
        }
      }
    }

    const { data: sourcePriceRules } = await admin
      .from('price_rules')
      .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
      .eq('product_id', sourceProductId)
      .eq('is_active', true)
      .is('deleted_at', null)

    const createdIds: string[] = []
    const cloneWarnings: string[] = []
    // BND-BATCH-2: 순번 상한 도달 시 이미 생성된 상품(품번 미발급)은 그대로 인정하고,
    // 남은 개수는 더 시도해봤자 동일 사유로 실패하므로 즉시 중단(§2-10③ 배치 부분실패 정책과 동일 원리)
    let sequenceCapReached = false

    for (let i = 1; i <= count; i++) {
      let slug = `${source.slug}-copy`
      let suffix = 1
      while (true) {
        const { data: existing } = await admin
          .from('products').select('id').eq('slug', slug).is('deleted_at', null).maybeSingle()
        if (!existing) break
        slug = `${source.slug}-copy-${suffix++}`
      }

      const cloneId = crypto.randomUUID()
      const { data: newProduct, error: insertError } = await admin
        .from('products')
        .insert({
          id: cloneId,
          qr_payload: `https://crazyshot.kr/qr/product/${cloneId}`,
          category: source.category,
          name: source.name,
          slug,
          brand: source.brand,
          description: source.description,
          product_caption: source.product_caption,
          image_urls: source.image_urls,
          specifications: source.specifications,
          content_blocks: (source as Record<string, unknown>).content_blocks ?? [],
          keywords: (source as Record<string, unknown>).keywords ?? [],
          is_active: false, // 신규 부모 복제 상품은 미노출 상태로 시작 (의도된 동작)
          sale_price: source.sale_price,
          sale_only: source.sale_only,
        })
        .select('id')
        .single()

      if (insertError || !newProduct) {
        return fail(500, { error: `${i}번째 복제 등록에 실패했습니다.` })
      }

      if (partnerCode) {
        if (!partnerCodeId || !partnerComboCategoryCode) {
          return fail(400, {
            error: `이 카테고리에 선택한 조합코드 하위 분류코드가 등록되지 않았습니다. 코드설정에서 먼저 추가해주세요.`,
          })
        }
        // 버그 수정(2026-08-12): 3-param → 7-param (p_category_code_override = TIER_ORDER 합산 분류코드)
        // new/+page.server.ts(GATE E 통과)와 동일 호출 패턴
        const { error: codeErr } = await admin.rpc('generate_product_code', {
          p_product_id:              newProduct.id,
          p_category:               source.category,
          p_code_id:                partnerCodeId,
          p_date_option:            partnerDateOption ?? 'ym',
          p_max_sequence:           partnerMaxSequence,
          p_parent_max_sequence:    partnerParentMaxSequence,
          p_category_code_override: partnerComboCategoryCode,
        })
        if (codeErr) {
          // BND-BATCH-2: 순번 상한 도달은 하드 실패로 응답하지 않음 — 이미 INSERT된 이 상품(i번째)은
          // 품번만 미발급된 채로 그대로 인정(§2-10① regWarn='code'와 동일 원리)하고, 남은 개수는
          // 계속 시도해도 같은 사유로 실패하므로 이번 반복 끝에서 루프를 중단한다.
          if (codeErr.message?.includes('parent_max_sequence_exceeded')) {
            cloneWarnings.push(`${i}번째 복제 상품은 생성됐으나 순번1(부모) 상한 도달로 품번이 발급되지 않았습니다 — 코드설정에서 순번1 상한을 늘린 후 상품 상세에서 품번을 재시도해주세요.`)
            sequenceCapReached = true
          } else if (codeErr.message?.includes('max_sequence_exceeded')) {
            cloneWarnings.push(`${i}번째 복제 상품은 생성됐으나 순번2(자식) 상한 도달로 품번이 발급되지 않았습니다 — 코드설정에서 순번2(max_sequence) 상한을 늘린 후 상품 상세에서 품번을 재시도해주세요.`)
            sequenceCapReached = true
          } else {
            cloneWarnings.push(`${i}번째 복제 품번 발행 실패 (수동 확인 필요)`)
          }
        }
      } else if (autoCode) {
        // ⚠️ p_code_id를 명시적으로 null 전달 — 생략 시 PostgREST 오버로드 모호성(PGRST203) 발생
        //    (2026-08-06 실제 curl 테스트로 확인된 라이브 버그, new/+page.server.ts와 동일 원인)
        const { error: codeErr } = await admin.rpc('generate_product_code', {
          p_product_id: newProduct.id,
          p_category: source.category,
          p_code_id: null,
        })
        if (codeErr) cloneWarnings.push(`${i}번째 복제 품번 발행 실패 (수동 확인 필요)`)
      }

      if (sourcePriceRules && sourcePriceRules.length > 0) {
        const { error: priceErr } = await admin.from('price_rules').insert(
          sourcePriceRules.map((rule) => ({
            product_id: newProduct.id,
            duration_type: rule.duration_type,
            price: rule.price,
            deposit_amount: rule.deposit_amount,
            late_fee_per_hour: rule.late_fee_per_hour,
            damage_fee_percentage: rule.damage_fee_percentage,
          }))
        )
        if (priceErr) cloneWarnings.push(`${i}번째 복제 가격정책 복사 실패 (수동 확인 필요)`)
      }

      createdIds.push(newProduct.id)

      // BND-BATCH-2: 순번 상한 도달 시 이번(i번째) 항목까지는 정상 처리했으니, 남은 개수는
      // 계속 시도해도 동일 사유로 실패하므로 여기서 중단하고 몇 개가 시도되지 못했는지 알린다.
      if (sequenceCapReached) {
        if (i < count) {
          cloneWarnings.push(`나머지 ${count - i}개는 순번 상한으로 인해 생성되지 않았습니다.`)
        }
        break
      }
    }

    return {
      success: true,
      cloned: createdIds.length,
      createdIds,
      partnerCode,
      warnings: cloneWarnings.length > 0 ? cloneWarnings : undefined,
    }
  },

}
// RTN-8: updateShippingOptions 액션 제거 — updateSection(rental 섹션)과 중복, 호출부 0건 확인 후 삭제
// 배송 옵션 저장은 updateSection sectionType='rental' 내 shipping 파라미터로 처리됨
