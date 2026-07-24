import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인 필요')

  const body = await request.json() as { product_id?: string }
  const productId = body.product_id
  if (!productId) throw error(400, 'product_id 필요')

  const { data, error: rpcError } = await locals.supabase.rpc('toggle_product_wishlist', {
    p_product_id: productId,
  })

  if (rpcError) throw error(500, rpcError.message)

  const result = data as { ok: boolean; action?: string; error?: string } | null
  if (!result?.ok) throw error(400, result?.error ?? '처리 실패')

  return json({ ok: true, action: result.action })
}
