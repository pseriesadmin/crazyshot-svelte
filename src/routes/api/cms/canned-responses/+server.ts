// /api/cms/canned-responses — 캔드 리스폰스 목록 조회 / 신규 등록
// 편집 권한: is_cms_user() (파트너 포함 모든 CMS 사용자)
import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { isValidCtaUrl } from '$lib/utils/ctaUrl'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { normalizeKeywords } from '$lib/server/normalizeKeywords'
import { isAssignableCategory, loadCannedCategories } from '$lib/server/cannedCategories'
import { VALID_HELP_CATEGORIES } from '$lib/constants/helpCategories'

export interface CannedResponse {
  id: string
  title: string
  content: string
  category: string | null
  help_category: string
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
  created_by: string | null
  created_at: string
  image_url?: string | null
  cta_label?: string | null
  cta_url?: string | null
  pending_review?: boolean
}

// GET /api/cms/canned-responses?category=return
export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireAnyMenuAccessApi(locals, ['consulting.chat', 'consulting.qna'])
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const category = url.searchParams.get('category')

  let query = admin
    .from('canned_responses')
    .select('id, title, content, category, help_category, shortcut, match_keywords, usage_count, created_at, image_url, cta_label, cta_url, pending_review')
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
  const denied = await requireMenuAccessApi(locals, 'consulting.qna')
  if (denied) return denied
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
  const helpCategory = body.help_category ?? null
  const shortcut = body.shortcut ? body.shortcut.trim() || null : null
  const matchKeywords = normalizeKeywords(body.match_keywords)
  const imageUrl  = typeof body.image_url === 'string' ? body.image_url.trim() || null : null
  const ctaLabel  = typeof body.cta_label === 'string' ? body.cta_label.trim() || null : null
  const ctaUrl    = typeof body.cta_url === 'string'   ? body.cta_url.trim() || null : null

  if (ctaUrl && !isValidCtaUrl(ctaUrl)) {
    return json({ error: '버튼 링크는 http(s):// 또는 /로 시작해야 합니다.' }, { status: 400 })
  }
  if (!title)   return json({ error: '제목을 입력해주세요.' }, { status: 400 })
  if (!content) return json({ error: '내용을 입력해주세요.' }, { status: 400 })

  if (category && !isAssignableCategory(category, await loadCannedCategories(createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)))) {
    return json({ error: '올바르지 않은 카테고리입니다.' }, { status: 400 })
  }

  if (!helpCategory) return json({ error: '도움말 분류를 선택해주세요.' }, { status: 400 })
  if (!VALID_HELP_CATEGORIES.includes(helpCategory)) {
    return json({ error: '올바르지 않은 도움말 분류입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('canned_responses')
    .insert({
      title,
      content,
      category,
      help_category: helpCategory,
      shortcut,
      match_keywords: matchKeywords,
      created_by: session.user.id,
      image_url: imageUrl,
      cta_label: ctaLabel,
      cta_url: ctaUrl,
      // pending_review 미지정 — 관리자가 직접 작성한 단건 등록은 DB 기본값(false)대로
      // 즉시 신뢰 가능(검토 대기 아님). CSV 일괄등록(bulk-import)만 true로 명시 삽입.
    })
    .select('id, title, content, category, help_category, shortcut, match_keywords, usage_count, created_at, image_url, cta_label, cta_url, pending_review')
    .single()

  if (error) {
    if (error.code === '23505') {
      return json({ error: '이미 사용 중인 단축키입니다.' }, { status: 409 })
    }
    return json({ error: error.message }, { status: 500 })
  }

  return json(data, { status: 201 })
}
