import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'

export const GET: RequestHandler = async ({ locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('contract_templates')
    .select('id, title, content_blocks, specifications, authoring_mode, canvas_document, spreadsheet_document, html_document, html_issuer_signature_url, html_issuer_signature_width, html_issuer_signature_offset_x, html_issuer_signature_offset_y, contract_terms_text, privacy_terms_text, created_at')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return json({ error: error.message }, { status: 500 })

  // 2026-09-09(Stephen 지시) — html 모드 양식은 모두 하나의 공통 레이아웃(코드 상수
  // DEFAULT_RENTAL_CONTRACT_HTML)을 공유한다(양식별로 다른 건 제목·서명설정·특약문구뿐).
  // 개발자가 이 소스 파일을 고치면 "계약서 양식 적용 & 발송" 모달에도 즉시 반영돼야 하는데,
  // DB(contract_templates.html_document)는 양식 생성/수정 시점에 찍힌 스냅샷이라 소스 파일이
  // 바뀌어도 자동으로 갱신되지 않는 구조적 드리프트가 있었다(ContractTemplatePanel.svelte의
  // 편집 화면 자체는 이미 이 상수를 직접 렌더링해 이 문제가 없었음 — 이 API로 데이터를 받는
  // 발행 모달만 стale했음). authoring_mode='html' 행은 DB에 저장된 값을 무시하고 항상
  // 이 상수로 덮어써 반환 — 소스 파일 수정이 곧바로 모든 화면에 반영되도록 함.
  const withLiveHtml = (data ?? []).map((row) =>
    row.authoring_mode === 'html'
      ? { ...row, html_document: DEFAULT_RENTAL_CONTRACT_HTML }
      : row
  )

  return json(withLiveHtml)
}
