// POST /api/cms/upload-doc — 관리자 대리 서류 등록(슬롯 1건 교체)
// 2026-10-03(서류 비공개 전환 B3a, Stephen 승인 플랜): 과거에는 "종류 목록 전체를 이 파일 1개로 덮어쓰기"라 필수 서류 조합이 깨지고
// (identity_type이 1종짜리 배열이 됨) 외국인증명은 foreign_type과 파일 수가 어긋나며 foreign_verified_at이 조합과 무관하게 기록됐다.
// 이제 form의 slot_type(서류 종류) 1건만 교체(없으면 추가)하고 다른 종류는 그대로 보존한다.
//   · DB에는 공개 URL이 아니라 버킷 내부 경로만 저장(열람은 /api/cms/customers/[id]/doc-url 서명 URL로만)
//   · 교체된 기존 파일은 DB 반영 뒤 best-effort로 삭제(고아 파일 방지)
//   · foreign_verified_at은 4종 완료 시에만 기록(Migration #495와 동일), 승인 시각은 초기화(재검토 필요)
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { UPLOAD_ACCEPTED_TYPES, getMimeExtension } from '$lib/utils/fileValidation'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { toDocPaths } from '$lib/server/userDocs'

const BUCKET = 'user-documents'
const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDENTITY_FILES = 5
const MAX_FOREIGN_FILES = 4 // 체류기간별 필수 증명서 콤보 개수(단기/장기 각 4종)

