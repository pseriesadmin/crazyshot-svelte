/**
 * POST /api/cms/upload
 * CMS 상품 이미지 업로드 — Supabase Storage (product-images 버킷)
 *
 * 클라이언트에서 Canvas API로 사전 리사이즈된 WebP Blob 두 개를 받아 저장.
 *   thumb: 400×300  (목록 카드 썸네일)
 *   large: 1200×900 (상세 뷰 / 라이트박스)
 *
 * Supabase Image Transformation API 미사용 → 추가 과금 없음.
 * 경로 규칙: {product_id}/thumb_{uuid}.webp / {product_id}/large_{uuid}.webp
 * products.image_urls에는 large URL 저장 → thumb는 /large_ → /thumb_ 치환으로 도출.
 *
 * DELETE /api/cms/upload
 * Storage 오브젝트 삭제 — image_urls에서 제거 시 orphan 방지.
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

const BUCKET = 'product-images'

// ── 업로드 ────────────────────────────────────────────────────
export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const formData = await request.formData()
  const uploadType = (formData.get('type') as string | null) ?? 'product'

  // ── 자산 라벨 이미지 업로드 (OCR 스캔 사진 전용) ──
  if (uploadType === 'label') {
    const imageFile = formData.get('image') as File | null
    const assetId   = (formData.get('asset_id') as string | null)?.trim()
    if (!imageFile || !assetId) throw error(400, 'image / asset_id 필수')

    const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    const ext = imageFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const labelPath = `assets/${assetId}/label_${crypto.randomUUID()}.${ext}`
    const buf = await imageFile.arrayBuffer()
    const uploadRes = await admin.storage.from(BUCKET).upload(labelPath, buf, {
      contentType: imageFile.type,
      upsert: false,
    })
    if (uploadRes.error) throw error(500, `라벨 이미지 저장 실패: ${uploadRes.error.message}`)
    const labelUrl = admin.storage.from(BUCKET).getPublicUrl(labelPath).data.publicUrl
    return json({ labelUrl })
  }

  // ── 상품 이미지 업로드 (기존 로직) ──
  const thumbFile = formData.get('thumb') as File | null
  const largeFile = formData.get('large') as File | null
  const productId  = (formData.get('product_id') as string | null)?.trim()

  if (!thumbFile || !largeFile || !productId) {
    throw error(400, 'thumb / large / product_id 필수')
  }
  if (thumbFile.type !== 'image/webp' || largeFile.type !== 'image/webp') {
    throw error(400, 'WebP 형식만 허용됩니다.')
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const baseName = crypto.randomUUID()
  const thumbPath = `${productId}/thumb_${baseName}.webp`
  const largePath = `${productId}/large_${baseName}.webp`

  const [thumbBuf, largeBuf] = await Promise.all([
    thumbFile.arrayBuffer(),
    largeFile.arrayBuffer(),
  ])

  const [thumbRes, largeRes] = await Promise.all([
    admin.storage.from(BUCKET).upload(thumbPath, thumbBuf, {
      contentType: 'image/webp',
      upsert: false,
    }),
    admin.storage.from(BUCKET).upload(largePath, largeBuf, {
      contentType: 'image/webp',
      upsert: false,
    }),
  ])

  if (thumbRes.error) throw error(500, `썸네일 저장 실패: ${thumbRes.error.message}`)
  if (largeRes.error) throw error(500, `원본 저장 실패: ${largeRes.error.message}`)

  const thumbUrl = admin.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl
  const largeUrl = admin.storage.from(BUCKET).getPublicUrl(largePath).data.publicUrl

  // 이력 업로드(/history 경로)가 아닌 경우 products.image_urls에 append
  if (!productId.includes('/')) {
    await admin.rpc('append_product_image_url', {
      p_product_id: productId,
      p_url: largeUrl,
    })
  }

  return json({ thumbUrl, largeUrl })
}

// ── 삭제 (이미지 제거 시 orphan 방지) ──────────────────────────
export const DELETE: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const body = await request.json() as { largeUrl?: string }
  const largeUrl = body.largeUrl?.trim()
  if (!largeUrl) throw error(400, 'largeUrl 필수')

  // URL에서 Storage 경로 추출
  // 형식: https://{project}.supabase.co/storage/v1/object/public/product-images/{path}
  const supabaseUrl = getSupabaseUrl()
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  if (!largeUrl.startsWith(prefix)) {
    // Cloudinary 등 외부 URL은 삭제 불필요 — 무시
    return json({ deleted: false, reason: 'external_url' })
  }

  const largePath = largeUrl.slice(prefix.length)
  const thumbPath = largePath.replace('/large_', '/thumb_')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // thumb + large 동시 삭제 (한쪽 실패해도 계속)
  await Promise.allSettled([
    admin.storage.from(BUCKET).remove([largePath]),
    admin.storage.from(BUCKET).remove([thumbPath]),
  ])

  return json({ deleted: true })
}
