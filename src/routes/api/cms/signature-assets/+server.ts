/**
 * GET /api/cms/signature-assets
 * 현재 관리자의 서명/직인 자산 목록 반환 (삭제되지 않은 항목)
 * Phase 8-B-3: SealAssetPicker.svelte에서 호출
 */
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json([], { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: assets } = await (admin as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (k: string, v: string) => {
          is: (k: string, v: null) => {
            order: (k: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null }>
          }
        }
      }
    }
  }).from('cms_signature_assets')
    .select('id, asset_type, image_url, label, is_default')
    .eq('admin_id', session.user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return json(assets ?? [])
}
