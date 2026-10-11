import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import {
  DEFAULT_NLSEARCH_PARAMS,
  PARAM_RANGES,
  sanitizeNlsearchParams,
  validateNlsearchParams,
  type NlsearchParams,
} from '$lib/server/searchEngine/adapters/nlsearchParamsSchema'

export interface NlsearchHistoryRow {
  id: number
  version: number
  status: 'applied' | 'proposed' | 'restored'
  reason: string | null
  created_at: string
  params: NlsearchParams
}

const HISTORY_LIMIT = 20

function admin() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

/** 화면에 보여줄 현재 값(없으면 기본값) */
async function readCurrent(): Promise<{ params: NlsearchParams; version: number }> {
  const { data } = await admin().from('nlsearch_settings').select('params, version').eq('id', 1).maybeSingle()
  return {
    params: data ? sanitizeNlsearchParams(data.params) : DEFAULT_NLSEARCH_PARAMS,
    version: data && typeof data.version === 'number' ? data.version : 0,
  }
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasSettingsAccess(cmsRole)) throw redirect(303, '/cms?notice=access_denied')

  const sb = admin()
  const [current, historyRes] = await Promise.all([
    readCurrent(),
    sb
      .from('nlsearch_settings_history')
      .select('id, version, status, reason, created_at, params')
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ])

  const history: NlsearchHistoryRow[] = ((historyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    version: Number(r.version),
    status: r.status as NlsearchHistoryRow['status'],
    reason: (r.reason as string | null) ?? null,
    created_at: String(r.created_at),
    params: sanitizeNlsearchParams(r.params),
  }))

  return {
    params: current.params,
    version: current.version,
    defaults: DEFAULT_NLSEARCH_PARAMS,
    ranges: PARAM_RANGES,
    history,
    cmsRole,
  }
}

async function authorize(locals: App.Locals): Promise<{ userId: string } | { error: ReturnType<typeof fail> }> {
  const { session } = await locals.safeGetSession()
  if (!session) return { error: fail(401, { message: '인증 필요' }) }
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return { error: fail(403, { message: '권한 없음' }) }
  return { userId: session.user.id }
}

async function persist(
  userId: string,
  next: NlsearchParams,
  status: 'applied' | 'restored',
  reason: string | null,
): Promise<{ ok: true; version: number } | { ok: false; message: string }> {
  const sb = admin()
  const before = await readCurrent()
  const { data, error } = await sb.rpc('cms_save_nlsearch_settings', {
    p_params: next,
    p_user_id: userId,
    p_status: status,
    p_reason: reason,
  })
  if (error) return { ok: false, message: error.message }
  await insertCmsAdminAuditLog(sb, {
    actorId: userId,
    actionType: 'nlsearch_setting_change',
    targetUserId: null,
    beforeValue: { version: before.version, params: before.params },
    afterValue: { version: data as number, params: next, status },
  })
  return { ok: true, version: data as number }
}

export const actions: Actions = {
  /** 저장: 서버가 범위를 다시 검증한다(화면 검증은 보조). 범위 밖이면 저장하지 않는다. */
  save: async ({ request, locals }) => {
    const auth = await authorize(locals)
    if ('error' in auth) return auth.error

    const form = await request.formData()
    let raw: unknown
    try {
      raw = JSON.parse(String(form.get('params') ?? ''))
    } catch {
      return fail(400, { message: '값을 해석하지 못했습니다.' })
    }
    const v = validateNlsearchParams(raw)
    if (!v.ok) return fail(400, { message: v.errors.slice(0, 3).join(' / ') })
    const reason = String(form.get('reason') ?? '').trim().slice(0, 200) || null

    const r = await persist(auth.userId, v.params, 'applied', reason)
    if (!r.ok) return fail(500, { message: r.message })
    return { ok: true, action: 'save' as const, version: r.version }
  },

  /** 이력의 값으로 되돌리기(제안값 적용 포함) — 이력 행의 값을 다시 검증해 새 버전으로 저장한다 */
  restore: async ({ request, locals }) => {
    const auth = await authorize(locals)
    if ('error' in auth) return auth.error

    const form = await request.formData()
    const id = Number(form.get('history_id'))
    if (!Number.isInteger(id) || id <= 0) return fail(400, { message: '잘못된 요청입니다.' })

    const { data, error } = await admin().from('nlsearch_settings_history').select('params, version, status').eq('id', id).maybeSingle()
    if (error || !data) return fail(404, { message: '이력을 찾지 못했습니다.' })

    const v = validateNlsearchParams(data.params)
    if (!v.ok) return fail(400, { message: '이력 값이 현재 허용 범위를 벗어나 적용할 수 없습니다.' })

    const label = data.status === 'proposed' ? `제안(v${data.version}) 적용` : `v${data.version} 값으로 복원`
    const r = await persist(auth.userId, v.params, 'restored', label)
    if (!r.ok) return fail(500, { message: r.message })
    return { ok: true, action: 'restore' as const, version: r.version }
  },
}
