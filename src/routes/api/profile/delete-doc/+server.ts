import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { callTypedRpc } from '$lib/utils/rpc'

const BUCKET = 'user-documents'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const body = await request.json().catch(() => null) as { type?: string } | null
  const type = String(body?.type ?? '').trim()
  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 실제 Storage 파일 삭제용 — DB 초기화 전에 기존 URL을 먼저 확보해 둔다
  // foreign은 다중 파일 전체 목록이 foreign_doc_urls에 있으므로 그쪽을 조회(foreign_doc_url은
  // 첫 번째 파일만 담는 하위호환 스칼라 컬럼)
  const docColumn = type === 'identity' ? 'identity_doc_url' : 'foreign_doc_urls'
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

  // 사용자 세션으로 RPC 호출 (auth.uid() 기반 본인 데이터 삭제)
  const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
    locals.supabase,
    'delete_user_doc',
    { p_type: type },
  )

  if (rpcError || !(data as { ok: boolean } | null)?.ok) {
    console.error('[delete-doc] rpc error:', rpcError?.message)
    return json({ ok: false, error: '삭제에 실패했습니다.' }, { status: 500 })
  }

  // DB 초기화가 끝난 뒤에만 Storage 파일 삭제 — best-effort(실패해도 응답은 이미 성공 처리)
  const supabaseUrl = getSupabaseUrl()
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  const oldPaths = existingUrls
    .filter(url => url.startsWith(prefix))
    .map(url => url.slice(prefix.length))
    .filter(path => path.startsWith(`${session.user.id}/`))
  if (oldPaths.length > 0) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(oldPaths)
    if (removeError) console.error('[delete-doc] storage cleanup error:', removeError.message)
  }

  return json({ ok: true })
}
