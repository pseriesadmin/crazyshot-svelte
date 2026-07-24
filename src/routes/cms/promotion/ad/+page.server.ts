import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'

export type Banner = {
  id: string
  slot_key: string
  title: string | null
  image_url: string
  link_url: string | null
  device_type: string
  sort_order: number
  is_active: boolean
  valid_from: string | null
  valid_until: string | null
  created_at: string
}

// 슬롯 키 목록 (참고용 — 실제 상수는 +page.svelte에서 관리)
// hero_pc | hero_mobile | mid_banner_pc | mid_banner_mobile

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const tab = url.searchParams.get('tab') ?? 'slots'

  // banners 테이블은 migration #45에서 신설 — 타입 생성 전 캐스트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as unknown as any
  const { data: banners } = await db
    .from('banners')
    .select('*')
    .order('slot_key')
    .order('sort_order')

  return { tab, banners: (banners ?? []) as Banner[] }
}

export const actions: Actions = {
  createBanner: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const slot_key    = String(form.get('slot_key') ?? '')
    const title       = String(form.get('title') ?? '').trim() || null
    const image_url   = String(form.get('image_url') ?? '').trim()
    const link_url    = String(form.get('link_url') ?? '').trim() || null
    const device_type = String(form.get('device_type') ?? 'all')
    const sort_order  = Number(form.get('sort_order') ?? 0)
    const valid_from  = String(form.get('valid_from') ?? '') || null
    const valid_until = String(form.get('valid_until') ?? '') || null

    if (!slot_key || !image_url) return { ok: false, error: '슬롯과 이미지 URL은 필수입니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { error } = await db.from('banners').insert({
      slot_key,
      title,
      image_url,
      link_url,
      device_type,
      sort_order,
      valid_from,
      valid_until,
      is_active: true,
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  toggleBanner: async ({ request, locals }) => {
    const { session: sess2 } = await locals.safeGetSession()
    if (!sess2) return { ok: false, error: '인증 필요' }
    const cmsRole2 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole2 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))
    const is_active = form.get('is_active') === 'true'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { error } = await db
      .from('banners')
      .update({ is_active: !is_active })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  deleteBanner: async ({ request, locals }) => {
    const { session: sess3 } = await locals.safeGetSession()
    if (!sess3) return { ok: false, error: '인증 필요' }
    const cmsRole3 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole3 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { error } = await db
      .from('banners')
      .delete()
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}
