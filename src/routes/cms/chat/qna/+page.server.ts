// /cms/chat/qna — 빠른답변(QnA) 관리 화면 서버
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { PageServerLoad, Actions } from './$types'

export interface CannedResponseRow {
  id: string
  title: string
  content: string
  category: string | null
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
  created_at: string
}

interface AutoReplySetting {
  id: string
  enabled: boolean
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const [itemsResult, autoReplyResult] = await Promise.all([
    admin
      .from('canned_responses')
      .select('id, title, content, category, shortcut, match_keywords, usage_count, created_at')
      .order('usage_count', { ascending: false })
      .order('title', { ascending: true }),
    admin
      .from('auto_reply_settings')
      .select('id, enabled')
      .limit(1)
      .maybeSingle(),
  ])

  const items = (itemsResult.error ? [] : (itemsResult.data ?? [])) as CannedResponseRow[]
  const selectedId = url.searchParams.get('selected') ?? null
  const selectedItem = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null

  const autoReplySetting = autoReplyResult.data as AutoReplySetting | null

  return {
    items,
    selectedId,
    selectedItem,
    autoReplyEnabled: autoReplySetting?.enabled ?? false,
    autoReplySettingId: autoReplySetting?.id ?? null,
    cmsRole,
  }
}

export const actions: Actions = {
  delete: async ({ locals, request }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(401, { error: '인증 필요' })

    const formData = await request.formData()
    const id = formData.get('id') as string | null
    if (!id) return fail(400, { error: 'id 필요' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await admin.from('canned_responses').delete().eq('id', id)

    if (error) return fail(500, { error: error.message })
    return { success: true }
  },
}
