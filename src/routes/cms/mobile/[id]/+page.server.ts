import { error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

interface Asset {
  id: string
  asset_code: string | null
  serial_number: string | null
  label_image_url: string | null
  ocr_raw_text: string | null
  status: string
  deleted_at: string | null
}

export const load: PageServerLoad = async ({ params }) => {
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const { data: product, error: productError } = await admin
    .from('products')
    .select('id, name, product_code, category, image_urls, is_active, description')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single()

  if (productError || !product) throw error(404, '상품을 찾을 수 없습니다.')

  const { data: assets } = await admin
    .from('assets')
    .select('id, asset_code, serial_number, label_image_url, ocr_raw_text, status, deleted_at')
    .eq('product_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  return {
    product: product as {
      id: string
      name: string
      product_code: string | null
      category: string
      image_urls: string[]
      is_active: boolean
      description: string | null
    },
    assets: (assets ?? []) as Asset[],

  }
}
