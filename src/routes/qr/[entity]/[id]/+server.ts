import { redirect } from '@sveltejs/kit'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import type { RequestHandler } from './$types'

// QR 코드 스캔 핸들러
// 스캔 시 CMS 상세 패널로 redirect
// id: UUID 또는 product_code (품번) 양쪽 지원

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET: RequestHandler = async ({ params, locals }) => {
  const { entity, id } = params
  const { session } = await locals.safeGetSession()

  if (entity !== 'product') {
    const reservationTarget = entity === 'reservation' ? `/cms/reservation?selected=${id}` : '/cms'
    if (!session) throw redirect(303, `/cms/login?next=${encodeURIComponent(reservationTarget)}`)
    throw redirect(303, reservationTarget)
  }

  // product: UUID면 직접 사용, 품번이면 DB 조회
  // QR-CASE-1: product_code는 date_part('all')가 소문자로 섞여 들어갈 수 있어(§2-3)
  // toUpperCase() 강제 대문자 변환 후 비교하면 대소문자 불일치로 매칭 실패함 —
  // ilike로 대소문자 무관 정확 매칭
  let productId = id
  if (!UUID_RE.test(id)) {
    // 품번으로 UUID 조회
    const { data, error } = await locals.supabase
      .from('products')
      .select('id')
      .ilike('product_code', escapeLikePattern(id))
      .is('deleted_at', null)
      .single()
    if (error || !data || !('id' in data)) {
      throw redirect(303, `/cms/products?error=qr_not_found&code=${encodeURIComponent(id)}`)
    }
    productId = (data as { id: string }).id
  }

  const target = `/cms/products?selected=${productId}`

  if (!session) {
    throw redirect(303, `/cms/login?next=${encodeURIComponent(target)}`)
  }

  throw redirect(303, target)
}
