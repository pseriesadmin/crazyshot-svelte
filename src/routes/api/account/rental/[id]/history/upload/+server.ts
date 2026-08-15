/**
 * POST /api/account/rental/[id]/history/upload
 * 고객 반납 이력 이미지 업로드
 *
 * 클라이언트에서 Canvas API로 사전 리사이즈된 WebP Blob 두 개를 받아 저장.
 *   thumb: 400×300  (목록 카드 썸네일)
 *   large: 1200×900 (상세 뷰)
 *
 * 보안:
 *   1. session.user.id 인증 검증
 *   2. rental_reservations.user_id = session.user.id 소유권 검증 (서버 측)
 *   3. 검증 통과 후 service_role로 Storage 업로드 (product-images 버킷 RLS 우회)
 *
 * 경로 규칙: {product_id}/customer_history/thumb_{uuid}.webp
 *           {product_id}/customer_history/large_{uuid}.webp
 * Q6(확정): 반드시 예약 소유자(auth.uid() = user_id)인지 서버에서 검증 후에만 업로드 허용
 */
import { json, error } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

const BUCKET = 'product-images'

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) {
    throw error(400, '유효하지 않은 예약 ID입니다.')
  }

  // 소유권 검증: 이 예약이 로그인 사용자 소유인지 확인
  const { data: reservation, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('id, product_id, user_id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (resErr || !reservation) {
    throw error(403, '이 예약에 대한 이미지 업로드 권한이 없습니다.')
  }

  const productId = (reservation as { product_id: string }).product_id

  // FormData 파싱
  const formData = await request.formData()
  const thumbFile = formData.get('thumb') as File | null
  const largeFile = formData.get('large') as File | null

  if (!thumbFile || !largeFile) {
    throw error(400, 'thumb / large 파일 필수')
  }
  if (thumbFile.type !== 'image/webp' || largeFile.type !== 'image/webp') {
    throw error(400, 'WebP 형식만 허용됩니다.')
  }

  // service_role로 Storage 업로드 (product-images 버킷 RLS 우회)
  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
  const baseName = crypto.randomUUID()
  const thumbPath = `${productId}/customer_history/thumb_${baseName}.webp`
  const largePath = `${productId}/customer_history/large_${baseName}.webp`

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

  return json({ thumbUrl, largeUrl })
}
