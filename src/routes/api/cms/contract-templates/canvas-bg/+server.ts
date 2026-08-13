/**
 * POST /api/cms/contract-templates/canvas-bg
 * canvas 모드 계약서 배경 이미지 업로드 (Phase 6)
 *
 * ContractCanvasEditor.svelte의 onUploadPage 콜백에서 호출.
 * PNG/JPEG/WebP Blob을 Supabase Storage (product-images 버킷)에 저장하고 공개 URL 반환.
 *
 * 권한: manager 이상 (hasSettingsAccess) — P7-2와 동일 기준.
 * 최대 크기: 20MB (PDF 래스터화 결과 파일 크기 고려).
 */
import { json } from '@sveltejs/kit'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

const BUCKET   = 'product-images'
const MAX_SIZE = 20 * 1024 * 1024  // 20MB
const ALLOWED  = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) {
    return json({ error: '권한 없음 (manager 이상)' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: '요청 파싱 실패' }, { status: 400 })
  }

  const file = form.get('file') as File | null
  if (!file || !file.size) return json({ error: '파일이 없습니다.' }, { status: 400 })
  if (file.size > MAX_SIZE) return json({ error: '파일 크기는 20MB 이하여야 합니다.' }, { status: 400 })
  if (!ALLOWED.has(file.type)) {
    return json({ error: 'PNG, JPEG, WebP 파일만 허용됩니다.' }, { status: 400 })
  }

  const ext  = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const path = `canvas-bg/${crypto.randomUUID()}.${ext}`

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const buf   = await file.arrayBuffer()

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: false })

  if (uploadError) {
    return json({ error: `업로드 실패: ${uploadError.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)
  return json({ url: publicUrl })
}
