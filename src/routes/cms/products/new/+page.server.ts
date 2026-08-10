import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'
import { invalidateProductSearchCache } from '$lib/server/searchEngine/adapters/productSearchIndex'

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
  max_sequence: number
}
export type TaxonomyCodeSimple = { id: string; code: string; name: string; product_category: string | null; depth: number }
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
      .select('group_id, taxonomy_code_id, combo_row_id, date_option, max_sequence'),
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
      .select('id, code, name, product_category, depth')
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
    const comboRowId = (form.get('combo_row_id') as string | null) || null
    let comboCodeId: string | null = null
    let comboDateOption: string | null = null
    let comboMaxSequence: number | null = null
    let comboParentMaxSequence: number | null = null

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

        // 가장 하위(depth 높은) 분류코드 → p_code_id로 전달
        const codeIds = comboItems.map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id)
        const { data: deepest } = await admin
          .from('product_category_codes')
          .select('id, depth')
          .in('id', codeIds)
          .order('depth', { ascending: false })
          .limit(1)
        comboCodeId = deepest?.[0]?.id ?? null
      }
    }

    if (comboCodeId && comboDateOption !== null && comboParentMaxSequence !== null) {
      // 6-param 버전: 2단 계층 채번 (순번1=부모, 순번2=자식) — parent_max_sequence 있을 때
      const { error: codeErr } = await admin.rpc('generate_product_code', {
        p_product_id:          product.id,
        p_category:            category,
        p_code_id:             comboCodeId,
        p_date_option:         comboDateOption,
        p_max_sequence:        comboMaxSequence,   // 순번2(자식) 상한 — null 허용
        p_parent_max_sequence: comboParentMaxSequence, // 순번1(부모) 상한
      })
      if (codeErr) {
        if (codeErr.message?.includes('parent_max_sequence_exceeded')) {
          return fail(400, { error: '이 조합코드의 부모 순번 상한에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.' })
        }
        if (codeErr.message?.includes('max_sequence_exceeded')) {
          return fail(400, { error: '이 조합코드의 순번 상한에 도달했습니다. 코드설정에서 max_sequence를 늘려주세요.' })
        }
        return fail(500, { error: '품번 발행에 실패했습니다.' })
      }
    } else if (comboCodeId && comboDateOption !== null && comboMaxSequence !== null) {
      // 5-param 버전: 콤보 date_option + max_sequence 직접 반영 (순번1 없는 기존 경로)
      const { error: codeErr } = await admin.rpc('generate_product_code', {
        p_product_id:   product.id,
        p_category:     category,
        p_code_id:      comboCodeId,
        p_date_option:  comboDateOption,
        p_max_sequence: comboMaxSequence,
      })
      if (codeErr) {
        if (codeErr.message?.includes('max_sequence_exceeded')) {
          return fail(400, { error: '이 조합코드의 순번 상한에 도달했습니다. 코드설정에서 max_sequence를 늘려주세요.' })
        }
        return fail(500, { error: '품번 발행에 실패했습니다.' })
      }
    } else if (comboCodeId) {
      // 3-param 버전: code_id만 지정 (date_option은 taxonomy code_rule 또는 전역 설정)
      const { error: codeErr3 } = await admin.rpc('generate_product_code', {
        p_product_id: product.id,
        p_category: category,
        p_code_id: comboCodeId,
      })
      if (codeErr3) regWarnings.push('code')
    } else {
      // 2-param 버전: 카테고리 기반 자동
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

    // 등록 완료 후 해당 상품 패널 자동 오픈
    // regWarn 파라미터가 있으면 products 페이지에서 경고 토스트 표시 (qr: QR생성 실패, inv: 재고생성 실패)
    const warnParam = regWarnings.length > 0 ? `&regWarn=${encodeURIComponent(regWarnings.join(','))}` : ''
    invalidateProductSearchCache() // 신규 상품 등록 → 검색 인덱스 즉시 무효화
    throw redirect(303, `/cms/products?selected=${product.id}${warnParam}`)
  },
}
