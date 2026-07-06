/**
 * POST /api/cms/assets
 * 자산 신규 생성 — 자산이 없는 상품에서 스캔 저장 시 자동 생성
 * body: { product_id: string, serial_number?: string }
 * returns: { asset_id: string }
 *
 * NOTE: serial_number UNIQUE 제약 + RPC 시그니처 변경 불가 상황으로
 *       admin client 직접 INSERT 사용 (서버사이드 service_role — upload 엔드포인트와 동일 패턴)
 *       MCP 복구 후 create_asset_for_product RPC로 전환 예정
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
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

  const body = await request.json() as { product_id?: string; serial_number?: string }
  const productId = body.product_id?.trim()
  if (!productId) throw error(400, 'product_id 필수')

  // serial_number: 스캔값 우선, 없으면 UUID 자동 생성 (UNIQUE 제약 충족)
  const serialNumber = body.serial_number?.trim() || crypto.randomUUID()
  // asset_code: NOT NULL UNIQUE — 자동 생성 코드로 초기화 (이후 PATCH로 업데이트 가능)
  const assetCode = `AUTO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { data: inserted, error: insertError } = await admin
    .from('assets')
    .insert({ product_id: productId, asset_code: assetCode, serial_number: serialNumber, status: 'available' })
    .select('id')
    .single()

  if (insertError) {
    console.error('[POST /api/cms/assets] insert error:', insertError)
    throw error(500, insertError.message)
  }

  return json({ asset_id: String(inserted.id) })
}
