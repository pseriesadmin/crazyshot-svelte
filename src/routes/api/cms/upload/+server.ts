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
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { RequestHandler } from './$types'

const BUCKET = 'product-images'

// ── 업로드 ────────────────────────────────────────────────────
export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  const formData = await request.formData()
  const uploadType = (formData.get('type') as string | null) ?? 'product'

  // 고객 크레이지로그 첨부(product_id='log/...')만 비CMS 허용 — 그 외(상품·자산 라벨)는 CMS 직원 전용
  // 경로 탈출(`log/../<상품id>`)·쿼리/인코딩 문자가 섞인 값은 log 예외에서 제외(DELETE의 판정과 동일 기준)
  const rawProductId = ((formData.get('product_id') as string | null)?.trim() ?? '')
  const isCustomerLogUpload =
    uploadType !== 'label' &&
    rawProductId.startsWith('log/') &&
    !/(^|\/)\.\.(\/|$)/.test(rawProductId) &&
    !/[?#%\\]/.test(rawProductId)
  if (!isCustomerLogUpload && !(await getCmsRoleForAction(locals))) {
    throw error(403, '접근 권한이 없습니다.')
  }

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

  // 자식→부모 치환: 모바일에서 자식(재고 단위) product_id가 전달될 때 부모 기준으로 저장
  // products.md §4-0: 이미지는 부모 상품이 등록관리 책임. PC CMS의 동일 정책(+page.server.ts
  // sectionType==='images' 자식→부모 치환)을 공용 업로드 엔드포인트에도 동일하게 적용.
  let targetProductId = productId
  if (!productId.includes('/')) {
    // 이력 업로드 경로({product_id}/history/...)가 아닌 일반 상품 이미지 업로드만 대상
    const { data: parentCheck } = await admin
      .from('products')
      .select('parent_product_id')
      .eq('id', productId)
      .maybeSingle()
    const parentId = (parentCheck as { parent_product_id: string | null } | null)?.parent_product_id
    if (parentId) targetProductId = parentId
  }

  const baseName = crypto.randomUUID()
  const thumbPath = `${targetProductId}/thumb_${baseName}.webp`
  const largePath = `${targetProductId}/large_${baseName}.webp`

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

  // 이력 업로드(/history 경로)가 아닌 경우 products.image_urls에 append (부모 기준)
  if (!productId.includes('/')) {
    await admin.rpc('append_product_image_url', {
      p_product_id: targetProductId,
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

  // 고객 크레이지로그 첨부(log/ 경로)만 비CMS 허용 — 상품 이미지 삭제는 CMS 직원 전용.
  // 판정은 URL 문자열 포함 여부가 아니라 "실제로 삭제할 Storage 경로" 기준이어야 한다 —
  // includes('/product-images/log/')는 'log/../<상품id>/…'·쿼리·프래그먼트로 우회 가능.
  const isCustomerLogPath =
    largePath.startsWith('log/') && !/(^|\/)\.\.(\/|$)/.test(largePath) && !/[?#%\\]/.test(largePath)
  if (!isCustomerLogPath && !(await getCmsRoleForAction(locals))) {
    throw error(403, '접근 권한이 없습니다.')
  }

  const thumbPath = largePath.replace('/large_', '/thumb_')

  // Storage 경로 첫 세그먼트 = 이미지가 저장된 product_id (부모 또는 자식)
  // POST 수정 이후: 부모 id 폴더에 저장됨. 레거시: 자식 id 폴더.
  // 어느 경우든 largePath의 첫 세그먼트가 실제 image_urls를 보유한 product 행을 가리킨다.
  const pathProductId = largePath.split('/')[0]

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  // thumb + large 동시 삭제 (한쪽 실패해도 계속)
  await Promise.allSettled([
    admin.storage.from(BUCKET).remove([largePath]),
    admin.storage.from(BUCKET).remove([thumbPath]),
  ])

  // products.image_urls 배열에서 해당 URL 제거 (기존에는 Storage 파일만 삭제하고 DB 배열은 갱신 안 해 고아 URL이 남는 결함)
  if (pathProductId && !pathProductId.includes('/')) {
    try {
      const { data: productRow } = await admin
        .from('products')
        .select('image_urls')
        .eq('id', pathProductId)
        .maybeSingle()
      const currentUrls = (productRow as { image_urls: string[] } | null)?.image_urls ?? []
      const updatedUrls = currentUrls.filter(u => u !== largeUrl)
      if (updatedUrls.length !== currentUrls.length) {
        await admin
          .from('products')
          .update({ image_urls: updatedUrls })
          .eq('id', pathProductId)
      }
    } catch (e) {
      console.warn('[upload DELETE] image_urls 배열 갱신 실패:', e instanceof Error ? e.message : e)
    }
  }

  return json({ deleted: true })
}
