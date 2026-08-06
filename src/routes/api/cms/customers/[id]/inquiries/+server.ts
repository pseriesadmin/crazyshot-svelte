import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const userId = params.id
  if (!userId) return json({ error: 'id required' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: posts, error: postsErr } = await admin
    .from('cs_posts')
    .select('id, title, content, category, status, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (postsErr) return json({ error: postsErr.message }, { status: 500 })

  const postRows = posts ?? []
  if (postRows.length === 0) return json([])

  const postIds = postRows.map((p: { id: string }) => p.id)

  const { data: replies, error: repliesErr } = await admin
    .from('cs_inquiries')
    .select('id, cs_post_id, response, is_resolution, created_at')
    .in('cs_post_id', postIds)

  if (repliesErr) return json({ error: repliesErr.message }, { status: 500 })

  type ReplyRow = { id: string; cs_post_id: string; response: string; is_resolution: boolean; created_at: string }
  const repliesMap: Record<string, ReplyRow[]> = {}
  for (const r of (replies ?? []) as ReplyRow[]) {
    if (!repliesMap[r.cs_post_id]) repliesMap[r.cs_post_id] = []
    repliesMap[r.cs_post_id].push(r)
  }

  type PostRow = { id: string; title: string; content: string; category: string; status: string; created_at: string }
  const result = (postRows as PostRow[]).map((p) => ({
    ...p,
    cs_inquiries: (repliesMap[p.id] ?? []).map((r) => ({
      id: r.id,
      response: r.response,
      is_resolution: r.is_resolution,
      created_at: r.created_at,
    })),
  }))

  return json(result)
}
