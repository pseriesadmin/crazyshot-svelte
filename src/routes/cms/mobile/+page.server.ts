import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  // 상품 목록은 인증 여부와 무관하게 로드 (레이아웃에서 인증 처리)
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const { data: products } = await admin
    .from('products')
    .select('id, name, product_code, category, image_urls, is_active')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(200)

  return {
    products: (products ?? []) as Array<{
      id: string
      name: string
      product_code: string | null
      category: string
      image_urls: string[]
      is_active: boolean
    }>,
  }
}
