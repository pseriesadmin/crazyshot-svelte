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
    .select('id, name, product_code, category, image_urls, is_active, description, parent_product_id')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single()

  if (productError || !product) throw error(404, '상품을 찾을 수 없습니다.')

  // 자식 상품이면 image_urls는 부모 기준으로 조회 (products.md §4-0)
  // 자식은 정책상 이미지를 갖지 않으므로 부모 image_urls를 대신 공급
  type RawProduct = {
    id: string
    name: string
    product_code: string | null
    category: string
    image_urls: string[] | null
    is_active: boolean
    description: string | null
    parent_product_id: string | null
  }
  const raw = product as RawProduct
  let resolvedImageUrls: string[] = raw.image_urls ?? []
  // 이름·분류·설명도 부모 값을 따른다(품번 product_code·is_active는 자식 고유값 — 자식 재고 부모 참조 전환 Phase 3-D)
  let resolvedName = raw.name
  let resolvedCategory = raw.category
  let resolvedDescription = raw.description
  if (raw.parent_product_id) {
    const { data: parentRow } = await admin
      .from('products')
      .select('name, category, description, image_urls')
      .eq('id', raw.parent_product_id)
      .is('deleted_at', null)
      .maybeSingle()
    const parent = parentRow as { name: string | null; category: string | null; description: string | null; image_urls: string[] | null } | null
    resolvedImageUrls = parent?.image_urls ?? []
    if (parent?.name) resolvedName = parent.name
    if (parent?.category) resolvedCategory = parent.category
    if (parent?.description) resolvedDescription = parent.description
  }

  const { data: assets } = await admin
    .from('assets')
    .select('id, asset_code, serial_number, label_image_url, ocr_raw_text, status, deleted_at')
    .eq('product_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  return {
    product: {
      id: raw.id,
      name: resolvedName,
      product_code: raw.product_code,
      category: resolvedCategory,
      image_urls: resolvedImageUrls,
      is_active: raw.is_active,
      description: resolvedDescription,
    } as {
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
