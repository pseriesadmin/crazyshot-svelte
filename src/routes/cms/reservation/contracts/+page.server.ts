import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import type { ContractTemplate, ContractTemplateSummary } from '$lib/types/contract-template'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export type { ContractTemplate, ContractTemplateSummary }

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const selectedId = url.searchParams.get('selected') ?? null

  const { data: templates } = await admin
    .from('contract_templates')
    .select('id, title, status, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  let selectedTemplate: ContractTemplate | null = null
  if (selectedId) {
    const { data } = await admin
      .from('contract_templates')
      .select('id, title, content_blocks, specifications, status, created_at, updated_at')
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
    if (!cmsRole) return fail(403, { error: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const form  = await request.formData()

    const title          = (form.get('title') as string | null)?.trim() ?? ''
    const contentBlocks  = form.get('content_blocks') as string | null
    const specifications = form.get('specifications') as string | null

    if (!title) return fail(400, { error: '계약서 제목을 입력해주세요.' })

    let parsedBlocks: unknown[] = []
    let parsedSpecs:  unknown[] = []
    try { parsedBlocks = JSON.parse(contentBlocks ?? '[]') } catch { /* empty */ }
    try { parsedSpecs  = JSON.parse(specifications ?? '[]') } catch { /* empty */ }

    const { data, error } = await admin
      .from('contract_templates')
      .insert({
        title,
        content_blocks: parsedBlocks,
        specifications: parsedSpecs,
        created_by: session.user.id,
      })
      .select('id')
      .single()

    if (error) return fail(500, { error: error.message })
    return { ok: true, id: (data as { id: string }).id }
  },

  update: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const form  = await request.formData()

    const id             = (form.get('id') as string | null) ?? ''
    const title          = (form.get('title') as string | null)?.trim() ?? ''
    const contentBlocks  = form.get('content_blocks') as string | null
    const specifications = form.get('specifications') as string | null

    if (!id)    return fail(400, { error: 'ID가 없습니다.' })
    if (!title) return fail(400, { error: '계약서 제목을 입력해주세요.' })

    let parsedBlocks: unknown[] = []
    let parsedSpecs:  unknown[] = []
    try { parsedBlocks = JSON.parse(contentBlocks ?? '[]') } catch { /* empty */ }
    try { parsedSpecs  = JSON.parse(specifications ?? '[]') } catch { /* empty */ }

    const { error } = await admin
      .from('contract_templates')
      .update({
        title,
        content_blocks: parsedBlocks,
        specifications: parsedSpecs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('deleted_at', null)

    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  softDelete: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })

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
