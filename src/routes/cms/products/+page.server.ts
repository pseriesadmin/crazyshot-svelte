import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const category = url.searchParams.get('category') ?? 'all'
  const q = url.searchParams.get('q') ?? ''
  const selectedId = url.searchParams.get('selected') ?? null
  const initialTab = url.searchParams.get('tab') ?? null

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // 코드설정에서 생성된 활성 루트 분류 목록 (depth=0, is_active=true)
  const { data: rawCategories } = await admin
    .from('product_category_codes')
    .select('code, name, product_category, sort_order')
    .eq('depth', 0)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  const categories = (rawCategories ?? []).map((c) => ({
    value: c.product_category ?? c.code.toLowerCase(),
    label: c.name,
  }))

  let query = admin
    .from('products')
    .select('id, category, name, slug, brand, image_urls, is_active, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (category !== 'all') query = query.eq('category', category)
  if (q) query = query.ilike('name', `%${q}%`)

  const { data: products } = await query

  const productIds = (products ?? []).map((p) => p.id)

  const stockCounts: Record<string, number> = {}
  let prices24h: Record<string, number> = {}
  let prices12h: Record<string, number> = {}

  if (productIds.length > 0) {
    // 자식 재고 목록 (parent_product_id로 연결된 복제본)
    const { data: childProducts } = await admin
      .from('products')
      .select('id, parent_product_id')
      .in('parent_product_id', productIds)
      .is('deleted_at', null)

    const allIds = [...productIds, ...(childProducts ?? []).map((c) => c.id)]

    // 현재 대여 중(in_use) product_id 목록
    const { data: inUseRentals } = await admin
      .from('rental_reservations')
      .select('product_id')
      .eq('status', 'in_use')
      .in('product_id', allIds)

    const inUseSet = new Set((inUseRentals ?? []).map((r) => r.product_id))

    // 가용 재고 수 계산 (self + children 중 in_use 아닌 것)
    for (const product of products ?? []) {
      const family = [
        product.id,
        ...(childProducts ?? [])
          .filter((c) => c.parent_product_id === product.id)
          .map((c) => c.id),
      ]
      stockCounts[product.id] = family.filter((id) => !inUseSet.has(id)).length
    }

    // 24h 가격
    const { data: rules24h } = await admin
      .from('price_rules')
      .select('product_id, price')
      .in('product_id', productIds)
      .eq('duration_type', '24h')
      .eq('is_active', true)
      .is('deleted_at', null)

    prices24h = (rules24h ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.product_id] = p.price
      return acc
    }, {})

    // 12h 가격
    const { data: rules12h } = await admin
      .from('price_rules')
      .select('product_id, price')
      .in('product_id', productIds)
      .eq('duration_type', '12h')
      .eq('is_active', true)
      .is('deleted_at', null)

    prices12h = (rules12h ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.product_id] = p.price
      return acc
    }, {})
  }

  // 선택된 상품 상세 데이터 로드
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
  type SelectedProduct = {
    id: string
    category: string
    name: string
    slug: string
    product_code: string | null
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
    assetCount: number
    price12h: number | null
    price24h: number | null
    assets: AssetDetail[]
  }
  let selectedProduct: SelectedProduct | null = null
  let selectedPriceRules: Array<{
    duration_type: string
    price: number
    deposit_amount: number | null
    late_fee_per_hour: number | null
    damage_fee_percentage: number | null
  }> = []

  if (selectedId) {
    const { data: sp } = await admin
      .from('products')
      .select('*')
      .eq('id', selectedId)
      .is('deleted_at', null)
      .single()

    if (sp) {
      selectedProduct = {
        ...sp,
        assetCount: stockCounts[sp.id] ?? 0,
        price12h: prices12h[sp.id] ?? null,
        price24h: prices24h[sp.id] ?? null,
        product_code: (sp as Record<string, unknown>).product_code as string | null ?? null,
        product_caption: (sp as Record<string, unknown>).product_caption as string | null ?? null,
        sale_price: (sp as Record<string, unknown>).sale_price as number | null ?? null,
        sale_only: (sp as Record<string, unknown>).sale_only as boolean ?? false,
      }

      const { data: priceRules } = await admin
        .from('price_rules')
        .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
        .eq('product_id', selectedId)
        .eq('is_active', true)
        .is('deleted_at', null)

      selectedPriceRules = priceRules ?? []

      const { data: assetDetails } = await admin
        .from('assets')
        .select('id, asset_code, serial_number, status, condition_notes, warehouse_location, label_image_url, ocr_raw_text')
        .eq('product_id', selectedId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })

      // selectedProduct is non-null here (inside `if (sp)` block)
      selectedProduct!.assets = (assetDetails ?? []) as AssetDetail[]
    }
  }

  // 선택된 상품의 재고 목록 (자신 + 자식 제품 — 동일 재고 그룹)
  type InventoryUnit = {
    id: string
    name: string
    product_code: string | null
    is_active: boolean
    price_rules: Array<{ duration_type: string; price: number }>
  }
  let inventoryList: InventoryUnit[] = []
  if (selectedId) {
    const { data: invData } = await admin
      .from('products')
      .select('id, name, product_code, is_active, price_rules!left(duration_type, price, is_active, deleted_at)')
      .or(`id.eq.${selectedId},parent_product_id.eq.${selectedId}`)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    inventoryList = (invData ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      product_code: (p as Record<string, unknown>).product_code as string | null,
      is_active: p.is_active as boolean,
      price_rules: ((p as Record<string, unknown>).price_rules as Array<{ duration_type: string; price: number; is_active: boolean; deleted_at: string | null }> ?? [])
        .filter((r) => r.is_active && !r.deleted_at)
        .map((r) => ({ duration_type: r.duration_type, price: r.price })),
    }))
  }

  return {
    products: (products ?? []).map((p) => ({
      ...p,
      assetCount: stockCounts[p.id] ?? 0,
      price24h: prices24h[p.id] ?? null as number | null,
      price12h: prices12h[p.id] ?? null as number | null,
    })),
    categories,
    category,
    q,
    selectedId,
    initialTab,
    selectedProduct,
    selectedPriceRules,
    inventoryList,
  }
}

