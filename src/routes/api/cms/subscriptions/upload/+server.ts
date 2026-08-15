/**
 * POST /api/cms/subscriptions/upload
 * 구독 상품 이미지 업로드 — Supabase Storage (product-images 버킷 재사용, subscriptions/ prefix)
 *
 * 신규 버킷을 만들지 않고 기존 product-images 버킷을 prefix로 구분해 재사용한다
 * (신규 버킷 프로비저닝 회피 — 계획 승인 시 확정된 방식).
 *
 * 클라이언트에서 Canvas API로 리사이즈된 WebP Blob을 받아 저장.
 *   file: WebP (medium — 1200×900 max)
 *   plan_id: 구독 플랜 ID (BIGINT)
 *
 * 경로 규칙: subscriptions/{plan_id}/{uuid}.webp
 * subscription_plans.image_urls에 URL 추가 (append_subscription_image_url RPC)
 *
 * DELETE /api/cms/subscriptions/upload
 * Storage 오브젝트 삭제 + image_urls 배열에서 URL 제거.
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

const BUCKET = 'product-images'

function admin() {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw error(500, 'SUPABASE_SERVICE_ROLE_KEY missing')
  return createClient(getSupabaseUrl(), key)
}

// ── POST: 이미지 업로드 ─────────────────────────────────────────
export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) throw error(403, '권한 없음')

  const formData = await request.formData()
  const imageFile = formData.get('file') as File | null
  const planIdStr = (formData.get('plan_id') as string | null)?.trim()

  if (!imageFile || !planIdStr) throw error(400, 'file / plan_id 필수')
  if (imageFile.type !== 'image/webp') throw error(400, 'WebP 형식만 허용됩니다.')

  const planId = Number(planIdStr)
  if (!Number.isInteger(planId) || planId <= 0) throw error(400, 'plan_id가 올바르지 않습니다.')

  const db = admin()
  const uuid = crypto.randomUUID()
  const storagePath = `subscriptions/${planId}/${uuid}.webp`

  const buf = await imageFile.arrayBuffer()
  const uploadRes = await db.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'image/webp',
    upsert: false,
  })
  if (uploadRes.error) throw error(500, `이미지 저장 실패: ${uploadRes.error.message}`)

  const publicUrl = db.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl

  const { error: rpcError } = await db.rpc('append_subscription_image_url', {
    p_plan_id: planId,
    p_url: publicUrl,
  })
  if (rpcError) {
    // RPC 실패 시 이미 올라간 스토리지 파일 롤백 시도
    await db.storage.from(BUCKET).remove([storagePath])
    throw error(500, `이미지 URL 등록 실패: ${rpcError.message}`)
  }

  return json({ url: publicUrl })
}

// ── DELETE: 이미지 삭제 ────────────────────────────────────────
export const DELETE: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) throw error(403, '권한 없음')

  const { url: imageUrl, plan_id: planIdInput } = await request.json() as { url: string; plan_id: number }
  if (!imageUrl || !planIdInput) throw error(400, 'url / plan_id 필수')

  const db = admin()

  // URL에서 storage path 추출 (버킷 이후 경로)
  const bucketMarker = `/object/public/${BUCKET}/`
  const markerIdx = imageUrl.indexOf(bucketMarker)
  if (markerIdx !== -1) {
    const storagePath = imageUrl.slice(markerIdx + bucketMarker.length)
    await db.storage.from(BUCKET).remove([storagePath])
  }

  // image_urls 배열에서 해당 URL 제거
  const { data: current } = await db
    .from('subscription_plans')
    .select('image_urls')
    .eq('id', planIdInput)
    .single<{ image_urls: string[] }>()

  const filtered = (current?.image_urls ?? []).filter((u: string) => u !== imageUrl)
  const { error: updateError } = await db
    .from('subscription_plans')
    .update({ image_urls: filtered })
    .eq('id', planIdInput)
  if (updateError) throw error(500, `이미지 URL 삭제 실패: ${updateError.message}`)

  return json({ ok: true })
}
