import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'
import { invalidateProductSearchCache } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { buildComboCategoryCode, getRootCode } from '$lib/utils/comboCategoryCode'
import { registerCrossLingualCandidatesFromParts } from '$lib/server/crossLingualSynonymScan'
import { extractContentBlocksText } from '$lib/server/searchEngine/adapters/productSearchIndex'

// rental_period_options / rental_method_options 는 database.ts 미등록 — 우회 헬퍼
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}

export type MappingGroupSimple = { id: string; name: string; description: string | null; default_category: string | null }
export type MappingItemSimple = {
  group_id: string
  taxonomy_code_id: string
  combo_row_id: string
  date_option: 'none' | 'ym' | 'ymd'
  max_sequence: number | null        // 순번2(자식) 상한 — NULL = 무제한
  parent_max_sequence: number | null // 순번1(부모) 상한 — NULL = 2단 미사용
}
export type TaxonomyCodeSimple = { id: string; code: string; name: string; product_category: string | null; depth: number; code_tier?: string | null }
export type RentalPeriodSimple = { id: string; name: string; display_order: number }
export type RentalMethodSimple = { id: string; name: string; display_order: number }
export type PickupPointSimple  = { id: string; name: string; address: string }

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const [{ data: rawGroups }, { data: rawItems }, periodsRes, methodsRes, pickupsRes] = await Promise.all([
    admin.from('code_mapping_groups')
      .select('id, name, description, default_category')
      .eq('is_active', true)
      .eq('show_in_product_filter', true)   // 상품목록 노출 설정된 그룹만 (품번 배정 대상)
      .order('sort_order')
      .order('name'),
    admin.from('code_mapping_items')
      .select('group_id, taxonomy_code_id, combo_row_id, date_option, max_sequence, parent_max_sequence'),
    untypedFrom(admin, 'rental_period_options')
      .select('id, name, display_order')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('display_order'),
    untypedFrom(admin, 'rental_method_options')
      .select('id, name, display_order')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('display_order'),
    admin.from('pickup_points')
      .select('id, name, address')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at'),
  ])

  const codeIds = [...new Set((rawItems ?? []).map((i: MappingItemSimple) => i.taxonomy_code_id))]
  let taxonomyCodes: TaxonomyCodeSimple[] = []
  if (codeIds.length > 0) {
    const { data: codes } = await admin
      .from('product_category_codes')
      .select('id, code, name, product_category, depth, code_tier')
      .in('id', codeIds)
      .eq('is_active', true)
      .is('deleted_at', null)
    taxonomyCodes = (codes ?? []) as TaxonomyCodeSimple[]
  }

  return {
    mappingGroups: (rawGroups ?? []) as MappingGroupSimple[],
    mappingItems: (rawItems ?? []) as MappingItemSimple[],
    taxonomyCodes,
    rentalPeriods: ((periodsRes as { data: RentalPeriodSimple[] | null }).data ?? []),
    rentalMethods: ((methodsRes as { data: RentalMethodSimple[] | null }).data ?? []),
    pickupPoints:  (pickupsRes.data ?? []) as PickupPointSimple[],
  }
}

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()

    let category = (form.get('category') as string | null) ?? ''
    const groupId = (form.get('group_id') as string | null) || null
    const comboRowId = (form.get('combo_row_id') as string | null) || null
    const name = (form.get('name') as string | null) ?? ''
    const slug = (form.get('slug') as string | null) ?? ''
    const brand = (form.get('brand') as string | null) || null
    const captionRaw = ((form.get('caption') as string | null) ?? '').trim()
    const product_caption = captionRaw || null
    const description = (form.get('description') as string | null) || null
    const is_active = form.get('is_active') === 'true'

    // category가 비어 있고 그룹이 선택됐으면 그룹의 default_category로 자동 설정
    if (!category && groupId) {
      const adminGrp = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
      const { data: grp } = await adminGrp
        .from('code_mapping_groups')
        .select('default_category')
        .eq('id', groupId)
        .single()
      category = (grp as { default_category: string | null } | null)?.default_category ?? ''
    }

    if (!name || !slug) {
      return fail(400, { error: '상품명, 슬러그는 필수입니다.' })
    }
    if (product_caption && product_caption.length > 20) {
      return fail(400, { error: '상품카피는 20자 이내로 입력해주세요.' })
    }
    if (!category) {
      return fail(400, { error: '카테고리를 설정할 수 없습니다. 코드설정 → 그룹 편집에서 기본 카테고리를 지정해주세요.' })
    }

    let specifications: Record<string, string> | null = null
    const specsStr = form.get('specifications') as string | null
    if (specsStr) {
      try { specifications = JSON.parse(specsStr) } catch { /* ignore */ }
    }

    let components: Record<string, string> | null = null
    const compStr = form.get('components') as string | null
    if (compStr) {
      try { components = JSON.parse(compStr) } catch { /* ignore */ }
    }

    let allowedPeriodIds: string[] = []
    const periodIdsStr = form.get('allowed_period_ids') as string | null
    if (periodIdsStr) { try { allowedPeriodIds = JSON.parse(periodIdsStr) } catch { /* ignore */ } }

    let allowedMethodIds: string[] = []
    const methodIdsStr = form.get('allowed_method_ids') as string | null
    if (methodIdsStr) { try { allowedMethodIds = JSON.parse(methodIdsStr) } catch { /* ignore */ } }

    let allowedPickupIds: string[] = []
    const pickupIdsStr = form.get('allowed_pickup_ids') as string | null
    if (pickupIdsStr) { try { allowedPickupIds = JSON.parse(pickupIdsStr) } catch { /* ignore */ } }

    let image_urls: string[] = []
    const imagesStr = form.get('image_urls') as string | null
    if (imagesStr) {
      try { image_urls = JSON.parse(imagesStr) } catch { /* ignore */ }
    }
    image_urls = image_urls.filter(Boolean)

    let content_blocks: unknown[] = []
    const contentBlocksStr = form.get('content_blocks') as string | null
    if (contentBlocksStr) {
      try { content_blocks = JSON.parse(contentBlocksStr) } catch { /* ignore */ }
    }

    let keywords: string[] = []
    const keywordsStr = form.get('keywords') as string | null
    if (keywordsStr) {
      try { keywords = JSON.parse(keywordsStr) } catch { /* ignore */ }
    }
    keywords = keywords.filter(Boolean).slice(0, 10)

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: existing } = await admin
      .from('products')
      .select('id')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle()

    if (existing) {
      return fail(400, { error: '이미 사용 중인 슬러그입니다. 다른 슬러그를 사용해주세요.' })
    }

    // 버그 수정(2026-08-13): 선택된 그룹에 조합코드가 1개 이상 등록돼 있는데 콤보를 고르지 않고
    // 제출하면, 아래 로직이 comboRowId 없음 → 2-param 카테고리 자동 폴백(UPPER(LEFT(category,3)))
    // 으로 조용히 빠져 코드설정에 없는 임의 품번("HYP" 등)이 발급되던 문제 방지 — 콤보가 존재하는
    // 그룹은 반드시 콤보 선택을 거치도록 서버에서 재확인(클라이언트 검증 우회 대비)
    if (groupId && !comboRowId) {
      const { count: comboCount } = await admin
        .from('code_mapping_items')
        .select('combo_row_id', { count: 'exact', head: true })
        .eq('group_id', groupId)
      if ((comboCount ?? 0) > 0) {
        return fail(400, { error: '이 분류에는 선택 가능한 조합코드가 있습니다. 조합코드를 먼저 선택해주세요.' })
      }
    }

    const salePriceRaw = (form.get('sale_price') as string | null) ?? ''
    const salePrice = parseInt(salePriceRaw, 10) || null
    const saleOnly = form.get('sale_only') === 'true'

    // BND-8/9: 가격 데이터를 INSERT 전에 파싱 + 검증 (실패 시 orphaned product 방지)
    const depositAmountPre = parseFloat((form.get('deposit_amount') as string | null) ?? '0') || 0
    const lateFeePerHourPre = parseFloat((form.get('late_fee_per_hour') as string | null) ?? '0') || 0
    const damageFeePercentagePre = parseFloat((form.get('damage_fee_percentage') as string | null) ?? '0') || 0
    const price12hPre = parseFloat((form.get('price_12h') as string | null) ?? '')
    const price24hPre = parseFloat((form.get('price_24h') as string | null) ?? '')
    const priceMonthlyPre = parseFloat((form.get('price_monthly') as string | null) ?? '')

    if (depositAmountPre < 0 || depositAmountPre > 10_000_000)
      return fail(400, { error: '보증금은 0~1,000만원 사이여야 합니다.' })
    if (lateFeePerHourPre < 0 || lateFeePerHourPre > 500_000)
      return fail(400, { error: '연체료는 0~500,000원 사이여야 합니다.' })
    if (damageFeePercentagePre < 0 || damageFeePercentagePre > 100)
      return fail(400, { error: '파손비율은 0~100 사이여야 합니다.' })
    if (salePrice !== null && (salePrice < 0 || salePrice > 99_999_999))
      return fail(400, { error: '판매가 범위를 초과했습니다.' })
    // BND-9: 24시간 가격 필수 (sale_only 상품은 대여가격 불필요 — 스킵)
    if (!saleOnly && (isNaN(price24hPre) || price24hPre <= 0))
      return fail(400, { error: '24시간(1일) 가격은 필수입니다.' })

    const { data: product, error: productError } = await admin
      .from('products')
      .insert({
        category,
        name,
        slug,
        brand,
        product_caption,
        description,
        image_urls,
        specifications,
        components,
        is_active,
        sale_price: salePrice,
        sale_only: saleOnly,
        content_blocks,
        keywords,
        allowed_period_ids: allowedPeriodIds,
        allowed_method_ids: allowedMethodIds,
        allowed_pickup_ids: allowedPickupIds,
      })
      .select('id')
      .single()

    if (productError || !product) {
      return fail(500, { error: '상품 등록에 실패했습니다. 다시 시도해주세요.' })
    }

    // QR payload 자동 생성 및 저장 (UUID 기반 — 슬러그 변경 시에도 불변)
    const qrPayload = `https://crazyshot.kr/qr/product/${product.id}`
    const regWarnings: string[] = []
    const { error: qrError } = await admin.from('products').update({ qr_payload: qrPayload }).eq('id', product.id)
    if (qrError) regWarnings.push('qr')

    // 품번(product_code) 자동 발행 — generate_product_code RPC (SECURITY DEFINER)
    let comboCodeId: string | null = null
    let comboDateOption: string | null = null
    let comboMaxSequence: number | null = null
    let comboParentMaxSequence: number | null = null
    // 버그 수정(2026-08-12): 합산 분류코드 — TIER_ORDER(대→중→소) 정렬 후 모든 코드 연결
    // 기존: depth가 가장 높은 단일 코드만 → 미리보기(comboCatCodeStr)와 불일치
    // 수정: buildComboCategoryCode()로 전체 합산 → 7-param p_category_code_override로 전달
    let comboCategoryCodeOverride: string | null = null

    if (comboRowId) {
      // 선택된 콤보의 아이템 전체 조회 (code_id + date_option + max_sequence + parent_max_sequence)
      const { data: comboItems } = await admin
        .from('code_mapping_items')
        .select('taxonomy_code_id, date_option, max_sequence, parent_max_sequence')
        .eq('combo_row_id', comboRowId)

      if (comboItems && comboItems.length > 0) {
        // 콤보 행 공통 속성 (모든 아이템이 동일한 값을 가짐)
        comboDateOption = (comboItems[0] as { date_option: string }).date_option
        comboMaxSequence = (comboItems[0] as { max_sequence: number | null }).max_sequence ?? null
        comboParentMaxSequence = (comboItems[0] as { parent_max_sequence: number | null }).parent_max_sequence ?? null

        // 모든 분류코드 조회 (code + code_tier + depth — TIER_ORDER 정렬에 필요)
        // 미리보기(load() 63-68행)와 동일한 활성/미삭제 필터 — 필터 불일치 시 미리보기에
        // 없던 코드가 code_series에 저장돼 "미확인 코드"로 노출되는 버그 방지
        const codeIds = comboItems.map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id)
        const { data: allCodes } = await admin
          .from('product_category_codes')
          .select('id, code, code_tier, depth')
          .in('id', codeIds)
          .eq('is_active', true)
          .is('deleted_at', null)

        if (allCodes && allCodes.length > 0) {
          // 합산 분류코드 빌드 (대→중→소 TIER_ORDER 정렬 후 연결)
          comboCategoryCodeOverride = buildComboCategoryCode(
            allCodes as Array<{ id: string; code: string; code_tier?: string | null; depth?: number }>
          )
          // p_code_id = 루트(대분류) 코드 — code_rule(prefix/format) 조회 전용
          const rootCode = getRootCode(
            allCodes as Array<{ id: string; code: string; code_tier?: string | null; depth?: number }>
          )
          comboCodeId = rootCode?.id ?? null
        }
      }
    }

    if (comboCategoryCodeOverride && comboCodeId && comboDateOption !== null) {
      // 7-param 버전: 모든 콤보 경로 통일 (기존 3/5/6-param을 하나로)
      // p_category_code_override = TIER_ORDER 합산 분류코드 (예: 'CAMSLR')
      // p_code_id = 루트(대분류) 코드 — code_rule(prefix/format) 조회에만 사용
      const { error: codeErr } = await admin.rpc('generate_product_code', {
        p_product_id:                product.id,
        p_category:                  category,
        p_code_id:                   comboCodeId,
        p_date_option:               comboDateOption,
        p_max_sequence:              comboMaxSequence,
        p_parent_max_sequence:       comboParentMaxSequence,
        p_category_code_override:    comboCategoryCodeOverride,
      })
      if (codeErr) {
        if (codeErr.message?.includes('parent_max_sequence_exceeded')) {
          return fail(400, { error: '이 조합코드의 부모 순번 상한에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.' })
        }
        if (codeErr.message?.includes('max_sequence_exceeded')) {
          return fail(400, { error: '이 조합코드의 순번 상한에 도달했습니다. 코드설정에서 max_sequence를 늘려주세요.' })
        }
        regWarnings.push('code')
      }
    } else if (comboCategoryCodeOverride && comboCodeId) {
      // 7-param: date_option 없는 콤보 (date_option = 전역 설정 따름 → 'ym' 기본값)
      const { error: codeErr } = await admin.rpc('generate_product_code', {
        p_product_id:                product.id,
        p_category:                  category,
        p_code_id:                   comboCodeId,
        p_date_option:               'ym',
        p_max_sequence:              comboMaxSequence,
        p_parent_max_sequence:       comboParentMaxSequence,
        p_category_code_override:    comboCategoryCodeOverride,
      })
      if (codeErr) regWarnings.push('code')
    } else {
      // 2-param 버전: 카테고리 기반 자동 (비-콤보 경로)
      // ⚠️ p_code_id를 명시적으로 null 전달 — 생략 시 PostgREST가 2-param/3-param(default) 오버로드를
      //    구분 못해 PGRST203(모호성) 에러 발생(2026-08-06 실제 curl 테스트로 확인된 라이브 버그)
      const { error: codeErr2 } = await admin.rpc('generate_product_code', {
        p_product_id: product.id,
        p_category: category,
        p_code_id: null,
      })
      if (codeErr2) regWarnings.push('code')
    }

    // 위에서 INSERT 전에 파싱·검증된 값 재사용 (중복 파싱 없음)
    const depositAmount = depositAmountPre
    const lateFeePerHour = lateFeePerHourPre
    const damageFeePercentage = damageFeePercentagePre
    const price12h = price12hPre
    const price24h = price24hPre
    const priceMonthly = priceMonthlyPre

    type DurationTypeEnum = '12h' | '24h' | 'monthly'
    const priceRules: Array<{
      product_id: string
      duration_type: DurationTypeEnum
      price: number
      deposit_amount: number
      late_fee_per_hour: number
      damage_fee_percentage: number
    }> = []

    if (!isNaN(price12h) && price12h > 0) {
      priceRules.push({ product_id: product.id, duration_type: '12h', price: price12h, deposit_amount: depositAmount, late_fee_per_hour: lateFeePerHour, damage_fee_percentage: damageFeePercentage })
    }
    if (!isNaN(price24h) && price24h > 0) {
      priceRules.push({ product_id: product.id, duration_type: '24h', price: price24h, deposit_amount: depositAmount, late_fee_per_hour: lateFeePerHour, damage_fee_percentage: damageFeePercentage })
    }
    if (!isNaN(priceMonthly) && priceMonthly > 0) {
      priceRules.push({ product_id: product.id, duration_type: 'monthly', price: priceMonthly, deposit_amount: depositAmount, late_fee_per_hour: lateFeePerHour, damage_fee_percentage: damageFeePercentage })
    }

    if (priceRules.length > 0) {
      const { error: priceInsertErr } = await admin.from('price_rules').insert(priceRules)
      if (priceInsertErr) regWarnings.push('price')
    }

    // 옵션상품 연결 저장
    const optionLinksRaw = (form.get('option_links') as string | null) ?? '[]'
    let optionLinks: unknown[] = []
    try { optionLinks = JSON.parse(optionLinksRaw) } catch { /* ignore */ }
    if (Array.isArray(optionLinks) && optionLinks.length > 0) {
      // JSONB 파라미터는 JS 배열 직접 전달 (JSON.stringify 금지 — string으로 처리되어 silent fail)
      const { error: optionsErr } = await admin.rpc('upsert_product_option_links', {
        p_product_id: product.id,
        p_option_links: optionLinks,
      })
      if (optionsErr) regWarnings.push('options')
    }

    // 재고 1개 자동 생성 (자식 상품 — create_hold_reservation 기준)
    const { error: invError } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: product.id })
    if (invError) regWarnings.push('inv')

    // BND-11: 임시 업로드 이미지를 실제 product_id 폴더로 이관
    const tempId = (form.get('temp_id') as string | null)?.trim()
    if (tempId && image_urls.length > 0) {
      const BUCKET = 'product-images'
      const supabaseUrl = getSupabaseUrl()
      const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
      const movedUrls: string[] = []
      let anyMoved = false

      for (const url of image_urls) {
        const tempPrefix = `temp/${tempId}/`
        if (!url.startsWith(prefix) || !url.slice(prefix.length).startsWith(tempPrefix)) {
          movedUrls.push(url) // 외부 URL 또는 이미 이관된 URL → 그대로 유지
          continue
        }
        const oldPath = url.slice(prefix.length)            // temp/{tempId}/large_{uuid}.webp
        const fileName = oldPath.split('/').pop() ?? ''
        const newLargePath = `${product.id}/${fileName}`
        const thumbFileName = fileName.replace('large_', 'thumb_')
        const thumbOldPath = `${tempPrefix}${thumbFileName}`
        const thumbNewPath = `${product.id}/${thumbFileName}`

        // Storage move (large + thumb)
        const { error: moveErr } = await admin.storage.from(BUCKET).move(oldPath, newLargePath)
        if (!moveErr) {
          // thumb 이관: 실패 시 large 이미지를 thumb 경로로 copy (깨진 링크 방지 폴백)
          const { error: thumbMoveErr } = await admin.storage.from(BUCKET).move(thumbOldPath, thumbNewPath)
          if (thumbMoveErr) {
            // BND-THUMB-1: thumb 이관 실패 → large → thumb 경로로 copy 폴백
            await admin.storage.from(BUCKET).copy(newLargePath, thumbNewPath).catch(() => { /* copy도 실패하면 무시 */ })
            regWarnings.push('thumb')
          }
          const newLargeUrl = admin.storage.from(BUCKET).getPublicUrl(newLargePath).data.publicUrl
          movedUrls.push(newLargeUrl)
          anyMoved = true
        } else {
          movedUrls.push(url) // large 이관 실패 시 temp URL 그대로 유지 (추후 배치 정리 대상)
        }
      }

      if (anyMoved) {
        // 이관된 URL로 products.image_urls 업데이트
        await admin.from('products').update({ image_urls: movedUrls }).eq('id', product.id)
      }
    }

    // §C-2: 이중언어 병기 패턴 학습 훅 (fire-and-forget — 등록 흐름 블록 금지)
    // content_blocks(상품설명)도 포함 — updateSection('content') 경로와 스캔 범위 일치
    registerCrossLingualCandidatesFromParts([
      name,
      brand,
      product_caption,
      extractContentBlocksText(content_blocks),
    ]).catch(() => {})

    // 등록 완료 후 해당 상품 패널 자동 오픈
    // regWarn 파라미터가 있으면 products 페이지에서 경고 토스트 표시 (qr: QR생성 실패, inv: 재고생성 실패)
    const warnParam = regWarnings.length > 0 ? `&regWarn=${encodeURIComponent(regWarnings.join(','))}` : ''
    invalidateProductSearchCache() // 신규 상품 등록 → 검색 인덱스 즉시 무효화
    throw redirect(303, `/cms/products?selected=${product.id}${warnParam}`)
  },
}
