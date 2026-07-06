import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { Actions } from './$types'

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })

    const form = await request.formData()

    const category = (form.get('category') as string | null) ?? ''
    const name = (form.get('name') as string | null) ?? ''
    const slug = (form.get('slug') as string | null) ?? ''
    const brand = (form.get('brand') as string | null) || null
    const description = (form.get('description') as string | null) || null
    const is_active = form.get('is_active') === 'true'

    if (!category || !name || !slug) {
      return fail(400, { error: '카테고리, 상품명, 슬러그는 필수입니다.' })
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

    const { data: product, error: productError } = await admin
      .from('products')
      .insert({ category, name, slug, brand, description, image_urls, specifications, is_active })
      .select('id')
      .single()

    if (productError || !product) {
      return fail(500, { error: '상품 등록에 실패했습니다. 다시 시도해주세요.' })
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

    throw redirect(303, '/cms/products')
  },
}
