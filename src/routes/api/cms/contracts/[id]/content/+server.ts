import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isCanvasDocument, hasSignatureField, isSpreadsheetDocument } from '$lib/types/contract-document'

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  // 2026-08-20: 서명 완료된 계약은 전 cms 계정(partner 포함)이 열람 가능 — 편집·발송 중인
  // 계약(고객 PII가 아직 확정되지 않았거나 발송 전 초안일 수 있음)은 계속 manager 이상만 허용.
  // GET/PATCH 둘 다 막던 P7-4 전면 게이트를 "서명완료건 읽기전용 열람"만 완화한다(쓰기 경로인
  // PATCH·init-contract·send-chat·contract-data는 이 완화와 무관하게 manager 이상 그대로 유지).
  //
  const { data: signing } = await admin
    .from('contract_signings')
    .select('signed_at, signed_content_snapshot')
    .eq('contract_id', contractId)
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!hasSettingsAccess(cmsRole) && !signing) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('contracts')
    .select('title, content_blocks, specifications, authoring_mode, canvas_document, spreadsheet_document')
    .eq('id', contractId)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '계약서를 찾을 수 없습니다.' }, { status: 404 })

  // 2026-08-21: ?preferSignedSnapshot=1 요청에 한해서만 서명 시점 스냅샷을 우선 반환한다.
  // 순수 "보기"(RentalContractViewer의 isRentalView 서명완료 목록) 경로 전용 — 이 파라미터
  // 없이는 항상 라이브 콘텐츠를 반환해 기존 편집(ContractEditorModal)·재발송(existing 모드
  // ContractTemplatePreviewModal) 흐름을 그대로 유지한다. 이 두 흐름까지 스냅샷을 기본
  // 반환하면, 서명 후 편집이 그 프리필된 "과거" 내용을 다시 저장하며 그 사이의 실제
  // 변경사항을 조용히 덮어쓸 위험이 있어 의도적으로 옵트인으로 분리했다.
  if (url.searchParams.get('preferSignedSnapshot') === '1') {
    const snapshot = signing?.signed_content_snapshot as typeof data | null | undefined
    if (snapshot) return json(snapshot)
  }

  return json(data)
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // P7-4: manager 이상만 허용
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  let body: {
    title?: string
    content_blocks?: unknown[]
    specifications?: unknown[]
    template_id?: string | null
    authoring_mode?: string
    canvas_document?: unknown
    spreadsheet_document?: unknown
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const updatePayload: Record<string, unknown> = {
    title:          body.title ?? null,
    content_blocks: body.content_blocks ?? [],
    specifications: body.specifications ?? [],
    updated_at:     new Date().toISOString(),
  }
  if ('template_id' in body) {
    updatePayload.template_id = body.template_id ?? null
  }
  if ('authoring_mode' in body && body.authoring_mode) {
    const { data: current } = await admin
      .from('contracts')
      .select('authoring_mode')
      .eq('id', contractId)
      .maybeSingle()

    if (current && current.authoring_mode !== body.authoring_mode) {
      // 발행 후 불변 원칙: 이미 고객에게 발송됐거나 서명 완료된 계약서는 작성 방식(모드) 자체를
      // 바꿀 수 없다 — spreadsheet 전환처럼 콘텐츠가 통째로 갈아끼워지는 변경이 열람/서명 중인
      // 고객 화면 아래에서 조용히 일어나는 사고를 서버에서 원천 차단한다.
      const { data: signing } = await admin
        .from('contract_signings')
        .select('sent_at, signed_at')
        .eq('contract_id', contractId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (signing?.sent_at || signing?.signed_at) {
        return json(
          { error: '이미 고객에게 발송되었거나 서명 완료된 계약서는 작성 방식을 변경할 수 없습니다.' },
          { status: 400 }
        )
      }
    }

    updatePayload.authoring_mode = body.authoring_mode
  }
  if ('canvas_document' in body && body.canvas_document != null) {
    if (!isCanvasDocument(body.canvas_document)) {
      return json({ error: 'canvas_document 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    // EC-3: 서명 필드 최소 1개 필수 (서버 재검증 — 클라이언트 우회 방지)
    if (!hasSignatureField(body.canvas_document)) {
      return json({ error: '서명 필드가 최소 1개 이상 있어야 합니다. (EC-3)' }, { status: 400 })
    }
    updatePayload.canvas_document = body.canvas_document
  }
  if ('spreadsheet_document' in body && body.spreadsheet_document != null) {
    if (!isSpreadsheetDocument(body.spreadsheet_document)) {
      return json({ error: 'spreadsheet_document 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    updatePayload.spreadsheet_document = body.spreadsheet_document
  }

  const { error } = await admin
    .from('contracts')
    .update(updatePayload)
    .eq('id', contractId)

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ ok: true })
}