export const actions: Actions = {
  toggleStatus: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const id = form.get('id') as string
    const isActive = form.get('is_active') === 'true'

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    await admin.from('products').update({ is_active: !isActive }).eq('id', id)

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

    if (sectionType === 'basic') {
      const name = ((form.get('name') as string | null) ?? '').trim()
      const brand = ((form.get('brand') as string | null) ?? '').trim() || null
      const caption = ((form.get('caption') as string | null) ?? '').trim().slice(0, 20) || null
      const description = ((form.get('description') as string | null) ?? '').trim() || null
      const is_active = form.get('is_active') === 'true'
      const category = ((form.get('category') as string | null) ?? '').trim() || null

      if (!name) return fail(400, { error: '상품명은 필수입니다.' })

      const updatePayload: Record<string, unknown> = { name, brand, product_caption: caption, description, is_active }
      if (category) updatePayload.category = category

      const { error: updateError } = await admin
        .from('products')
        .update(updatePayload)
        .eq('id', productId)

      if (updateError) return fail(500, { error: '수정에 실패했습니다.' })
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

      // sale_price / sale_only → products 테이블
      await admin.from('products').update({ sale_price: salePrice, sale_only: saleOnly }).eq('id', productId)

      const depositAmount = parseFloat((form.get('deposit_amount') as string | null) ?? '0') || 0
      const lateFeePerHour = parseFloat((form.get('late_fee_per_hour') as string | null) ?? '0') || 0
      const damageFeePercentage = parseFloat((form.get('damage_fee_percentage') as string | null) ?? '0') || 0

      type DurationTypeEnum = '12h' | '24h' | 'monthly'
      const durationTypes: DurationTypeEnum[] = ['12h', '24h', 'monthly']
      const priceMap: Record<DurationTypeEnum, number | null> = {
        '12h': parseFloat((form.get('price_12h') as string | null) ?? '') || null,
        '24h': parseFloat((form.get('price_24h') as string | null) ?? '') || null,
        'monthly': parseFloat((form.get('price_monthly') as string | null) ?? '') || null,
      }

      for (const dtype of durationTypes) {
        // eslint-disable-next-line security/detect-object-injection
        const price = priceMap[dtype]
        if (price && price > 0) {
          // soft-delete된 행 포함 조회 (partial unique index WHERE deleted_at IS NULL 대응)
          const { data: anyRule } = await admin
            .from('price_rules')
            .select('id, deleted_at')
            .eq('product_id', productId)
            .eq('duration_type', dtype)
            .maybeSingle()

          if (anyRule) {
            // 기존 행(active 또는 soft-deleted) 모두 UPDATE로 재활성화
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

      const { error: updateError } = await admin
        .from('products')
        .update({ image_urls })
        .eq('id', productId)

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

    return { success: true, sectionType }
  },

  deleteProduct: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const productId = form.get('product_id') as string | null
    if (!productId) return fail(400, { error: '상품 ID 누락' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    const { error } = await admin
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', productId)

    if (error) return fail(500, { error: '삭제에 실패했습니다.' })
    return { success: true, action: 'deleteProduct' }
  },

  cloneProduct: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()
    const sourceProductId = form.get('source_product_id') as string | null
    const count = Math.min(20, Math.max(1, Number(form.get('count')) || 1))
    const autoCode = form.get('auto_code') !== 'false'
    const partnerCode = form.get('partner_code') === 'true'
    const partnerType = (form.get('partner_type') as string | null) ?? '제휴'
    const mode = (form.get('mode') as string | null) ?? 'new_product'

    if (!sourceProductId) return fail(400, { error: '원본 상품 ID가 누락됐습니다.' })

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

    const { data: source, error: sourceError } = await admin
      .from('products')
      .select('id, category, name, slug, brand, description, product_caption, image_urls, specifications, sale_price, sale_only')
      .eq('id', sourceProductId)
      .is('deleted_at', null)
      .single()

    if (sourceError || !source) return fail(404, { error: '원본 상품을 찾을 수 없습니다.' })

    // ── add_inventory 모드: 동일 상품 재고 추가 ──────────────────
    if (mode === 'add_inventory') {
      const productCode = (source as Record<string, unknown>).product_code as string | null
      if (!productCode) {
        return fail(400, { error: '부모 상품에 품번이 없습니다. 먼저 품번을 발행해주세요.' })
      }

      const { data: sourcePriceRulesInv } = await admin
        .from('price_rules')
        .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
        .eq('product_id', sourceProductId)
        .eq('is_active', true)
        .is('deleted_at', null)

      const createdIds: string[] = []
      for (let i = 1; i <= count; i++) {
        const slug = `${source.slug}-inv-${Date.now()}-${i}`

        const { data: newProduct, error: insertError } = await admin
          .from('products')
          .insert({
            category: source.category,
            name: source.name,
            slug,
            brand: source.brand,
            description: source.description,
            product_caption: source.product_caption,
            image_urls: source.image_urls,
            specifications: source.specifications,
            is_active: false,
            sale_price: source.sale_price,
            sale_only: source.sale_only,
            parent_product_id: sourceProductId,
          })
          .select('id')
          .single()

        if (insertError || !newProduct) {
          return fail(500, { error: `${i}번째 재고 추가에 실패했습니다.` })
        }

        await admin
          .from('products')
          .update({ qr_payload: `https://crazyshot.kr/qr/product/${newProduct.id}` })
          .eq('id', newProduct.id)

        await admin.rpc('generate_child_product_code', {
          p_product_id: newProduct.id,
          p_parent_product_id: sourceProductId,
        })

        if (sourcePriceRulesInv && sourcePriceRulesInv.length > 0) {
          await admin.from('price_rules').insert(
            sourcePriceRulesInv.map((rule) => ({
              product_id: newProduct.id,
              duration_type: rule.duration_type,
              price: rule.price,
              deposit_amount: rule.deposit_amount,
              late_fee_per_hour: rule.late_fee_per_hour,
              damage_fee_percentage: rule.damage_fee_percentage,
            }))
          )
        }
        createdIds.push(newProduct.id)
      }
      return { success: true, cloned: createdIds.length, mode: 'add_inventory', partnerCode: false }
    }

    // ── new_product 모드: 기존 복제 로직 ─────────────────────────
    // 제휴상품 품번용 하위 분류코드 조회 (source.category 기준)
    let partnerCodeId: string | null = null
    if (partnerCode) {
      const { data: mainCode } = await admin
        .from('product_category_codes')
        .select('id')
        .eq('product_category', source.category)
        .eq('depth', 0)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle()

      if (mainCode) {
        const { data: subCode } = await admin
          .from('product_category_codes')
          .select('id')
          .eq('parent_id', mainCode.id)
          .eq('name', partnerType)
          .eq('depth', 1)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle()

        partnerCodeId = subCode?.id ?? null
      }
    }

    const { data: sourcePriceRules } = await admin
      .from('price_rules')
      .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
      .eq('product_id', sourceProductId)
      .eq('is_active', true)
      .is('deleted_at', null)

    const { data: sourceOptions } = await admin
      .rpc('get_product_option_links', { p_product_id: sourceProductId })

    const createdIds: string[] = []

    for (let i = 1; i <= count; i++) {
      let slug = `${source.slug}-copy`
      let suffix = 1
      while (true) {
        const { data: existing } = await admin
          .from('products').select('id').eq('slug', slug).is('deleted_at', null).maybeSingle()
        if (!existing) break
        slug = `${source.slug}-copy-${suffix++}`
      }

      const { data: newProduct, error: insertError } = await admin
        .from('products')
        .insert({
          category: source.category,
          name: source.name,
          slug,
          brand: source.brand,
          description: source.description,
          product_caption: source.product_caption,
          image_urls: source.image_urls,
          specifications: source.specifications,
          is_active: false,
          sale_price: source.sale_price,
          sale_only: source.sale_only,
        })
        .select('id')
        .single()

      if (insertError || !newProduct) {
        return fail(500, { error: `${i}번째 복제 등록에 실패했습니다.` })
      }

      await admin.from('products')
        .update({ qr_payload: `https://crazyshot.kr/qr/product/${newProduct.id}` })
        .eq('id', newProduct.id)

      if (partnerCode) {
        if (!partnerCodeId) {
          return fail(400, {
            error: `이 카테고리에 '${partnerType}' 하위 분류코드가 등록되지 않았습니다. 코드설정에서 먼저 추가해주세요.`,
          })
        }
        await admin.rpc('generate_product_code', {
          p_product_id: newProduct.id,
          p_category: source.category,
          p_code_id: partnerCodeId,
        })
      } else if (autoCode) {
        await admin.rpc('generate_product_code', {
          p_product_id: newProduct.id,
          p_category: source.category,
        })
      }

      if (sourcePriceRules && sourcePriceRules.length > 0) {
        await admin.from('price_rules').insert(
          sourcePriceRules.map((rule) => ({
            product_id: newProduct.id,
            duration_type: rule.duration_type,
            price: rule.price,
            deposit_amount: rule.deposit_amount,
            late_fee_per_hour: rule.late_fee_per_hour,
            damage_fee_percentage: rule.damage_fee_percentage,
          }))
        )
      }

      if (sourceOptions && Array.isArray(sourceOptions) && sourceOptions.length > 0) {
        await admin.rpc('upsert_product_option_links', {
          p_product_id: newProduct.id,
          p_option_links: JSON.stringify(sourceOptions),
        })
      }

      createdIds.push(newProduct.id)
    }

    return { success: true, cloned: createdIds.length, partnerCode }
  },
}
