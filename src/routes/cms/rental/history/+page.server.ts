import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = locals.supabase as unknown as any
  const { data: profile } = await sb
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  if (!profile?.cms_role) throw redirect(303, '/cms/login?notice=access_denied')

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')

  const { data: products } = await admin
    .from('products')
    .select('id, name, product_code, category, image_urls, is_active')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(200)

  return {
    products: (products ?? []) as Array<{
      id: string
      name: string
      product_code: string | null
      category: string
      image_urls: string[]
      is_active: boolean
    }>,
  }
}
