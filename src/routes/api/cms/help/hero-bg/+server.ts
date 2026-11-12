import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

const BUCKET = 'product-images'
const PREFIX = 'help/hero-bg'

function adminClient() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, 'Unauthorized')

  const { data: profile } = await locals.supabase
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  if (!(profile as { cms_role?: string | null } | null)?.cms_role) throw error(403, 'Forbidden')

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw error(400, 'file required')

  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/heif', 'image/heic']
  if (!allowed.includes(file.type)) throw error(400, 'invalid file type')

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const uuid = crypto.randomUUID()
  const path = `${PREFIX}/${uuid}.${ext}`

  const admin = adminClient()
  const buf = await file.arrayBuffer()
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: false,
  })
  if (upErr) throw error(500, upErr.message)

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  return json({ url: pub.publicUrl, path })
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, 'Unauthorized')

  const { data: profile } = await locals.supabase
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  const delRole = (profile as { cms_role?: string | null } | null)?.cms_role
  if (!delRole) throw error(403, 'Forbidden')
  // 정책 결정 2026-11-11(Stephen): 배너 이미지 삭제는 매니저 이상만 — 파트너 불가
  if (!hasSettingsAccess(delRole)) throw error(403, '배너 삭제는 매니저 이상만 할 수 있어요')

  const { path } = (await request.json()) as { path?: string }
  if (!path) throw error(400, 'path required')

  const admin = adminClient()
  const { error: delErr } = await admin.storage.from(BUCKET).remove([path])
  if (delErr) throw error(500, delErr.message)

  return json({ ok: true })
}
