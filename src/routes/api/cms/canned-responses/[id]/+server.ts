// /api/cms/canned-responses/[id] — 단건 수정 / 삭제
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { normalizeKeywords } from '$lib/server/normalizeKeywords'

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
  if ('shortcut' in body) {
    const s = typeof body.shortcut === 'string' ? body.shortcut.trim() : null
    updates.shortcut = s || null
  }
  if ('match_keywords' in body) updates.match_keywords = normalizeKeywords(body.match_keywords)

  if (Object.keys(updates).length === 0) {
    return json({ error: '변경할 내용이 없습니다.' }, { status: 400 })
  }

  const VALID_CATEGORIES = ['return', 'payment', 'reservation', 'damage', 'general']
  if (updates.category && !VALID_CATEGORIES.includes(updates.category as string)) {
    return json({ error: '올바르지 않은 카테고리입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('canned_responses')
    .update(updates)
    .eq('id', id)
    .select('id, title, content, category, shortcut, match_keywords, usage_count, created_at')
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
