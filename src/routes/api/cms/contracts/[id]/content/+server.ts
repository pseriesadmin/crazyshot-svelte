import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  const { data, error } = await admin
    .from('contracts')
    .select('title, content_blocks, specifications')
    .eq('id', contractId)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '계약서를 찾을 수 없습니다.' }, { status: 404 })

  return json(data)
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const admin      = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const contractId = params.id

  let body: { title?: string; content_blocks?: unknown[]; specifications?: unknown[]; template_id?: string | null }
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

  const { error } = await admin
    .from('contracts')
    .update(updatePayload)
    .eq('id', contractId)

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ ok: true })
}
