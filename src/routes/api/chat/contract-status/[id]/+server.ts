/**
 * GET /api/chat/contract-status/[id]
 * 상담채팅 액션카드(contract_link/contract_signed)가 클릭 가능 여부를 판단하기 위해
 * 계약서의 "발행 취소" 여부만 반환하는 경량 엔드포인트. reservation-status/[id]와
 * 동일한 목적·동일한 접근 정책 패턴을 그대로 따른다(2026-09-07 신규).
 *
 * "취소됨" 판정: cancel_issued_contract RPC(Migration #456)가 content_blocks/
 * canvas_document/spreadsheet_document/html_document를 전부 비우므로, 그 상태와
 * 동일한 판별 함수(hasExistingContractContent)를 재사용해 "더 이상 발행된 내용이
 * 없다"를 곧 "취소됨"으로 취급한다 — 별도의 cancelled 플래그 컬럼을 새로 만들지 않는다.
 *
 * 접근 허용: CMS 관리자(getCmsRoleForAction) 또는 그 계약의 소유 고객(session.user.id) 둘 중 하나.
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasExistingContractContent } from '$lib/utils/contract-content-mode'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const contractId = params.id
  if (!contractId) throw error(400, '유효하지 않은 계약서 ID입니다.')

  const cmsRole = await getCmsRoleForAction(locals)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: contract, error: contractErr } = await admin
    .from('contracts')
    .select('user_id, content_blocks, canvas_document, spreadsheet_document, html_document')
    .eq('id', contractId)
    .maybeSingle()

  if (contractErr || !contract) throw error(404, '계약서를 찾을 수 없습니다.')

  const c = contract as {
    user_id: string
    content_blocks: unknown
    canvas_document: unknown
    spreadsheet_document: unknown
    html_document: unknown
  }
  const isOwner = c.user_id === session.user.id
  if (!cmsRole && !isOwner) throw error(403, '접근 권한이 없습니다.')

  const cancelled = !hasExistingContractContent(
    c.content_blocks,
    c.canvas_document,
    c.spreadsheet_document,
    c.html_document,
  )

  return json({ cancelled })
}
