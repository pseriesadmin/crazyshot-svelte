import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import type { ContractTemplate, ContractTemplateSummary } from '$lib/types/contract-template'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isCanvasDocument, hasSignatureField, isSpreadsheetDocument } from '$lib/types/contract-document'
import type { CanvasDocument, CanvasField, SpreadsheetDocument } from '$lib/types/contract-document'

// --------------------------------------------------------------------------
// canvas_document assetId 검증 헬퍼
// issuer-image 필드에 참조된 assetId가 cms_signature_assets에 실제로 존재하는지 확인
// --------------------------------------------------------------------------
type AdminQueryClient = {
  from: (t: string) => {
    select: (s: string) => {
      in: (k: string, v: string[]) => {
        is: (k: string, v: null) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>
      }
    }
  }
}

async function validateCanvasAssetIds(
  doc: CanvasDocument,
  admin: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const assetIds = (doc.fields as CanvasField[])
    .filter((f) => f.type === 'issuer-image' && f.assetId)
    .map((f) => f.assetId!)

  if (assetIds.length === 0) return { ok: true }

  // 중복 제거
  const uniqueIds = [...new Set(assetIds)]

  const { data, error } = await (admin as AdminQueryClient)
    .from('cms_signature_assets')
    .select('id')
    .in('id', uniqueIds)
    .is('deleted_at', null)

  if (error) return { ok: false, error: `자산 검증 실패: ${error.message}` }

  const foundIds = new Set((data ?? []).map((r) => r.id))
  const missing = uniqueIds.filter((id) => !foundIds.has(id))

  if (missing.length > 0) {
    return { ok: false, error: `존재하지 않는 서명·직인 자산이 포함되어 있습니다. (${missing.length}건)` }
  }

  return { ok: true }
}

