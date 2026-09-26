import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { callTypedRpc } from '$lib/utils/rpc'
import { isIdentityApproved, IDENTITY_APPROVED_LOCK_MESSAGE } from '$lib/server/identityApproval'

const BUCKET = 'user-documents'

// 등록완료 목록의 개별 항목 삭제(2026-09-14 신규) — RPC/스키마 변경 없이 남은 (url,type) 짝만
// 계산해 기존 update_user_doc_url(부분 삭제, ≥1개 남을 때)·delete_user_doc(마지막 1개 삭제 시
// 전체 초기화 — update_user_doc_url은 빈 배열을 거부하므로 이 경우엔 위임 불가)에 넘긴다.
export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const body    = await request.json().catch(() => null) as { type?: string; docType?: string } | null
  const type    = String(body?.type ?? '').trim()
  const docType = String(body?.docType ?? '').trim()
  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })
  if (!docType) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  if (await isIdentityApproved(admin, session.user.id, type === 'foreign' ? 'foreign' : 'identity')) {
    return json({ ok: false, error: IDENTITY_APPROVED_LOCK_MESSAGE }, { status: 403 })
  }

  const urlColumn  = type === 'identity' ? 'identity_doc_url' : 'foreign_doc_urls'
  const typeColumn = type === 'identity' ? 'identity_type'    : 'foreign_type'
  const { data: existingProfile } = await admin
    .from('user_profiles')
    .select(`${urlColumn}, ${typeColumn}`)
    .eq('user_id', session.user.id)
    .maybeSingle()

  const existingUrls: string[] = (() => {
    const raw = (existingProfile as Record<string, unknown> | null)?.[urlColumn]
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  })()
  const existingTypes: string[] = (() => {
    const raw = (existingProfile as Record<string, unknown> | null)?.[typeColumn]
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  })()

  const targetIndex = existingTypes.indexOf(docType)
  if (targetIndex === -1) return json({ ok: false, error: '해당 항목을 찾을 수 없습니다.' }, { status: 404 })

  const removedUrl     = existingUrls[targetIndex]
  const remainingUrls  = existingUrls.filter((_, i) => i !== targetIndex)
  const remainingTypes = existingTypes.filter((_, i) => i !== targetIndex)

  if (remainingUrls.length === 0) {
    // 마지막 1개 삭제 — update_user_doc_url은 빈 배열을 거부(파일이 없습니다)하므로 전체
    // 초기화 전용 delete_user_doc RPC로 위임(identity_verified_at 등 연관 컬럼까지 정리됨)
    const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'delete_user_doc',
      { p_type: type },
    )
    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      console.error('[delete-doc-item] delete_user_doc rpc error:', rpcError?.message)
      return json({ ok: false, error: '삭제에 실패했습니다.' }, { status: 500 })
    }
  } else {
    const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
      locals.supabase,
      'update_user_doc_url',
      {
        p_type: type,
        p_doc_url: remainingUrls,
        p_identity_type: type === 'identity' ? remainingTypes : null,
        p_foreign_type: type === 'foreign' ? remainingTypes : null,
        p_foreign_stay_type: null,
      },
    )
    if (rpcError || !(data as { ok: boolean } | null)?.ok) {
      console.error('[delete-doc-item] update_user_doc_url rpc error:', rpcError?.message)
      return json({ ok: false, error: '삭제에 실패했습니다.' }, { status: 500 })
    }
  }

  // DB 반영이 끝난 뒤에만 스토리지 파일 삭제 — best-effort(실패해도 응답은 이미 성공 처리)
  const supabaseUrl = getSupabaseUrl()
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  if (removedUrl && removedUrl.startsWith(prefix)) {
    const path = removedUrl.slice(prefix.length)
    if (path.startsWith(`${session.user.id}/`)) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove([path])
      if (removeError) console.error('[delete-doc-item] storage cleanup error:', removeError.message)
    }
  }

  return json({ ok: true, docUrls: remainingUrls })
}
