import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getMimeExtension } from '$lib/utils/fileValidation'
import { callTypedRpc } from '$lib/utils/rpc'
import { AVATAR_BUCKET, toAvatarLocation } from '$lib/server/userAvatars'

// 아바타는 서류(user-documents, 비공개 전환 대상)와 분리한 전용 공개 버킷에 저장한다(2026-10-03)
const BUCKET = AVATAR_BUCKET
const MAX_SIZE = 2 * 1024 * 1024 // 2MB — user-avatars 버킷 제한과 동일(클라이언트가 256px로 줄여 올리므로 정상 경로는 수십 KB)

// 아바타는 이미지 전용 — 클라이언트가 256px로 리사이즈한 PNG/JPEG/WebP만 받는다(버킷 허용 형식과 동일, HEIC/HEIF 제외)
const AVATAR_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file') as File | null

  if (!file || !file.size) return json({ ok: false, error: '파일이 없습니다.' }, { status: 400 })
  if (file.size > MAX_SIZE) return json({ ok: false, error: '파일 크기는 2MB 이하여야 합니다.' }, { status: 400 })

  // 서버사이드 MIME 재검증 (클라이언트 우회 방어) — 아바타는 이미지 파일만 허용
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type as (typeof AVATAR_ACCEPTED_TYPES)[number])) {
    return json({ ok: false, error: 'PNG, JPEG, WebP 이미지 파일만 업로드할 수 있어요.' }, { status: 400 })
  }

  const ext  = getMimeExtension(file.type)
  const uuid = crypto.randomUUID()
  const path = `${session.user.id}/avatar_${uuid}.${ext}`

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 교체 성공 후 이전 아바타 파일을 지우기 위해 현재 값을 먼저 확보한다(실패해도 업로드는 계속 — 정리는 best-effort)
  const { data: currentProfile } = await locals.supabase
    .from('user_profiles')
    .select('avatar_url')
    .eq('user_id', session.user.id)
    .maybeSingle()
  const previousAvatarUrl = (currentProfile as { avatar_url: string | null } | null)?.avatar_url ?? null

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[upload-avatar] storage error:', uploadError.message)
    return json({ ok: false, error: '파일 업로드에 실패했습니다.' }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path)

  // 사용자 세션으로 RPC 호출 (auth.uid() 기반 본인 데이터 업데이트)
  const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
    locals.supabase,
    'update_user_avatar',
    { p_avatar_url: publicUrl },
  )

  if (rpcError || !(data as { ok: boolean } | null)?.ok) {
    console.error('[upload-avatar] rpc error:', rpcError?.message)
    // 업로드된 파일 롤백
    await admin.storage.from(BUCKET).remove([path])
    return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
  }

  // 교체가 DB에 반영된 뒤에만 이전 아바타 삭제(반영 실패 시 이전 파일이 여전히 유효한 참조) — best-effort, 아바타 파일(`{uid}/avatar_`)만
  const previous = toAvatarLocation(previousAvatarUrl, session.user.id)
  if (previous && !(previous.bucket === BUCKET && previous.path === path)) {
    const { error: removeError } = await admin.storage.from(previous.bucket).remove([previous.path])
    if (removeError) console.error('[upload-avatar] 이전 아바타 정리 실패(fail-soft):', removeError.message)
  }

  return json({ ok: true, avatarUrl: publicUrl })
}
