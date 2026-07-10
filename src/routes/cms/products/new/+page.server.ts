import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

export type MappingGroupSimple = { id: string; name: string; description: string | null; default_category: string | null }
export type MappingItemSimple = {
  group_id: string
  taxonomy_code_id: string
  combo_row_id: string
  date_option: 'none' | 'ym' | 'ymd'
  max_sequence: number
}
export type TaxonomyCodeSimple = { id: string; code: string; name: string; product_category: string | null; depth: number }

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const [{ data: rawGroups }, { data: rawItems }] = await Promise.all([
    admin.from('code_mapping_groups')
      .select('id, name, description, default_category')
      .eq('is_active', true)
      .eq('show_in_product_filter', true)   // 상품목록 노출 설정된 그룹만 (품번 배정 대상)
      .order('sort_order')
      .order('name'),
    admin.from('code_mapping_items')
      .select('group_id, taxonomy_code_id, combo_row_id, date_option, max_sequence'),
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
        is_active,
        sale_price: salePrice,
        sale_only: saleOnly,
        content_blocks,
        keywords,
      })
      .select('id')
      .single()

    if (productError || !product) {
      return fail(500, { error: '상품 등록에 실패했습니다. 다시 시도해주세요.' })
    }

    // QR payload 자동 생성 및 저장 (UUID 기반 — 슬러그 변경 시에도 불변)
    const qrPayload = `https://crazyshot.kr/qr/product/${product.id}`
    await admin.from('products').update({ qr_payload: qrPayload }).eq('id', product.id)

    // 품번(product_code) 자동 발행 — generate_product_code RPC (SECURITY DEFINER)
    const comboRowId = (form.get('combo_row_id') as string | null) || null
    let comboCodeId: string | null = null
    let comboDateOption: string | null = null
    let comboMaxSequence: number | null = null

    if (comboRowId) {
      // 선택된 콤보의 아이템 전체 조회 (code_id + date_option + max_sequence)
      const { data: comboItems } = await admin
        .from('code_mapping_items')
        .select('taxonomy_code_id, date_option, max_sequence')
        .eq('combo_row_id', comboRowId)

      if (comboItems && comboItems.length > 0) {
        // 콤보 행 공통 속성 (모든 아이템이 동일한 값을 가짐)
        comboDateOption = (comboItems[0] as { date_option: string }).date_option
        comboMaxSequence = (comboItems[0] as { max_sequence: number }).max_sequence

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

    if (comboCodeId && comboDateOption !== null && comboMaxSequence !== null) {
      // 5-param 버전: 콤보 date_option + max_sequence 직접 반영
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
      await admin.rpc('generate_product_code', {
        p_product_id: product.id,
        p_category: category,
        p_code_id: comboCodeId,
      })
    } else {
      // 2-param 버전: 카테고리 기반 자동
      await admin.rpc('generate_product_code', {
        p_product_id: product.id,
        p_category: category,
      })
    }

    const depositAmount = parseFloat((form.get('deposit_amount') as string | null) ?? '0') || 0
    const lateFeePerHour = parseFloat((form.get('late_fee_per_hour') as string | null) ?? '0') || 0
    const damageFeePercentage = parseFloat((form.get('damage_fee_percentage') as string | null) ?? '0') || 0

    type DurationTypeEnum = '12h' | '24h' | 'monthly'
    const priceRules: Array<{
      product_id: string
      duration_type: DurationTypeEnum
      price: number
      deposit_amount: number
      late_fee_per_hour: number
      damage_fee_percentage: number
    }> = []

    const price12h = parseFloat((form.get('price_12h') as string | null) ?? '')
    const price24h = parseFloat((form.get('price_24h') as string | null) ?? '')
    const priceMonthly = parseFloat((form.get('price_monthly') as string | null) ?? '')

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
      await admin.from('price_rules').insert(priceRules)
    }

    // 옵션상품 연결 저장
    const optionLinksRaw = (form.get('option_links') as string | null) ?? '[]'
    let optionLinks: unknown[] = []
    try { optionLinks = JSON.parse(optionLinksRaw) } catch { /* ignore */ }
    if (Array.isArray(optionLinks) && optionLinks.length > 0) {
      await admin.rpc('upsert_product_option_links', {
        p_product_id: product.id,
        p_option_links: JSON.stringify(optionLinks),
      })
    }

    // 등록 완료 후 해당 상품 패널 자동 오픈
    throw redirect(303, `/cms/products?selected=${product.id}`)
  },
}