export type { ContractTemplate, ContractTemplateSummary }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  // P7-1: manager 이상(hasSettingsAccess)만 진입 허용 — QR-CASE-2와 동일 패턴
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const selectedId = url.searchParams.get('selected') ?? null

  const { data: templates } = await admin
    .from('contract_templates')
    .select('id, title, status, created_at, authoring_mode')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  let selectedTemplate: ContractTemplate | null = null
  if (selectedId) {
    const { data } = await admin
      .from('contract_templates')
      .select('id, title, content_blocks, specifications, status, requires_issuer_signature, authoring_mode, canvas_document, spreadsheet_document, created_at, updated_at')
      .eq('id', selectedId)
      .is('deleted_at', null)
      .maybeSingle()
    selectedTemplate = data as ContractTemplate | null
  }

  return {
    templates: (templates ?? []) as ContractTemplateSummary[],
    selectedId,
    selectedTemplate,
  }
}

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    // P7-2: manager 이상만 허용
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const form  = await request.formData()

    const title                    = (form.get('title') as string | null)?.trim() ?? ''
    const contentBlocks            = form.get('content_blocks') as string | null
    const canvasDocumentRaw        = form.get('canvas_document') as string | null
    const spreadsheetDocumentRaw   = form.get('spreadsheet_document') as string | null
    const specifications           = form.get('specifications') as string | null
    const requiresIssuerSignature  = form.get('requires_issuer_signature') === 'true'
    const authoringMode            = (form.get('authoring_mode') as string | null)?.trim() || 'flow'

    if (!title) return fail(400, { error: '계약서 제목을 입력해주세요.' })

    let parsedBlocks: unknown[] = []
    let parsedSpecs:  unknown[] = []
    let parsedCanvas: CanvasDocument | null = null
    let parsedSpreadsheet: SpreadsheetDocument | null = null
    try { parsedBlocks = JSON.parse(contentBlocks ?? '[]') } catch { /* empty */ }
    try { parsedSpecs  = JSON.parse(specifications ?? '[]') } catch { /* empty */ }
    if (canvasDocumentRaw) {
      try {
        const candidate = JSON.parse(canvasDocumentRaw)
        if (isCanvasDocument(candidate)) parsedCanvas = candidate
        else return fail(400, { error: 'canvas_document 형식이 올바르지 않습니다.' })
      } catch {
        return fail(400, { error: 'canvas_document JSON 파싱 실패.' })
      }
    }
    if (spreadsheetDocumentRaw) {
      try {
        const candidate = JSON.parse(spreadsheetDocumentRaw)
        if (isSpreadsheetDocument(candidate)) parsedSpreadsheet = candidate
        else return fail(400, { error: 'spreadsheet_document 형식이 올바르지 않습니다.' })
      } catch {
        return fail(400, { error: 'spreadsheet_document JSON 파싱 실패.' })
      }
    }

    // EC-3 + issuer-image assetId 존재 검증 (있을 때만)
    if (parsedCanvas) {
      if (!hasSignatureField(parsedCanvas)) {
        return fail(400, { error: '서명 필드가 최소 1개 이상 있어야 합니다. (EC-3)' })
      }
      const validation = await validateCanvasAssetIds(parsedCanvas, admin)
      if (!validation.ok) return fail(400, { error: validation.error })
    }

    const insertPayload: Record<string, unknown> = {
      title,
      content_blocks: parsedBlocks,
      specifications: parsedSpecs,
      requires_issuer_signature: requiresIssuerSignature,
      authoring_mode: authoringMode,
      created_by: session.user.id,
    }
    if (parsedCanvas !== null) insertPayload.canvas_document = parsedCanvas
    if (parsedSpreadsheet !== null) insertPayload.spreadsheet_document = parsedSpreadsheet

    const { data, error } = await admin
      .from('contract_templates')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) return fail(500, { error: error.message })
    return { ok: true, id: (data as { id: string }).id }
  },

  update: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    // P7-2: manager 이상만 허용
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const form  = await request.formData()

    const id                       = (form.get('id') as string | null) ?? ''
    const title                    = (form.get('title') as string | null)?.trim() ?? ''
    const contentBlocks            = form.get('content_blocks') as string | null
    const canvasDocumentRaw        = form.get('canvas_document') as string | null
    const spreadsheetDocumentRaw   = form.get('spreadsheet_document') as string | null
    const specifications           = form.get('specifications') as string | null
    const requiresIssuerSignature  = form.get('requires_issuer_signature') === 'true'
    const authoringMode            = (form.get('authoring_mode') as string | null)?.trim() || 'flow'

    if (!id)    return fail(400, { error: 'ID가 없습니다.' })
    if (!title) return fail(400, { error: '계약서 제목을 입력해주세요.' })

    // ⛔ 2026-08-16 데이터 손상 방지 가드(Stephen "기존 양식을 다른 작성모드로 뒤엎어넣는
    // 실수 방지" 요청) — ContractTemplatePanel.svelte 쪽에서도 동일 원칙의 클라이언트 가드를
    // 추가했지만(임포트 모달에서 기존 양식의 모드를 바꾸는 것 자체를 차단), 서버는 클라이언트
    // 코드를 신뢰하지 않고 독립적으로 재검증해야 한다(H-01/방어적 서버 검증 원칙) — 이 액션이
    // authoring_mode를 무조건 폼값 그대로 반영하던 것이 근본 결함이었다. 기존 양식의 저장된
    // authoring_mode와 이번 제출값이 다르면, 그 요청은 곧 content_blocks/canvas_document/
    // spreadsheet_document 중 하나만 채워지고 나머지는 비워진 상태로 같은 id에 덮어쓰는
    // 요청이라는 뜻 — 원본 콘텐츠가 영구 소실된다. 무조건 거부한다(모드 전환 자체를 지원할
    //계획이 없음 — 형식을 바꾸려면 새 양식 작성).
    const { data: existingTemplate, error: existingErr } = await admin
      .from('contract_templates')
      .select('authoring_mode')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingErr) return fail(500, { error: existingErr.message })
    if (!existingTemplate) return fail(404, { error: '양식을 찾을 수 없습니다.' })
    if (existingTemplate.authoring_mode !== authoringMode) {
      return fail(400, { error: '기존 계약서 양식은 작성 모드를 변경할 수 없습니다. 형식을 바꾸려면 새 양식을 작성해주세요.' })
    }

    let parsedBlocks: unknown[] = []
    let parsedSpecs:  unknown[] = []
    let parsedCanvas: CanvasDocument | null = null
    let parsedSpreadsheet: SpreadsheetDocument | null = null
    try { parsedBlocks = JSON.parse(contentBlocks ?? '[]') } catch { /* empty */ }
    try { parsedSpecs  = JSON.parse(specifications ?? '[]') } catch { /* empty */ }
    if (canvasDocumentRaw) {
      try {
        const candidate = JSON.parse(canvasDocumentRaw)
        if (isCanvasDocument(candidate)) parsedCanvas = candidate
        else return fail(400, { error: 'canvas_document 형식이 올바르지 않습니다.' })
      } catch {
        return fail(400, { error: 'canvas_document JSON 파싱 실패.' })
      }
    }
    if (spreadsheetDocumentRaw) {
      try {
        const candidate = JSON.parse(spreadsheetDocumentRaw)
        if (isSpreadsheetDocument(candidate)) parsedSpreadsheet = candidate
        else return fail(400, { error: 'spreadsheet_document 형식이 올바르지 않습니다.' })
      } catch {
        return fail(400, { error: 'spreadsheet_document JSON 파싱 실패.' })
      }
    }

    // EC-3 + issuer-image assetId 존재 검증 (있을 때만)
    if (parsedCanvas) {
      if (!hasSignatureField(parsedCanvas)) {
        return fail(400, { error: '서명 필드가 최소 1개 이상 있어야 합니다. (EC-3)' })
      }
      const validation = await validateCanvasAssetIds(parsedCanvas, admin)
      if (!validation.ok) return fail(400, { error: validation.error })
    }

    const updatePayload: Record<string, unknown> = {
      title,
      content_blocks: parsedBlocks,
      specifications: parsedSpecs,
      requires_issuer_signature: requiresIssuerSignature,
      authoring_mode: authoringMode,
      updated_at: new Date().toISOString(),
    }
    if (parsedCanvas !== null) updatePayload.canvas_document = parsedCanvas
    if (parsedSpreadsheet !== null) updatePayload.spreadsheet_document = parsedSpreadsheet

    const { error } = await admin
      .from('contract_templates')
      .update(updatePayload)
      .eq('id', id)
      .is('deleted_at', null)

    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  softDelete: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    // P7-2: manager 이상만 허용
    if (!cmsRole || !hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const form  = await request.formData()
    const id    = (form.get('id') as string | null) ?? ''

    if (!id) return fail(400, { error: 'ID가 없습니다.' })

    const { error } = await admin
      .from('contract_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },
}
