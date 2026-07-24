import { fail, redirect } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'

export interface MyPost {
  id:          string
  title:       string
  content:     string
  category:    string
  status:      string
  created_at:  string
  cs_inquiries: MyReply[]
}

export interface MyReply {
  id:            string
  response:      string
  is_resolution: boolean
  created_at:    string
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const { data, error } = await locals.supabase
    .from('cs_posts')
    .select('id, title, content, category, status, created_at, cs_inquiries(id, response, is_resolution, created_at)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[account/inquiry] load error:', error.message)
    return { posts: [] as MyPost[] }
  }

  return {
    posts: (data ?? []) as MyPost[],
  }
}

export const actions: Actions = {
  submit: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '로그인이 필요합니다.' })

    const fd      = await request.formData()
    const title   = (fd.get('title')    as string | null)?.trim()
    const content = (fd.get('content')  as string | null)?.trim()
    const category = (fd.get('category') as string | null)?.trim() ?? 'general'

    if (!title || title.length < 2)    return fail(400, { error: '제목을 2자 이상 입력해 주세요.' })
    if (!content || content.length < 5) return fail(400, { error: '내용을 5자 이상 입력해 주세요.' })

    const { error } = await (locals.supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
      'submit_cs_post', { p_title: title, p_content: content, p_category: category }
    )

    if (error) return fail(500, { error: '등록에 실패했습니다. 다시 시도해 주세요.' })
    return { ok: true }
  },
}
