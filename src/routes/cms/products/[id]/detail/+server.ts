/**
 * GET /cms/products/[id]/detail
 * PERF-4: 상품목록(/cms/products) 카드 선택/전환 전용 상세 조회 엔드포인트.
 * +page.svelte가 shallow routing(pushState)으로 선택을 전환할 때 이 엔드포인트를 호출해
 * loadSelectedProductDetail() 결과만 가져온다 — 목록/카테고리/집계 쿼리는 재실행하지 않는다.
 * (frozen 경로 src/routes/api/** 를 피해 /cms/products 하위에 배치 — 2026-08-09 Stephen 확인)
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { loadSelectedProductDetail } from '$lib/server/products/loadSelectedProductDetail'

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as unknown as any
  const { data: profile } = await sb
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  if (!profile?.cms_role) throw error(403, '접근 권한이 없습니다.')

  const productId = params.id
  if (!productId) throw error(400, 'product id 필수')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const { data: exists } = await admin
    .from('products')
    .select('id')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!exists) throw error(404, '상품을 찾을 수 없습니다.')

  const detail = await loadSelectedProductDetail(admin, productId)
  return json(detail)
}
