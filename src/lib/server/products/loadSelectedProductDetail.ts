// PERF-3: /cms/products 선택 상세 데이터 로딩 헬퍼
// src/routes/cms/products/+page.server.ts의 "선택된 상품 상세 데이터 로드" 로직(② 그룹)을
// 그대로 이관 — +page.server.ts(전체 load 경로)와 신규
// src/routes/cms/products/[id]/detail/+server.ts(선택 전환 전용 client fetch 경로) 양쪽에서
// 동일하게 재사용한다. 로직 변경 없음, 순수 이동.
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildComboCategoryCode, getRootCode } from '$lib/utils/comboCategoryCode'

export type CategoryComboItem = {
  combo_row_id: string
  combo_name: string | null
  combo_keywords: string[]
  group_id: string
  group_name: string
  code_preview: string
}

export type RentalStatusBucket = {
  holding: number    // 예약중: hold
  outgoing: number   // 반출중: confirmed, shipped
  renting: number    // 대여중: in_use
  returning: number  // 반납중: return_requested
  returned: number   // 반납완료: returned, completed
}

type AssetDetail = {
  id: string
  asset_code: string | null
  serial_number: string | null
  status: string
  condition_notes: string | null
  warehouse_location: string | null
  label_image_url: string | null
  ocr_raw_text: string | null
}

export type SelectedProduct = {
  id: string
  category: string
  name: string
  slug: string
  product_code: string | null
  code_series: Record<string, unknown> | null
  brand: string | null
  description: string | null
  product_caption: string | null
  image_urls: string[]
  specifications: Record<string, string> | null
  is_active: boolean
  created_at: string
  qr_payload: string | null
  sale_price: number | null
  sale_only: boolean
  option_only: boolean
  assetCount: number
  price12h: number | null
  price24h: number | null
  assets: AssetDetail[]
  allowed_period_ids: string[]
  allowed_method_ids: string[]
  allowed_pickup_ids: string[]
  // 2026-08-25: "코드 재반영" 재설계 — 이 부모가 자신보다 먼저 생성된 다른 활성 부모와
  // 완전히 동일한 1단 계층(순번1 없음) code_series를 공유하는 "복제로 생긴 후발 중복"인지
  // 여부. true일 때만 ProductDetailPanel이 재할당 버튼을 노출한다(원본 쪽에는 노출 안 함).
  hasOlderDuplicateCode: boolean
  // hasOlderDuplicateCode가 true일 때만 채워지는 재할당용 조합코드 목록 — 이 상품의
  // category와 매칭되는 코드설정/코드조합 그룹 전체(협력사 전용 여부 무관, partnerComboItems와
  // 달리 필터 없음).
  categoryComboItems: CategoryComboItem[]
}

export type InventoryUnit = {
  id: string
  name: string
  product_code: string | null
  is_active: boolean
  price_rules: Array<{ duration_type: string; price: number }>
}

export type RootProductInfo = {
  id: string
  name: string
  brand: string | null
  category: string
  image_urls: string[]
  price12h: number | null
  price24h: number | null
  product_code: string | null
  code_series: Record<string, unknown> | null
  assetCount: number
  assetTotal: number
}

export type SelectedProductDetail = {
  selectedProduct: SelectedProduct | null
  selectedPriceRules: Array<{
    duration_type: string
    price: number
    deposit_amount: number | null
    late_fee_per_hour: number | null
    damage_fee_percentage: number | null
  }>
  rootProduct: RootProductInfo | null
  inventoryList: InventoryUnit[]
  // 대표 상품(rootProduct)의 실시간 예약상태 집계 — 페이지 목록의 rentalStatusCounts 맵과
  // 달리 이 값은 항상 selectedId 하나에 대해서만 직접 재계산되므로 페이지네이션과 완전히 무관
  rootRentalStatusCounts: RentalStatusBucket | null
}

