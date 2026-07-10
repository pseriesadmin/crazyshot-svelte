import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export interface ScoreAuditRow {
  id: string
  user_id: string
  old_score: number
  new_score: number
  reason: string
  metadata: Record<string, unknown> | null
  created_at: string
  user_name: string | null
  user_email: string | null
  user_membership_grade: string | null
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { entries: [] as ScoreAuditRow[], search: '' }

  const search = url.searchParams.get('search') ?? ''

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin
    .from('credit_score_audit')
    .select(`
      id, user_id, old_score, new_score, reason, metadata, created_at,
      user_profiles!inner(name, email, membership_grade)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[score/load]', error)
    return { entries: [] as ScoreAuditRow[], search }
  }

  let rows: ScoreAuditRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const up = r.user_profiles as Record<string, unknown> | null
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      old_score: r.old_score as number,
      new_score: r.new_score as number,
      reason: r.reason as string,
      metadata: r.metadata as Record<string, unknown> | null,
      created_at: r.created_at as string,
      user_name: up?.name as string | null,
      user_email: up?.email as string | null,
      user_membership_grade: up?.membership_grade as string | null,
    }
  })

  if (search.trim()) {
    const q = search.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.user_name?.toLowerCase().includes(q) ||
        r.user_email?.toLowerCase().includes(q)
    )
  }

  return { entries: rows, search }
}
