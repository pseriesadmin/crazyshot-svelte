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
const MAX_FOREIGN_FILES = 4 // 체류기간별 필수 증명서 콤보 최대 개수(단기/장기 각 4종)와 동일

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })

  const form = await request.formData()
  const type            = String(form.get('type') ?? '').trim()
  const identityTypes   = form.getAll('identity_type').map(v => String(v).trim()).filter(Boolean)
  const foreignTypes    = form.getAll('foreign_type').map(v => String(v).trim()).filter(Boolean)
  const foreignStayType = String(form.get('foreign_stay_type') ?? '').trim() || null
  const files            = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  // "병합" 모드 — 개별 유형 수정/추가 등록 시 기존 등록분을 통째로 지우지 않고 이번에
  // 제출된 유형만 교체(upsert)하고 나머지는 그대로 보존한다(front-uiux.md §22-5 순서 보장
  // 슬롯형 원칙 위에서, RPC 자체는 변경 없이 이 엔드포인트가 "합쳐진 최종 배열"을 계산해
  // 넘기는 방식으로 구현 — 마이그레이션/RPC 시그니처 변경 없음). 2026-09-14부로 identity
  // 전용이던 것을 foreign까지 확장(외국인증명 개별 "수정" 기능 신설에 필요).
  const merge = ['identity', 'foreign'].includes(type) && String(form.get('merge') ?? '').trim() === 'true'

  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })
  if (files.length === 0) return json({ ok: false, error: '파일이 없습니다.' }, { status: 400 })

  // identity: 최대 5개, foreign: 체류기간별 콤보 최대 4개 동시 업로드 허용
  if (type === 'identity' && files.length > MAX_IDENTITY_FILES) {
    return json({ ok: false, error: `최대 ${MAX_IDENTITY_FILES}개까지 등록할 수 있어요.` }, { status: 400 })
  }
  if (type === 'foreign' && files.length > MAX_FOREIGN_FILES) {
    return json({ ok: false, error: `최대 ${MAX_FOREIGN_FILES}개까지 등록할 수 있어요.` }, { status: 400 })
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
  // foreign은 다중 파일 전체 목록이 foreign_doc_urls에 있으므로 그쪽을 조회(foreign_doc_url은
  // 첫 번째 파일만 담는 하위호환 스칼라 컬럼 — CMS·채팅 등 기존 소비처가 계속 참조)
  // 병합 모드에서는 유형 컬럼(identity_type/foreign_type)도 함께 조회해 기존 (url,type) 짝을 복원한다.
  const docColumn  = type === 'identity' ? 'identity_doc_url' : 'foreign_doc_urls'
  const typeColumn = type === 'identity' ? 'identity_type'    : 'foreign_type'
  const { data: existingProfile } = await admin
    .from('user_profiles')
    .select(merge ? `${docColumn}, ${typeColumn}` : docColumn)
    .eq('user_id', session.user.id)
    .maybeSingle()
  const existingUrls: string[] = (() => {
    const raw = (existingProfile as Record<string, unknown> | null)?.[docColumn]
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
    if (typeof raw === 'string') return [raw]
    return []
  })()
  const existingTypeValues: string[] = (() => {
    if (!merge) return []
    const raw = (existingProfile as Record<string, unknown> | null)?.[typeColumn]
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
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

  // 병합 모드: 기존 (url,type) 짝 중 "이번에 제출된 유형"만 교체하고 나머지는 보존.
  // 기본(비병합) 모드는 기존 그대로 — publicUrls/submittedTypes를 통째로 반영(재등록=전체 교체).
  const submittedTypes = type === 'identity' ? identityTypes : foreignTypes
  let finalDocUrls    = publicUrls
  let finalTypeValues = submittedTypes.length > 0 ? submittedTypes : null
  let oldUrlsToDelete = existingUrls // 비병합: 기존 파일 전부가 교체 대상(기존 동작 그대로)

  if (merge) {
    // identity 전용 fallback('other')은 기존 동작 그대로 보존 — foreign은 'other'가 유효한
    // enum 값이 아니므로(whitelist에 없음, CHECK 위반 위험) 정합성이 깨진(타입 정보 없는)
    // 레거시 항목이면 보존하지 않고 건너뜀(방어적, 실사용 경로 아님 — url/type은 항상 함께 기록됨).
    const fallbackType = type === 'identity' ? 'other' : null
    const typesBeingReplaced = new Set(submittedTypes)
    const keptPairs: Array<{ url: string; type: string }> = []
    const replacedUrls: string[] = []
    existingUrls.forEach((url, idx) => {
      const t = existingTypeValues[idx] ?? fallbackType
      if (!t) { replacedUrls.push(url); return } // 타입 없는 고아 항목 — DB엔 보존하지 않되
                                                  // 최소한 스토리지에서라도 정리(영구 고아 파일 방지)
      if (typesBeingReplaced.has(t)) replacedUrls.push(url)
      else keptPairs.push({ url, type: t })
    })
    finalDocUrls    = [...keptPairs.map(p => p.url), ...publicUrls]
    finalTypeValues = [...keptPairs.map(p => p.type), ...submittedTypes]
    oldUrlsToDelete = replacedUrls

    const maxFiles = type === 'identity' ? MAX_IDENTITY_FILES : MAX_FOREIGN_FILES
    if (finalDocUrls.length > maxFiles) {
      await admin.storage.from(BUCKET).remove(uploadedPaths)
      return json({ ok: false, error: `최대 ${maxFiles}개까지 등록할 수 있어요.` }, { status: 400 })
    }
  }

  // 사용자 세션으로 RPC 호출 (auth.uid() 기반 본인 데이터 업데이트)
  const { data, error: rpcError } = await callTypedRpc<{ ok: boolean; error?: string }>(
    locals.supabase,
    'update_user_doc_url',
    {
      p_type: type,
      p_doc_url: finalDocUrls,
      p_identity_type: type === 'identity' ? finalTypeValues : null,
      p_foreign_type: type === 'foreign' ? finalTypeValues : null,
      p_foreign_stay_type: foreignStayType,
    },
  )

  if (rpcError || !(data as { ok: boolean } | null)?.ok) {
    console.error('[upload-doc] rpc error:', rpcError?.message)
    // 업로드된 파일 전부 롤백
    await admin.storage.from(BUCKET).remove(uploadedPaths)
    return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
  }

  // DB 반영이 끝난 뒤에만 옛 파일 삭제(반영 실패 시 옛 파일이 여전히 유효한 참조이므로 먼저 지우면 안 됨)
  // 실패해도 응답 자체는 이미 성공 처리된 핵심 동작(재등록)에 영향 주지 않도록 best-effort로 처리
  // 병합 모드에서는 oldUrlsToDelete가 "이번에 실제로 교체된 것"만 담아, 보존된 기존 파일은
  // 절대 삭제하지 않는다(위에서 이미 replacedUrls로 좁혀둠).
  const supabaseUrl = getSupabaseUrl()
  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  const oldPaths = oldUrlsToDelete
    .filter(url => url.startsWith(prefix))
    .map(url => url.slice(prefix.length))
    .filter(path => path.startsWith(`${session.user.id}/`) && !uploadedPaths.includes(path))
  if (oldPaths.length > 0) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(oldPaths)
    if (removeError) console.error('[upload-doc] old file cleanup error:', removeError.message)
  }

  // 관리자 검토요청 알림카드(admin_only) — 업로드 성공에는 영향 주지 않는 fail-soft 부가동작
  // (service-operations.md §11: 세션조회는 find_or_create_general_chat_session RPC만 사용)
  try {
    const { data: profileForName } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', session.user.id)
      .maybeSingle()
    const displayName = (profileForName as { full_name?: string } | null)?.full_name || '고객'

    const { data: chatSessionId, error: sessionRpcErr } = await admin.rpc(
      'find_or_create_general_chat_session',
      { p_user_id: session.user.id, p_reservation_id: null },
    )
    if (sessionRpcErr) {
      console.error('[upload-doc] find_or_create_general_chat_session 실패(fail-soft):', sessionRpcErr.message)
    } else if (chatSessionId) {
      await admin.from('chat_messages').insert({
        session_id:     chatSessionId,
        sender_type:    'user',
        message_type:   'action_card',
        content:        `'${displayName}' 회원 본인증명정보 등록 확인 요청`,
        admin_only:     true,
        action_payload: {
          type:          'identity_review_request',
          doc_type:      type,
          button_label:  '본인증명정보 등록',
          action_url:    `/cms/customers?selected=${session.user.id}`,
        },
        is_read: false,
      })
      await admin.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', chatSessionId)
    }
  } catch (e) {
    console.error('[upload-doc] identity_review_request 카드 발송 실패(fail-soft):', e instanceof Error ? e.message : e)
  }

  return json({ ok: true, docUrls: finalDocUrls, verifiedAt: new Date().toISOString() })
}
