import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const category = url.searchParams.get('category') ?? 'all'
  const q = url.searchParams.get('q') ?? ''

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

  let assetCounts: Record<string, number> = {}
  let prices: Record<string, number> = {}

  if (productIds.length > 0) {
    const { data: assets } = await admin
      .from('assets')
      .select('product_id')
      .in('product_id', productIds)
      .is('deleted_at', null)

    assetCounts = (assets ?? []).reduce<Record<string, number>>((acc, a) => {
      acc[a.product_id] = (acc[a.product_id] ?? 0) + 1
      return acc
    }, {})

    const { data: priceRules } = await admin
      .from('price_rules')
      .select('product_id, price')
      .in('product_id', productIds)
      .eq('duration_type', '24h')
      .eq('is_active', true)
      .is('deleted_at', null)

    prices = (priceRules ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.product_id] = p.price
      return acc
    }, {})
  }

  return {
    products: (products ?? []).map((p) => ({
      ...p,
      assetCount: assetCounts[p.id] ?? 0,
      price24h: prices[p.id] ?? null as number | null,
    })),
    categories,
    category,
    q,
  }
}

export const actions: Actions = {
  toggleStatus: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { error: '인증 필요' }

    const form = await request.formData()
    const id = form.get('id') as string
    const isActive = form.get('is_active') === 'true'

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    await admin.from('products').update({ is_active: !isActive }).eq('id', id)

    return { success: true }
  },
}
