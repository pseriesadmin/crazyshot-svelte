/**
 * /api/cms/product-history
 * 상품 이력 CRUD — CMS 관리자 전용
 * GET  ?product_id=   → get_product_history RPC
 * POST body           → upsert_product_history_record (신규)
 * PUT  body           → upsert_product_history_record (수정)
 * DELETE ?id=         → delete_product_history_record (soft delete)
 */
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

interface HistoryImage {
  url: string
  thumb_url: string
  comment: string
  display_order: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

async function requireCmsRole(sb: AnyClient, userId: string): Promise<void> {
  const { data: profile } = await sb
    .from('user_profiles')
    .select('cms_role')
    .eq('id', userId)
    .single()
  if (!profile?.cms_role) throw error(403, '접근 권한이 없습니다.')
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  await requireCmsRole(sb, session.user.id)

  const productId = url.searchParams.get('product_id')
  if (!productId) throw error(400, 'product_id 필수')

  const { data, error: rpcError } = await sb
    .rpc('get_product_history', { p_product_id: productId })

  if (rpcError) throw error(500, rpcError.message)
  return json({ records: data ?? [] })
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  await requireCmsRole(sb, session.user.id)

  const body = await request.json() as {
    product_id: string
    recorded_date: string
    images: HistoryImage[]
  }

  if (!body.product_id || !body.recorded_date) {
    throw error(400, 'product_id, recorded_date 필수')
  }

  const { data, error: rpcError } = await sb.rpc(
    'upsert_product_history_record',
    {
      p_id: null,
      p_product_id: body.product_id,
      p_recorded_date: body.recorded_date,
      p_images: body.images ?? [],
      p_user_id: session.user.id,
    }
  )

  if (rpcError) throw error(500, rpcError.message)
  return json({ id: data })
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  await requireCmsRole(sb, session.user.id)

  const body = await request.json() as {
    id: string
    recorded_date: string
    images: HistoryImage[]
  }

  if (!body.id || !body.recorded_date) {
    throw error(400, 'id, recorded_date 필수')
  }

  const { data, error: rpcError } = await sb.rpc(
    'upsert_product_history_record',
    {
      p_id: body.id,
      p_product_id: null,
      p_recorded_date: body.recorded_date,
      p_images: body.images ?? [],
      p_user_id: session.user.id,
    }
  )

  if (rpcError) throw error(500, rpcError.message)
  return json({ id: data })
}

export const DELETE: RequestHandler = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  await requireCmsRole(sb, session.user.id)

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'id 필수')

  const { error: rpcError } = await sb.rpc(
    'delete_product_history_record',
    { p_id: id, p_user_id: session.user.id }
  )

  if (rpcError) throw error(500, rpcError.message)
  return json({ success: true })
}
