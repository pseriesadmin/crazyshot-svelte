import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isCanvasDocument, hasSignatureField } from '$lib/types/contract-document'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // P7-4: manager 이상만 허용 (GET/PATCH 양쪽 모두 — 한쪽만 막으면 다른 경로로 열람 가능)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  const { data, error } = await admin
    .from('contracts')
    .select('title, content_blocks, specifications, authoring_mode, canvas_document')
    .eq('id', contractId)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '계약서를 찾을 수 없습니다.' }, { status: 404 })

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

  const { error } = await admin
    .from('contracts')
    .update(updatePayload)
    .eq('id', contractId)

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ ok: true })
}