// 고객 화면(ProfileTabContent)과 동일한 서류 종류 — 이 목록 밖의 값은 거부(DB 정합성)
const IDENTITY_SLOT_TYPES = ['student', 'resident', 'resident_copy', 'driver', 'other'] as const
const FOREIGN_SLOT_TYPES = [
  'passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket',
  'arc_front', 'arc_back', 'foreign_fact_cert',
] as const

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const form = await request.formData()
  const userId = String(form.get('user_id') ?? '').trim()
  const type   = String(form.get('type')    ?? '').trim()
  // slot_type이 정본. 구버전 화면 호환으로 identity_type/foreign_type 필드도 받는다.
  const slotType = (
    String(form.get('slot_type') ?? '').trim() ||
    String(form.get(type === 'foreign' ? 'foreign_type' : 'identity_type') ?? '').trim()
  )
  const file = form.get('file') as File | null

  if (!userId || !UUID_RE.test(userId)) return json({ ok: false, error: '사용자 ID 필수' }, { status: 400 })
  if (!['identity', 'foreign'].includes(type)) return json({ ok: false, error: '잘못된 요청' }, { status: 400 })
  const allowedSlots: readonly string[] = type === 'identity' ? IDENTITY_SLOT_TYPES : FOREIGN_SLOT_TYPES
  if (!slotType || !allowedSlots.includes(slotType)) {
    return json({ ok: false, error: '서류 종류를 선택해주세요.' }, { status: 400 })
  }
  if (!file || !file.size) return json({ ok: false, error: '파일이 없습니다.' }, { status: 400 })
  if (file.size > MAX_SIZE) return json({ ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 })

  // 서버사이드 MIME 재검증 (front-uiux.md §15-4)
  if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as (typeof UPLOAD_ACCEPTED_TYPES)[number])) {
    return json({ ok: false, error: 'PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요.' }, { status: 400 })
  }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 현재 등록분 — (파일, 종류) 짝을 복원해 교체할 슬롯만 바꾸기 위함
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('identity_doc_url, identity_type, foreign_doc_url, foreign_doc_urls, foreign_type')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError) {
    console.error('[cms/upload-doc] 프로필 조회 실패:', profileError.message)
    return json({ ok: false, error: '조회에 실패했습니다.' }, { status: 500 })
  }
  if (!profile) return json({ ok: false, error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  const row = profile as {
    identity_doc_url: string[] | null; identity_type: string[] | null
    foreign_doc_url: string | null; foreign_doc_urls: string[] | null; foreign_type: string[] | null
  }
  const existingUrls: string[] =
    type === 'identity'
      ? (row.identity_doc_url ?? [])
      : row.foreign_doc_urls && row.foreign_doc_urls.length > 0
        ? row.foreign_doc_urls
        : row.foreign_doc_url ? [row.foreign_doc_url] : []
  const existingTypes: string[] = (type === 'identity' ? row.identity_type : row.foreign_type) ?? []

  // 이번에 교체할 종류만 빼고 나머지 짝은 보존. 종류 정보가 없는 고아 항목은 보존하지 않고 파일만 정리한다
  // (identity는 기존 동작대로 'other'로 보존 — 외국인증명에는 'other'가 유효하지 않음).
  const fallbackType = type === 'identity' ? 'other' : null
  const keptPairs: Array<{ url: string; type: string }> = []
  const replacedUrls: string[] = []
  existingUrls.forEach((url, idx) => {
    const t = existingTypes[idx] ?? fallbackType
    if (!t || t === slotType) replacedUrls.push(url)
    else keptPairs.push({ url, type: t })
  })

  const maxFiles = type === 'identity' ? MAX_IDENTITY_FILES : MAX_FOREIGN_FILES
  if (keptPairs.length + 1 > maxFiles) {
    return json({ ok: false, error: `최대 ${maxFiles}개까지 등록할 수 있어요.` }, { status: 400 })
  }

  const ext  = getMimeExtension(file.type)
  const uuid = crypto.randomUUID()
  const path = `${userId}/${type}_${uuid}.${ext}`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[cms/upload-doc] storage error:', uploadError.message)
    return json({ ok: false, error: '파일 업로드에 실패했습니다.' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const finalUrls  = [...keptPairs.map(p => p.url), path]
  const finalTypes = [...keptPairs.map(p => p.type), slotType]

  // service_role로 RLS 우회 — 다른 사용자 프로필 업데이트. 저장값은 경로만(공개 URL 아님).
  const updates =
    type === 'identity'
      ? {
          identity_doc_url:     finalUrls,
          identity_type:        finalTypes,
          identity_verified_at: now,
          identity_approved_at: null,
        }
      : {
          foreign_doc_url:     finalUrls[0],            // 레거시 스칼라(첫 파일) 하위호환
          foreign_doc_urls:    finalUrls,
          foreign_type:        finalTypes,
          // 4종(체류기간별 콤보) 완성일 때만 제출 완료 — Migration #495 규칙. 미달이면 NULL(승인 불가)
          foreign_verified_at: finalUrls.length >= MAX_FOREIGN_FILES ? now : null,
          foreign_approved_at: null,
          is_foreign:          true,
        }

  try {
    const { data: updated, error: updateError } = await admin
      .from('user_profiles')
      .update(updates)
      .eq('user_id', userId)
      .select('user_id')

    if (updateError || !updated || updated.length === 0) {
      console.error('[cms/upload-doc] db error:', updateError?.message ?? 'no row updated')
      await admin.storage.from(BUCKET).remove([path])
      return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
    }
  } catch (e) {
    console.error('[cms/upload-doc] db 예외:', e instanceof Error ? e.message : e)
    await admin.storage.from(BUCKET).remove([path])
    return json({ ok: false, error: 'DB 업데이트에 실패했습니다.' }, { status: 500 })
  }

  // DB 반영이 끝난 뒤에만 교체된 기존 파일 삭제 — best-effort(실패해도 등록은 이미 성공), 해당 고객 폴더 파일만
  const oldPaths = toDocPaths(replacedUrls, userId).filter(p => p !== path)
  if (oldPaths.length > 0) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove(oldPaths)
    if (removeError) console.error('[cms/upload-doc] 교체된 기존 파일 정리 실패(fail-soft):', removeError.message)
  }

  return json({ ok: true, verifiedAt: now })
}
