import { redirect, fail, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const { data: product } = await admin
    .from('products')
    .select('*')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single()

  if (!product) throw error(404, '상품을 찾을 수 없습니다.')

  // qr_payload 미설정 상품 backfill (마이그레이션 이전 등록 상품 대응)
  if (!product.qr_payload) {
    const qrPayload = `https://crazyshot.kr/qr/product/${product.id}`
    await admin.from('products').update({ qr_payload: qrPayload }).eq('id', product.id)
    product.qr_payload = qrPayload
  }

  const { data: priceRules } = await admin
    .from('price_rules')
    .select('duration_type, price, deposit_amount, late_fee_per_hour, damage_fee_percentage')
    .eq('product_id', params.id)
    .eq('is_active', true)
    .is('deleted_at', null)

  const { data: optionLinks } = await admin
    .rpc('get_product_option_links', { p_product_id: params.id })

  return { product, priceRules: priceRules ?? [], optionLinks: optionLinks ?? [] }
}

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
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
      .neq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()

    if (existing) {
      return fail(400, { error: '이미 사용 중인 슬러그입니다. 다른 슬러그를 사용해주세요.' })
    }

    const { error: updateError } = await admin
      .from('products')
      .update({ category, name, slug, brand, description, image_urls, specifications, is_active })
      .eq('id', params.id)

    if (updateError) {
      return fail(500, { error: '상품 수정에 실패했습니다. 다시 시도해주세요.' })
    }

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
        const { data: existing_rule } = await admin
          .from('price_rules')
          .select('id')
          .eq('product_id', params.id)
          .eq('duration_type', dtype)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle()

        if (existing_rule) {
          await admin
            .from('price_rules')
            .update({ price, deposit_amount: depositAmount, late_fee_per_hour: lateFeePerHour, damage_fee_percentage: damageFeePercentage })
            .eq('id', existing_rule.id)
        } else {
          await admin.from('price_rules').insert({
            product_id: params.id,
            duration_type: dtype,
            price,
            deposit_amount: depositAmount,
            late_fee_per_hour: lateFeePerHour,
            damage_fee_percentage: damageFeePercentage,
          })
        }
      }
    }

    // 옵션상품 연결 저장
    const optionLinksRaw = (form.get('option_links') as string | null) ?? '[]'
    let optionLinks: unknown[] = []
    try { optionLinks = JSON.parse(optionLinksRaw) } catch { /* ignore */ }
    await admin.rpc('upsert_product_option_links', {
      p_product_id: params.id,
      p_option_links: JSON.stringify(Array.isArray(optionLinks) ? optionLinks : []),
    })

    throw redirect(303, '/cms/products')
  },
}