export async function loadSelectedProductDetail(
  admin: SupabaseClient,
  selectedId: string,
): Promise<SelectedProductDetail> {
  let selectedProduct: SelectedProduct | null = null
  let selectedPriceRules: SelectedProductDetail['selectedPriceRules'] = []

  const { data: sp } = await admin.from('products').select('*').eq('id', selectedId).is('deleted_at', null).single()

  if (sp) {
    // 자식(재고 단위) 상품은 편집이 부모에서만 가능하므로, 기본정보(이름·브랜드·
    // 카테고리·카피·슬러그)를 포함해 옵션·가격·대여정책·상품설명·구성품·사양·
    // 이미지까지 '이력' 탭을 제외한 전 항목의 조회를 항상 부모(대표) 기준으로 통일한다.
    // 그래야 부모에서 수정한 내용이 자식 패널에도 즉시 반영되어 정합이 유지된다.
    // (품번·QR·is_active(재고 노출 — 토글 스위치가 조작하는 실제 재고가용 상태)·
    //  이력·자산 정보는 재고 단위 자신의 고유값이므로 예외 — Stephen 확정)
    const spParentId = (sp as Record<string, unknown>).parent_product_id as string | null
    const policySourceId = spParentId ?? selectedId

    const [{ data: optionLinksData }, { data: priceRules }, parentRowRes] = await Promise.all([
      admin.rpc('get_product_option_links', { p_product_id: policySourceId }),
      admin
        .from('price_rules')
        .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
        .eq('product_id', policySourceId)
        .eq('is_active', true)
        .is('deleted_at', null),
      spParentId
        ? admin
            .from('products')
            .select('name, brand, category, product_caption, slug, image_urls, allowed_period_ids, allowed_method_ids, allowed_pickup_ids, shipping_round_trip, shipping_delivery, shipping_return, sale_price, sale_only, option_only, content_blocks, keywords, components, specifications')
            .eq('id', spParentId)
            .is('deleted_at', null)  // BND-2: 삭제된 부모가 선택된 경우 데이터 노출 차단
            .single()
        : Promise.resolve({ data: null }),
    ])

    // 자식이면 부모 행(parentRowRes.data)을 정본으로, 부모 자신이면 sp를 그대로 사용
    const policyRow = (parentRowRes.data ?? null) as Record<string, unknown> | null
    const src: Record<string, unknown> = policyRow ?? (sp as Record<string, unknown>)

    selectedProduct = {
      ...sp,
      // PERF-3: assetCount/assetTotal은 목록 페이지 집계 맵(stockCounts) 없이는 계산할 수
      // 없는데, products.md §9 Q2 확인 결과 이 필드는 실제 렌더링에 쓰이지 않는 죽은
      // 필드(대표 카드는 rootProduct.assetCount/assetTotal을 별도 직접 계산해 사용) —
      // 0으로 고정한다.
      assetCount: 0,
      assetTotal: 0,
      // price12h/24h도 아래 selectedPriceRules 기준으로 즉시 덮어써지므로 임시값은 null
      price12h: null,
      price24h: null,
      product_code: (sp as Record<string, unknown>).product_code as string | null ?? null,
      code_series: (sp as Record<string, unknown>).code_series as Record<string, unknown> | null ?? null,
      name: (src.name as string) ?? sp.name,
      brand: (src.brand as string | null) ?? null,
      category: (src.category as string) ?? sp.category,
      slug: (src.slug as string) ?? sp.slug,
      product_caption: (src.product_caption as string | null) ?? null,
      sale_price: (src.sale_price as number | null) ?? null,
      sale_only: (src.sale_only as boolean) ?? false,
      option_only: (src.option_only as boolean) ?? false,
      allowed_period_ids: (src.allowed_period_ids as string[] | null) ?? [],
      allowed_method_ids: (src.allowed_method_ids as string[] | null) ?? [],
      allowed_pickup_ids: (src.allowed_pickup_ids as string[] | null) ?? [],
      shipping_round_trip: (src.shipping_round_trip as boolean) ?? true,
      shipping_delivery:   (src.shipping_delivery   as boolean) ?? true,
      shipping_return:     (src.shipping_return     as boolean) ?? true,
      option_links:        optionLinksData ?? [],
      content_blocks:      src.content_blocks,
      keywords:            src.keywords,
      components:          src.components,
      specifications:      (src.specifications as Record<string, string> | null) ?? null,
      image_urls:          (src.image_urls as string[] | null) ?? (sp as Record<string, unknown>).image_urls as string[] ?? [],
      // 아래 duplicate-detection 블록에서 selectedProduct 자신이 부모일 때만 실제로 채움
      hasOlderDuplicateCode: false,
      categoryComboItems:    [],
    } as SelectedProduct

    selectedPriceRules = priceRules ?? []

    // 선택된 상품이 자식일 경우 prices12h/prices24h 맵에 해당 ID가 없어 null이 됨
    // selectedPriceRules는 policySourceId(부모) 기준으로 정확히 조회되었으므로 여기서 덮어씀
    selectedProduct!.price12h = selectedPriceRules.find(r => r.duration_type === '12h')?.price ?? null
    selectedProduct!.price24h = selectedPriceRules.find(r => r.duration_type === '24h')?.price ?? null

    // 자산(assets)·장치정보는 재고 단위(자식) 고유값 — 항상 선택된 상품 자신(selectedId) 기준
    const { data: assetDetails } = await admin
      .from('assets')
      .select('id, asset_code, serial_number, status, condition_notes, warehouse_location, label_image_url, ocr_raw_text')
      .eq('product_id', selectedId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    // selectedProduct is non-null here (inside `if (sp)` block)
    selectedProduct!.assets = (assetDetails ?? []) as AssetDetail[]

    // 2026-08-25: "코드 재반영" 재설계 — 이 상품이 부모(자식 아님) + code_series가 1단
    // 계층(순번1 없음)일 때만 후발 중복 여부를 확인한다. 2단 계층은 parent_seq가 행마다
    // 원자적으로 유일하게 증가해 애초에 동일 code_series를 가질 수 없으므로 검사 대상이 아님.
    if (!spParentId) {
      const cs = (sp as Record<string, unknown>).code_series as Record<string, unknown> | null
      if (cs && !cs.parent_seq_digits) {
        // JSONB ->> 연산자를 PostgREST 필터 컬럼명으로 직접 넘기는 방식은 이 코드베이스에
        // 검증된 선례가 없어(신규 패턴 위험 회피), 같은 category의 부모 후보만 넓게 가져와
        // JS에서 code_series 필드를 직접 비교한다 — 후보 수가 적어(카테고리당 부모 상품
        // 수준) 성능 영향 없음.
        const { data: sameCatParents } = await admin
          .from('products')
          .select('id, code_series, created_at')
          .is('parent_product_id', null)
          .is('deleted_at', null)
          .eq('category', selectedProduct!.category)
          .neq('id', selectedId)
          .not('code_series', 'is', null)

        const selfCreatedAt = new Date((sp as Record<string, unknown>).created_at as string).getTime()
        const olderDup = (sameCatParents ?? []).find((row) => {
          const rcs = row.code_series as Record<string, unknown> | null
          if (!rcs || rcs.parent_seq_digits) return false
          if (new Date(row.created_at as string).getTime() >= selfCreatedAt) return false
          return (
            (rcs.category_code ?? '') === (cs.category_code ?? '') &&
            (rcs.year_month ?? '') === (cs.year_month ?? '') &&
            (rcs.prefix ?? '') === (cs.prefix ?? '') &&
            (rcs.suffix ?? '') === (cs.suffix ?? '') &&
            Number(rcs.seq_digits ?? 3) === Number(cs.seq_digits ?? 3)
          )
        })

        if (olderDup) {
          selectedProduct!.hasOlderDuplicateCode = true

          // 이 상품의 category와 매칭되는 코드설정/코드조합 그룹 전체(협력사 전용 여부 무관)
          const { data: matchGroups } = await admin
            .from('code_mapping_groups')
            .select('id, name')
            .eq('default_category', selectedProduct!.category)
          const groupIds = (matchGroups ?? []).map((g) => g.id as string)
          const groupNameById = new Map((matchGroups ?? []).map((g) => [g.id as string, g.name as string]))

          if (groupIds.length > 0) {
            type ComboItemRow = {
              group_id: string
              combo_row_id: string
              combo_name: string | null
              combo_keywords: string[]
              taxonomy_code_id: string
              date_option: string
              max_sequence: number | null
              parent_max_sequence: number | null
            }
            const { data: rawItems } = await admin
              .from('code_mapping_items')
              .select('group_id, combo_row_id, combo_name, combo_keywords, taxonomy_code_id, date_option, max_sequence, parent_max_sequence')
              .in('group_id', groupIds)
              .order('sort_order', { ascending: true }) as { data: ComboItemRow[] | null }

            const comboRowItemsMap = new Map<string, ComboItemRow[]>()
            for (const item of rawItems ?? []) {
              const list = comboRowItemsMap.get(item.combo_row_id) ?? []
              list.push(item)
              comboRowItemsMap.set(item.combo_row_id, list)
            }

            const taxonomyIds = [...new Set((rawItems ?? []).map((i) => i.taxonomy_code_id))]
            const { data: taxonomyCodes } = taxonomyIds.length > 0
              ? await admin
                  .from('product_category_codes')
                  .select('id, code, code_tier, depth, code_rule')
                  .in('id', taxonomyIds)
              : { data: [] as Array<{ id: string; code: string; code_tier: string | null; depth: number; code_rule: Record<string, unknown> | null }> }
            const taxonomyById = new Map((taxonomyCodes ?? []).map((c) => [c.id as string, c]))

            const { data: globalFmtRow } = await admin
              .from('cms_settings')
              .select('value')
              .eq('key', 'product_code_format')
              .maybeSingle()
            const globalFmt = {
              prefix: 'CS', date_format: 'YYMM', seq_digits: 3,
              ...(globalFmtRow?.value && typeof globalFmtRow.value === 'object' ? globalFmtRow.value as Record<string, unknown> : {}),
            } as { prefix?: string; date_format?: string; seq_digits?: number }

            const seenRows = new Set<string>()
            const items: CategoryComboItem[] = []
            for (const item of rawItems ?? []) {
              if (seenRows.has(item.combo_row_id)) continue
              seenRows.add(item.combo_row_id)
              const comboItems = comboRowItemsMap.get(item.combo_row_id) ?? []
              const codes = comboItems
                .map((i) => taxonomyById.get(i.taxonomy_code_id))
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
              let preview = '—'
              if (codes.length > 0) {
                const catCode = buildComboCategoryCode(codes)
                const rootCodeId = getRootCode(codes)?.id ?? null
                const rootRule = (rootCodeId ? taxonomyById.get(rootCodeId)?.code_rule : null) ?? null
                const prefix = (((rootRule?.prefix as string) || globalFmt.prefix || 'CS') as string).trim().toUpperCase()
                const lead = comboItems[0]
                let datePartStr = ''
                if (lead?.date_option === 'ymd') {
                  const now = new Date()
                  datePartStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
                } else if (lead?.date_option !== 'none') {
                  const now = new Date()
                  const df = globalFmt.date_format ?? 'YYMM'
                  datePartStr = df === 'YYYYMM'
                    ? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
                    : `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
                }
                const seqPlaceholder = (lead?.parent_max_sequence && lead?.max_sequence)
                  ? '0'.repeat(String(lead.parent_max_sequence).length) + '0'.repeat(String(lead.max_sequence).length)
                  : '0'.repeat(globalFmt.seq_digits ?? 3)
                preview = `${prefix}${catCode}${datePartStr}${seqPlaceholder}`
              }
              items.push({
                combo_row_id: item.combo_row_id,
                combo_name: item.combo_name,
                combo_keywords: item.combo_keywords ?? [],
                group_id: item.group_id,
                group_name: groupNameById.get(item.group_id) ?? '',
                code_preview: preview,
              })
            }
            selectedProduct!.categoryComboItems = items
          }
        }
      }
    }
  }

  // 선택된 상품의 재고 목록 (자신 + 자식 제품 — 동일 재고 그룹)
  let rootProduct: RootProductInfo | null = null
  let rootRentalStatusCounts: RentalStatusBucket | null = null

  // 자식 상품이 선택된 경우 → 부모 기준으로 전체 재고 그룹 로드
  const parentProductId = selectedProduct
    ? ((selectedProduct as unknown as Record<string, unknown>).parent_product_id as string | null)
    : null
  const rootId = parentProductId ?? selectedId
  const { data: invData } = await admin
    .from('products')
    .select('id, name, product_code, is_active, price_rules!left(duration_type, price, is_active, deleted_at)')
    .eq('parent_product_id', rootId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  const inventoryList: InventoryUnit[] = (invData ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    product_code: (p as Record<string, unknown>).product_code as string | null,
    is_active: p.is_active as boolean,
    price_rules: ((p as Record<string, unknown>).price_rules as Array<{ duration_type: string; price: number; is_active: boolean; deleted_at: string | null }> ?? [])
      .filter((r) => r.is_active && !r.deleted_at)
      .map((r) => ({ duration_type: r.duration_type, price: r.price })),
  }))

  // PAGE-SCOPE-1: 대표 상품의 재고 수는 페이지 목록 집계 맵에 의존하지 않고 inventoryList로
  // 직접 계산 — rootId 기준 전용 조회이므로 페이지네이션·필터와 완전히 무관
  const rootAssetCount = inventoryList.filter((u) => u.is_active).length
  const rootAssetTotal = inventoryList.length

  // 대표 상품의 실시간 예약상태 집계도 동일한 이유로 inventoryList의 자식 id 기준으로 직접 재조회
  const rootChildIds = inventoryList.map((u) => u.id)
  if (rootChildIds.length > 0) {
    const { data: rootRentalRows } = await admin
      .from('rental_reservations')
      .select('status')
      .in('product_id', rootChildIds)
      .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])

    const bucket: RentalStatusBucket = { holding: 0, outgoing: 0, renting: 0, returning: 0, returned: 0 }
    for (const row of (rootRentalRows ?? []) as Array<{ status: string | null }>) {
      const s = row.status
      if (s === 'hold') bucket.holding += 1
      else if (s === 'confirmed' || s === 'shipped') bucket.outgoing += 1
      else if (s === 'in_use') bucket.renting += 1
      else if (s === 'return_requested') bucket.returning += 1
      else if (s === 'returned' || s === 'completed') bucket.returned += 1
    }
    rootRentalStatusCounts = bucket
  }

  // 대표 상품정보 (대표 섹션 카드 표시용)
  if (parentProductId) {
    // 자식 선택: 부모 데이터 별도 조회 (BND-2: 삭제된 부모 노출 차단)
    const { data: rpData } = await admin
      .from('products')
      .select('id, name, brand, category, image_urls, product_code, code_series')
      .eq('id', rootId)
      .is('deleted_at', null)
      .single()
    if (rpData) {
      rootProduct = {
        id: rpData.id as string,
        name: rpData.name as string,
        brand: (rpData as Record<string, unknown>).brand as string | null,
        category: rpData.category as string,
        image_urls: (rpData.image_urls as string[]) ?? [],
        // selectedProduct.price12h/24h는 policySourceId(=부모) 기준 전용 쿼리로 이미
        // 페이지네이션과 무관하게 정확히 계산돼 있음(위 selectedPriceRules) — 재사용
        price12h: selectedProduct?.price12h ?? null,
        price24h: selectedProduct?.price24h ?? null,
        product_code: (rpData as Record<string, unknown>).product_code as string | null,
        code_series: (rpData as Record<string, unknown>).code_series as Record<string, unknown> | null,
        assetCount: rootAssetCount,
        assetTotal: rootAssetTotal,
      }
    }
  } else if (selectedProduct) {
    // 부모 선택: selectedProduct = rootProduct
    rootProduct = {
      id: selectedProduct.id,
      name: selectedProduct.name,
      brand: (selectedProduct as unknown as Record<string, unknown>).brand as string | null,
      category: (selectedProduct as unknown as Record<string, unknown>).category as string,
      image_urls: selectedProduct.image_urls,
      price12h: selectedProduct.price12h ?? null,
      price24h: selectedProduct.price24h ?? null,
      product_code: (selectedProduct as unknown as Record<string, unknown>).product_code as string | null,
      code_series: selectedProduct.code_series,
      assetCount: rootAssetCount,
      assetTotal: rootAssetTotal,
    }
  }

  return {
    selectedProduct,
    selectedPriceRules,
    rootProduct,
    inventoryList,
    rootRentalStatusCounts,
  }
}
