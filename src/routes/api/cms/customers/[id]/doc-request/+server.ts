// POST /api/cms/customers/[id]/doc-request  body: { type: 'identity' | 'foreign' }
// 고객이 등록한 본인증명·외국인증명 서류가 불충분할 때 관리자가 [재등록] 버튼으로 재등록을 요청한다(2026-10-15, Stephen).
// 고객 채팅에 'identity_request' 대화카드 + 브라우저 푸시 + SMS를 보낸다(requestIdentityDocRegistration, force).
//  · 권한: 세션 + manager 이상(서류 승인·대리등록과 같은 등급) + 고객목록 메뉴 권한
//  · 서류 상태와 무관하게 발송(승인대기·승인완료 포함), 같은 요청 5분 중복 방지, 서류 파일·승인은 건드리지 않는다
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { requestIdentityDocRegistration } from '$lib/server/identityDocRequest'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403 })
  const menuDenied = await requireMenuAccessApi(locals, 'customers.list')
  if (menuDenied) return menuDenied

  const userId = params.id
  if (!UUID_RE.test(userId)) return json({ ok: false, error: '잘못된 사용자 ID' }, { status: 400 })
  const body = await request.json().catch(() => null) as { type?: string; reservation_id?: number } | null
  const type = body?.type === 'foreign' ? 'foreign' : body?.type === 'identity' ? 'identity' : null
  if (!type) return json({ ok: false, error: '잘못된 문서 유형' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const result = await requestIdentityDocRegistration(admin, userId, { force: true, docType: type, ...(Number.isInteger(body?.reservation_id) && (body?.reservation_id as number) > 0 ? { reservationId: body?.reservation_id as number } : {}) })
  if (result.requested) return json({ ok: true })
  if (result.reason === 'recently_requested') return json({ ok: false, error: '방금 이미 재등록을 요청했어요. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  if (result.reason === 'withdrawn') return json({ ok: false, error: '탈퇴 처리된 고객입니다.' }, { status: 409 })
  return json({ ok: false, error: '재등록 요청에 실패했습니다.' }, { status: 500 })
}
