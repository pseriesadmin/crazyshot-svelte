// /api/cms/canned-responses — 캔드 리스폰스 목록 조회 / 신규 등록
// 편집 권한: is_cms_user() (파트너 포함 모든 CMS 사용자)
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { normalizeKeywords } from '$lib/server/normalizeKeywords'

export interface CannedResponse {
  id: string
  title: string
  content: string
  category: string | null
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
  created_by: string | null
  created_at: string
}

// GET /api/cms/canned-responses?category=return
export const GET: RequestHandler = async ({ locals, url }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const category = url.searchParams.get('category')

  let query = admin
    .from('canned_responses')
    .select('id, title, content, category, shortcut, match_keywords, usage_count, created_at')
    .order('usage_count', { ascending: false })
    .order('title', { ascending: true })

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) return json({ error: error.message }, { status: 500 })
  return json(data ?? [])
}

// POST /api/cms/canned-responses — 신규 등록
export const POST: RequestHandler = async ({ locals, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const body = await request.json() as Partial<CannedResponse>
  const title   = (body.title ?? '').trim()
  const content = (body.content ?? '').trim()
  const category = body.category ?? null
  const shortcut = body.shortcut ? body.shortcut.trim() || null : null
  const matchKeywords = normalizeKeywords(body.match_keywords)

  if (!title)   return json({ error: '제목을 입력해주세요.' }, { status: 400 })
  if (!content) return json({ error: '내용을 입력해주세요.' }, { status: 400 })

  const VALID_CATEGORIES = ['return', 'payment', 'reservation', 'damage', 'general']
  if (category && !VALID_CATEGORIES.includes(category)) {
    return json({ error: '올바르지 않은 카테고리입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('canned_responses')
    .insert({
      title,
      content,
      category,
      shortcut,
      match_keywords: matchKeywords,
      created_by: session.user.id,
    })
    .select('id, title, content, category, shortcut, match_keywords, usage_count, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return json({ error: '이미 사용 중인 단축키입니다.' }, { status: 409 })
    }
    return json({ error: error.message }, { status: 500 })
  }

  return json(data, { status: 201 })
}
