/**
 * GET /api/cms/contracts/[id]/final-pdf-status — 관리자 계약서 탭: 서명 완료 계약서의 최종본 PDF 상태 (2026-10-08)
 *
 * 응답 state:
 *   ready    — 현재 유효한 서명의 최종본 PDF가 있다
 *   pending  — 서명 증적이 있어 최종본이 곧 만들어진다(서명·결제 직후 즉시 생성, 실패 시 10분 크론)
 *   legacy   — 서명 증적이 없다(서명 증적 도입 전에 서명했거나 서명 때 증적 저장이 실패) → 최종본 PDF가 자동으로 만들어지지 않는다
 *   unsigned — 서명이 완료되지 않았다
 * 화면 안내 문구를 가르기 위한 조회 전용이다(쓰기·감사 기록 없음). 권한: 메뉴 rental.reservation + CMS 직원(final-pdf와 같은 열람 기준).
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { findCurrentFinalDocument } from '$lib/server/contractArchive/loadArchivedPdf'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'cache-control': 'private, no-store' }

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })
  if (!UUID_RE.test(params.id)) return json({ error: '유효하지 않은 계약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  if (await findCurrentFinalDocument(admin, [params.id])) return json({ state: 'ready' }, { headers: NO_STORE })

  const { data: signing, error: signErr } = await admin
    .from('contract_signings')
    .select('signed_at')
    .eq('contract_id', params.id)
    .not('signed_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (signErr) return json({ error: '상태를 확인하지 못했습니다.' }, { status: 500 })
  const signedAt = (signing as { signed_at: string } | null)?.signed_at
  if (!signedAt) return json({ state: 'unsigned' }, { headers: NO_STORE })

  const { data: evidence, error: evErr } = await admin
    .from('contract_signature_evidence')
    .select('id')
    .eq('contract_id', params.id)
    .eq('signed_at', signedAt)
    .limit(1)
    .maybeSingle()
  if (evErr) return json({ error: '상태를 확인하지 못했습니다.' }, { status: 500 })
  return json({ state: evidence ? 'pending' : 'legacy' }, { headers: NO_STORE })
}
