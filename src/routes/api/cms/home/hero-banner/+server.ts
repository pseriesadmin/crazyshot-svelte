import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

const BUCKET = 'product-images'
const MEDIA_BUCKET = 'home-hero-media' // HTML·MP4 전용(Migration #800)
const PREFIX = 'home/hero-banner'

// 이미지는 MIME 에서 확장자를 정한다(파일 이름의 확장자는 신뢰하지 않음 — 이름이 .html 인 이미지가 HTML 로 오인되는 것 방지)
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heif': 'heif',
  'image/heic': 'heic',
}

function adminClient() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

async function requireCmsRole(locals: App.Locals): Promise<string> {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, 'Unauthorized')

  const { data: profile } = await locals.supabase
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  const role = (profile as { cms_role?: string | null } | null)?.cms_role
  if (!role) throw error(403, 'Forbidden')
  return role
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const role = await requireCmsRole(locals)

  // ── HTML·MP4: 서버는 업로드 허가증(서명 URL)만 발급하고 파일은 브라우저가 저장소로 직접 올린다.
  //    (서버리스 요청 본문 한도 약 4.5MB 때문에 큰 영상이 서버를 거치면 막힘. 형식·10MB 는 버킷이 강제한다.)
  //    공개 홈에서 방문자 브라우저가 실행하는 콘텐츠이므로 이미지보다 높은 등급(매니저 이상)만 등록할 수 있다.
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    if (!hasSettingsAccess(role)) throw error(403, 'HTML·영상은 매니저 이상만 등록할 수 있어요')
    const body = (await request.json().catch(() => null)) as { kind?: string } | null
    const kind = body?.kind
    if (kind !== 'html' && kind !== 'video') throw error(400, 'invalid kind')

    const path = `${PREFIX}/${crypto.randomUUID()}.${kind === 'html' ? 'html' : 'mp4'}`
    const admin = adminClient()
    const { data, error: signErr } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
    if (signErr || !data) throw error(500, '업로드 준비에 실패했어요')
    const { data: pub } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    return json({ path: data.path ?? path, token: data.token, url: pub.publicUrl })
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw error(400, 'file required')

  const ext = IMAGE_EXT[file.type]
  if (!ext) throw error(400, 'invalid file type')

  const path = `${PREFIX}/${crypto.randomUUID()}.${ext}`

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
  await requireCmsRole(locals)

  const { path } = (await request.json()) as { path?: string }
  if (!path) throw error(400, 'path required')

  const admin = adminClient()
  const { error: delErr } = await admin.storage.from(BUCKET).remove([path])
  if (delErr) throw error(500, delErr.message)

  return json({ ok: true })
}
