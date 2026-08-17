// /api/cms/canned-responses/[id] — 단건 수정 / 삭제
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { normalizeKeywords } from '$lib/server/normalizeKeywords'
import { VALID_CATEGORIES } from '$lib/constants/cannedResponseCategories'
import { VALID_HELP_CATEGORIES } from '$lib/constants/helpCategories'

// PATCH /api/cms/canned-responses/[id] — 수정
export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const id = params.id
  const body = await request.json() as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof body.title === 'string')    updates.title    = body.title.trim()
  if (typeof body.content === 'string')  updates.content  = body.content.trim()
  if ('category' in body)               updates.category  = body.category ?? null
  if ('help_category' in body)          updates.help_category = body.help_category ?? null
  if ('shortcut' in body) {
    const s = typeof body.shortcut === 'string' ? body.shortcut.trim() : null
    updates.shortcut = s || null
  }
  if ('match_keywords' in body) updates.match_keywords = normalizeKeywords(body.match_keywords)
  if ('image_url' in body) {
    updates.image_url = typeof body.image_url === 'string' ? body.image_url.trim() || null : null
  }
  if ('cta_label' in body) {
    updates.cta_label = typeof body.cta_label === 'string' ? body.cta_label.trim() || null : null
  }
  if ('cta_url' in body) {
    updates.cta_url = typeof body.cta_url === 'string' ? body.cta_url.trim() || null : null
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: '변경할 내용이 없습니다.' }, { status: 400 })
  }

  if (updates.category && !VALID_CATEGORIES.includes(updates.category as string)) {
    return json({ error: '올바르지 않은 카테고리입니다.' }, { status: 400 })
  }

  if ('help_category' in updates) {
    if (!updates.help_category) return json({ error: '도움말 분류를 선택해주세요.' }, { status: 400 })
    if (!VALID_HELP_CATEGORIES.includes(updates.help_category as string)) {
      return json({ error: '올바르지 않은 도움말 분류입니다.' }, { status: 400 })
    }
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('canned_responses')
    .update(updates)
    .eq('id', id)
    .select('id, title, content, category, help_category, shortcut, match_keywords, usage_count, created_at, image_url, cta_label, cta_url')
    .single()

  if (error) {
    if (error.code === '23505') {
      return json({ error: '이미 사용 중인 단축키입니다.' }, { status: 409 })
    }
    return json({ error: error.message }, { status: 500 })
  }

  return json(data)
}

// DELETE /api/cms/canned-responses/[id] — 삭제
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await admin
    .from('canned_responses')
    .delete()
    .eq('id', params.id)

  if (error) return json({ error: error.message }, { status: 500 })

  return new Response(null, { status: 204 })
}
