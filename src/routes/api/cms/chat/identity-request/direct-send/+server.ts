// POST /api/cms/chat/identity-request/direct-send
// 관리자가 고객 정보 패널(CustomerDetailPanel.svelte)의 "요청" 버튼으로 본인증명/외국인증명
// 등록요청 대화카드를 즉시 발송(Stephen 2026-08-27 요청).
// body: { session_id: string, doc_type?: 'identity' | 'foreign' }
//
// 흐름: 관리자 세션 확인 → chat_sessions에서 user_id 조회(closed/pending이면 open 승격,
//       coupon-gift/direct-send와 동일 패턴 — 이미 admin이 그 세션을 보고 있는 상태에서 보내는
//       액션이라 find_or_create_general_chat_session으로 재탐색할 필요가 없다) →
//       identity_request 메시지 INSERT(service_role) → 고객 브라우저 푸시 병행 발송.
//
// doc_type은 카드 문구·라벨에 영향을 주지 않는다 — Stephen이 지정한 카드 문구는 본인증명/
// 외국인증명 요청 모두 동일("본인증명 등록요청" / "개인정보 메뉴에서 본인증명정보를 등록
// 부탁드립니다.") — 어느 쪽이 트리거했는지는 로그·향후 확장용으로만 받아둔다.
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendPushToUser } from '$lib/server/push'

const DOC_BUCKET = 'user-documents'
const DOC_VALID_MONTHS = 6

// 만료(등록일 기준 6개월 경과)한 증명의 등록 목록·승인·스토리지 원본을 삭제하고 삭제한 파일 수를 반환.
// 미등록·유효·등록일 없음(만료 판정 불가)이면 아무것도 지우지 않고 0을 반환한다. 실패는 카드 발송을
// 막지 않는다(fail-soft) — 삭제 실패 시 0으로 취급.
async function deleteExpiredDocs(
  admin: SupabaseClient,
  userId: string,
  docType: 'identity' | 'foreign',
): Promise<number> {
  const urlCol = docType === 'identity' ? 'identity_doc_url' : 'foreign_doc_urls'
  const verifiedCol = `${docType}_verified_at`
  const { data } = await admin
    .from('user_profiles')
    .select(`${urlCol}, ${verifiedCol}`)
    .eq('user_id', userId)
    .maybeSingle()
  const profile = data as Record<string, unknown> | null
  const raw = profile?.[urlCol]
  const urls = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  const verifiedAt = profile?.[verifiedCol]
  if (urls.length === 0 || typeof verifiedAt !== 'string') return 0

  const expiresAt = new Date(verifiedAt)
  expiresAt.setMonth(expiresAt.getMonth() + DOC_VALID_MONTHS)
  if (expiresAt.getTime() >= Date.now()) return 0

  const reset = docType === 'identity'
    ? { identity_doc_url: null, identity_type: null, identity_verified_at: null, identity_approved_at: null }
    : {
        foreign_doc_url: null, foreign_doc_urls: null, foreign_type: null, foreign_stay_type: null,
        foreign_verified_at: null, foreign_approved_at: null, is_foreign: false,
      }
  const { error } = await admin
    .from('user_profiles')
    .update({ ...reset, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) {
    console.error('[identity-request/direct-send] 만료 목록 삭제 실패(fail-soft):', error.message)
    return 0
  }

  // DB 초기화가 끝난 뒤에만 스토리지 원본 삭제 — best-effort, 해당 고객 폴더 파일만
  const prefix = `${getSupabaseUrl()}/storage/v1/object/public/${DOC_BUCKET}/`
  const paths = urls
    .filter((u) => u.startsWith(prefix))
    .map((u) => u.slice(prefix.length))
    .filter((p) => p.startsWith(`${userId}/`))
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(DOC_BUCKET).remove(paths)
    if (rmErr) console.error('[identity-request/direct-send] 스토리지 원본 삭제 실패(fail-soft):', rmErr.message)
  }
  return urls.length
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const sessionId = (body?.session_id as string | undefined)?.trim() ?? ''
  const docType = body?.doc_type === 'foreign' ? 'foreign' : 'identity'

  if (!sessionId) {
    return json({ error: 'session_id는 필수입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, user_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const cs = chatSession as { user_id: string; status: string }
  const userId = cs.user_id

  if (cs.status === 'closed' || cs.status === 'pending') {
    await admin
      .from('chat_sessions')
      .update({ status: 'open', updated_at: new Date().toISOString() })
      .eq('id', sessionId)
  }

  // doc_type='foreign'이면 /account/profile의 본인증명·외국인증명 서브탭 중 외국인증명 탭으로
  // 바로 랜딩하도록 ?doc=foreign을 실어보낸다(ProfileTabContent.svelte activeDocTab 초기값 참고)
  const actionPayload = {
    type: 'identity_request',
    doc_type: docType,
    button_label: '본인증명 등록요청',
    action_url: docType === 'foreign'
      ? '/account/profile?tab=profile&doc=foreign'
      : '/account/profile?tab=profile',
  }

  const { data: messageRaw, error: msgErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:     sessionId,
      sender_type:    'admin',
      content:        '개인정보 메뉴에서 본인증명정보를 등록 부탁드립니다.',
      message_type:   'action_card',
      action_payload: actionPayload,
      is_read:        false,
    })
    .select()
    .single()

  if (msgErr) {
    return json({ error: '메시지 전송 오류' }, { status: 500 })
  }

  // 카드 저장에 성공한 뒤에만 만료(6개월 경과)한 증명의 등록 목록을 자동 삭제한다 — 삭제는 복구가
  // 불가능하므로, 카드 INSERT가 실패하면(위 return) 파일이 지워졌는데 고객은 요청을 못 받는 상태가
  // 되지 않도록 순서를 카드 → 삭제로 둔다(Stephen 2026-09-26 확정, 스토리지 원본까지 삭제).
  // 만료 판정은 서버가 직접 하므로 유효한(6개월 이내) 증명은 이 API를 직접 호출해도 삭제되지 않는다.
  // 승인 컬럼도 함께 비운다 — 등록일만 비우고 승인 시각이 남으면 고객 화면이 "승인됨"으로 잠겨
  // (isIdentityApproved: 등록일 없음 + 승인시각 있음 = 승인) 재등록을 못 하게 된다.
  // 삭제(복구 불가)는 manager 이상만 — partner는 요청 카드만 발송하고 파일은 삭제되지 않는다
  // (Stephen 2026-09-26 확정, 승인 취소 API(revoke-doc-approval)와 동일 등급).
  const deletedDocCount = hasSettingsAccess(cmsRole)
    ? await deleteExpiredDocs(admin, userId, docType)
    : 0

  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  // 고객 브라우저 푸시 (service-operations.md §15 원칙 — 채팅카드와 별개 경로로 병행 발송)
  await sendPushToUser(userId, 'identity_request', {
    title: '본인증명 등록을 요청드려요',
    body: '개인정보 메뉴에서 본인증명정보를 등록해주세요.',
    link: '/account/profile?tab=profile',
  })

  return json({ ok: true, message: messageRaw, deleted_count: deletedDocCount })
}
