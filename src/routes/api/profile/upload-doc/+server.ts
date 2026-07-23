import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { UPLOAD_ACCEPTED_TYPES, getMimeExtension } from '$lib/utils/fileValidation'

const BUCKET = 'user-documents'
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const form = await request.formData()
  const type         = String(form.get('type')          ?? '').trim()
  const identityType = String(form.get('identity_type') ?? '').trim() || null
  const file         = form.get('file') as File | null

  if (!file || !file.size) return json({ ok: false, error: '파일이 없습니다.' }, { status: 400 })
  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })
  if (file.size > MAX_SIZE) return json({ ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 })

  // 서버사이드 MIME 재검증 (클라이언트 우회 방어)
  if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as (typeof UPLOAD_ACCEPTED_TYPES)[number])) {
    return json({ ok: false, error: 'PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요.' }, { status: 400 })
  }

  const ext  = getMimeExtension(file.type)
  const uuid = crypto.randomUUID()
  const path = `${session.user.id}/${type}_${uuid}.${ext}`

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[upload-doc] storage error:', uploadError.message)
    return json({ ok: false, error: '파일 업로드에 실패했습니다.' }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  // 사용자 세션으로 RPC 호출 (auth.uid() 기반 본인 데이터 업데이트)
  const { data, error: rpcError } = await locals.supabase.rpc('update_user_doc_url', {
    p_type:          type,
    p_doc_url:       publicUrl,
    p_identity_type: identityType,
  })

  if (rpcError || !(data as { ok: boolean } | null)?.ok) {
    console.error('[upload-doc] rpc error:', rpcError?.message)
    // 업로드된 파일 롤백
    await admin.storage.from(BUCKET).remove([path])
    return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
  }

  return json({ ok: true, docUrl: publicUrl, verifiedAt: new Date().toISOString() })
}
