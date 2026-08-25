import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { UPLOAD_ACCEPTED_TYPES, getMimeExtension } from '$lib/utils/fileValidation'
import { callTypedRpc } from '$lib/utils/rpc'

const BUCKET = 'user-documents'
const MAX_SIZE = 10 * 1024 * 1024 // 10MB — CMS 표준 기술 지침(개별 파일 업로드 용량)과 동일
const MAX_IDENTITY_FILES = 5

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const form = await request.formData()
  const type          = String(form.get('type') ?? '').trim()
  const identityTypes = form.getAll('identity_type').map(v => String(v).trim()).filter(Boolean)
  const files          = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)

  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })
  if (files.length === 0) return json({ ok: false, error: '파일이 없습니다.' }, { status: 400 })

  // identity: 최대 5개 동시 업로드 허용. foreign: 기존과 동일하게 1개만 허용(범위 밖 — 무변경)
  if (type === 'identity' && files.length > MAX_IDENTITY_FILES) {
    return json({ ok: false, error: `최대 ${MAX_IDENTITY_FILES}개까지 등록할 수 있어요.` }, { status: 400 })
  }
  if (type === 'foreign' && files.length > 1) {
    return json({ ok: false, error: '외국인증명은 1개 파일만 등록할 수 있어요.' }, { status: 400 })
  }

  for (const file of files) {
    if (file.size > MAX_SIZE) return json({ ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 })
    // 서버사이드 MIME 재검증 (클라이언트 우회 방어)
    if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as (typeof UPLOAD_ACCEPTED_TYPES)[number])) {
      return json({ ok: false, error: 'PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요.' }, { status: 400 })
    }
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 재등록 시 옛 파일 정리용 — 새 파일 업로드/DB 반영 전에 기존 URL을 미리 확보해 둔다
  const docColumn = type === 'identity' ? 'identity_doc_url' : 'foreign_doc_url'
  const { data: existingProfile } = await admin
    .from('user_profiles')
    .select(docColumn)
    .eq('user_id', session.user.id)
    .maybeSingle()
  const existingUrls: string[] = (() => {
    const raw = (existingProfile as Record<string, unknown> | null)?.[docColumn]
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
    if (typeof raw === 'string') return [raw]
    return []
  })()

  const uploadedPaths: string[] = []
  const publicUrls: string[] = []

  for (const file of files) {
    const ext  = getMimeExtension(file.type)
    const uuid = crypto.randomUUID()
    const path = `${session.user.id}/${type}_${uuid}.${ext}`

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })

    if (uploadError) {
      console.error('[upload-doc] storage error:', uploadError.message)
      // 이번 요청에서 이미 업로드된 파일들 롤백
      if (uploadedPaths.length > 0) await admin.storage.from(BUCKET).remove(uploadedPaths)
      return json({ ok: false, error: '파일 업로드에 실패했습니다.' }, { status: 500 })
    }

    uploadedPaths.push(path)
    publicUrls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }

  // 사용자 세션으로 RPC 호출 (auth.uid() 기반 본인 데이터 업데이트)
  const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
    locals.supabase,
    'update_user_doc_url',
    { p_type: type, p_doc_url: publicUrls, p_identity_type: identityTypes.length > 0 ? identityTypes : null },
  )

  if (rpcError || !(data as { ok: boolean } | null)?.ok) {
    console.error('[upload-doc] rpc error:', rpcError?.message)
    // 업로드된 파일 전부 롤백
    await admin.storage.from(BUCKET).remove(uploadedPaths)
    return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
  }

  // DB 반영이 끝난 뒤에만 옛 파일 삭제(반영 실패 시 옛 파일이 여전히 유효한 참조이므로 먼저 지우면 안 됨)
  // 실패해도 응답 자체는 이미 성공 처리된 핵심 동작(재등록)에 영향 주지 않도록 best-effort로 처리
  const supabaseUrl = getSupabaseUrl()
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  const oldPaths = existingUrls
    .filter(url => url.startsWith(prefix))
    .map(url => url.slice(prefix.length))
    .filter(path => path.startsWith(`${session.user.id}/`) && !uploadedPaths.includes(path))
  if (oldPaths.length > 0) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(oldPaths)
    if (removeError) console.error('[upload-doc] old file cleanup error:', removeError.message)
  }

  return json({ ok: true, docUrls: publicUrls, verifiedAt: new Date().toISOString() })
}
