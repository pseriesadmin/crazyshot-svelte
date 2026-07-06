/**
 * PATCH /api/cms/assets/[id]
 * 자산 장치코드 업데이트 — OCR 스캔 결과 저장
 * body: { asset_code?: string, serial_number?: string, label_image_url?: string, ocr_raw_text?: string }
 *
 * NOTE: assets.id가 bigint인 Stage DB에서 RPC(p_asset_id uuid) 타입 불일치 발생
 *       admin client 직접 UPDATE 사용 (POST /api/cms/assets와 동일 패턴)
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
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

  const assetId = params.id
  if (!assetId) throw error(400, 'asset id 필수')

  const body = await request.json() as {
    asset_code?: string
    serial_number?: string
    label_image_url?: string
    ocr_raw_text?: string
  }

  if (!body.asset_code && !body.serial_number && !body.label_image_url && !body.ocr_raw_text) {
    throw error(400, 'asset_code / serial_number / label_image_url / ocr_raw_text 중 하나 이상 필요')
  }

  // 업데이트할 필드만 포함 (COALESCE 동작 — null이면 기존값 유지)
  const patch: Record<string, string> = {}
  if (body.asset_code)      patch.asset_code      = body.asset_code
  if (body.serial_number)   patch.serial_number   = body.serial_number
  if (body.label_image_url) patch.label_image_url = body.label_image_url
  if (body.ocr_raw_text)    patch.ocr_raw_text    = body.ocr_raw_text

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const { error: updateError } = await admin
    .from('assets')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .is('deleted_at', null)

  if (updateError) {
    console.error('[PATCH /api/cms/assets/:id] update error:', updateError)
    throw error(500, updateError.message)
  }
  return json({ success: true })
}
