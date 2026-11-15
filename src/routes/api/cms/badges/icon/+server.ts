import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sanitizeBadgeSvg } from '$lib/server/sanitizeBadgeSvg'
import { BADGE_SVG_SIZE_MESSAGE, MAX_BADGE_SVG_BYTES } from '$lib/utils/badgeSvgUrl'

// 배지 이미지(SVG) 업로드·삭제 — 매니저 이상만.
// 업로드된 SVG 는 서버에서 허용 목록 방식으로 정화한 결과만 저장한다(스크립트·이벤트·외부 참조 제거, 200KB 이하, viewBox 필수).
// 서비스 롤은 Storage 쓰기 전용이다. 저장된 파일은 <img> 로만 렌더한다.
const BUCKET = 'badge-icons'

function adminClient() {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw error(500, '서버 설정 오류')
  return createClient(getSupabaseUrl(), key)
}

async function requireManager(locals: App.Locals): Promise<Response | null> {
  const denied = await requireMenuAccessApi(locals, 'promotion.ad')
  if (denied) return denied
  const role = await getCmsRoleForAction(locals)
  if (!role) throw error(401, 'Unauthorized')
  if (!hasSettingsAccess(role)) throw error(403, '배지 이미지는 매니저 이상만 등록할 수 있어요')
  return null
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const denied = await requireManager(locals)
  if (denied) return denied

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) throw error(400, 'file required')
  if (file.size > MAX_BADGE_SVG_BYTES) throw error(400, BADGE_SVG_SIZE_MESSAGE)

  const raw = await file.text()
  const result = sanitizeBadgeSvg(raw)
  if (!result.ok) throw error(400, result.error)

  const path = `badges/${crypto.randomUUID()}.svg`
  const admin = adminClient()
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, new Blob([result.svg], { type: 'image/svg+xml' }), {
    contentType: 'image/svg+xml',
    upsert: false,
  })
  if (upErr) throw error(500, '업로드에 실패했어요')

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  return json({ url: pub.publicUrl, path })
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const denied = await requireManager(locals)
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { path?: string } | null
  const path = body?.path
  if (!path || !/^badges\/[0-9a-f-]{36}\.svg$/.test(path)) throw error(400, 'invalid path')

  const admin = adminClient()
  const { error: delErr } = await admin.storage.from(BUCKET).remove([path])
  if (delErr) throw error(500, '삭제에 실패했어요')
  return json({ ok: true })
}
