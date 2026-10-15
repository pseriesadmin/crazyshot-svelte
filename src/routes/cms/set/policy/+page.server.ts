import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { ServiceInfoSettings } from '$lib/services/serviceInfoSettings'
import type { SubscriptionPolicyItem } from '$lib/types/database'
import type { PageServerLoad, Actions } from './$types'

// '정책관리' 페이지(/cms/set/policy, 2026-10-15) — 구 /cms/set/rental(대여·예약 이용안내·서비스 기본 정보)과
// 구 /cms/subscriptions/new(⑤ 정책설정)에서 이관. 로직·권한(manager 이상)·RPC는 이관 전과 동일.

const POLICY_ITEM_MAX_LENGTH = 200
const POLICY_ITEM_MAX_COUNT = 20

function db() {
  return createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
}

// database.ts에 신규 테이블/RPC 미등록 상태 — generate_typescript_types 이후 제거
function untypedFrom(sb: SupabaseClient, table: string) {
  return (sb as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> }).from(table)
}
function untypedRpc(sb: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  return (sb as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc(fn, args)
}

export interface RentalConsentItem {
  id: string
  content: string
  display_order: number
  is_active: boolean
}
export type PolicySettingsRow = { privacy_text: string; terms_text: string; refund_text: string }
const EMPTY_SERVICE_INFO: ServiceInfoSettings = {
  company_name: '', ceo_name: '', biz_address: '', biz_reg_no: '', mail_order_biz_no: '',
  privacy_officer: '', ceo_email: '', cs_phone: '', business_hours: '',
}

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  // 이 화면의 모든 액션이 manager 이상 전용이므로 페이지 진입도 같은 기준으로 막는다(codes·accounts와 동일 패턴)
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const admin = db()
  const [
    { data: guideRow },
    { data: policyRow },
    { data: serviceInfoRow },
    { data: consentRows },
    { data: policyItemRows },
  ] = await Promise.all([
    untypedFrom(admin, 'rental_guide_settings')
      .select('guide_text')
      .limit(1)
      .single(),
    untypedFrom(admin, 'rental_policy_settings')
      .select('privacy_text, terms_text, refund_text')
      .limit(1)
      .single(),
    untypedFrom(admin, 'service_info_settings')
      .select('company_name, ceo_name, biz_address, biz_reg_no, mail_order_biz_no, privacy_officer, ceo_email, cs_phone, business_hours')
      .limit(1)
      .single(),
    untypedFrom(admin, 'rental_consent_items')
      .select('id, content, display_order, is_active')
      .is('deleted_at', null)
      .order('display_order'),
    untypedFrom(admin, 'subscription_policy_items')
      .select('id, content, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  return {
    guideText: (guideRow as { guide_text: string | null } | null)?.guide_text ?? '',
    policySettings: ((policyRow as PolicySettingsRow | null) ?? { privacy_text: '', terms_text: '', refund_text: '' }) as PolicySettingsRow,
    serviceInfo: ((serviceInfoRow as ServiceInfoSettings | null) ?? EMPTY_SERVICE_INFO) as ServiceInfoSettings,
    consents: (consentRows ?? []) as unknown as RentalConsentItem[],
    policyItems: (policyItemRows ?? []) as unknown as SubscriptionPolicyItem[],
  }
}

export const actions: Actions = {
  // ═══ 2026-10-15 Stephen 지시 — 구 /cms/set/rental·/cms/subscriptions/new에서 이관 ═══
  // 로직·권한(manager 이상)·RPC는 이관 전과 동일. 반환값에 action을 붙이는 건 프로젝트의 액션
  // 반환 관례(action 키 동봉)를 따른다.

  // ─── 공통 대여 안내문 ───
  saveGuide: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'saveGuide', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'saveGuide', error: '권한 없음' })
    const data = await request.formData()
    const guideText = (data.get('guide_text') as string | null) ?? ''

    if (guideText.length > 1000) return fail(400, { action: 'saveGuide', error: '안내문은 최대 1,000자까지 입력 가능합니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_guide', {
      p_guide_text: guideText,
    })
    if (error) return fail(500, { action: 'saveGuide', error: error.message })
    return { action: 'saveGuide', success: true }
  },

  // ─── 법적 고지 텍스트(개인정보처리방침·이용약관·환불·취소 정책) ───
  savePolicy: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'savePolicy', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'savePolicy', error: '권한 없음' })
    const data = await request.formData()
    const field = (data.get('policy_field') as string | null) ?? ''
    const text = (data.get('policy_text') as string | null) ?? ''

    if (!['privacy_text', 'terms_text', 'refund_text'].includes(field)) {
      return fail(400, { action: 'savePolicy', error: '올바르지 않은 항목입니다.' })
    }
    if (text.length > 5000) return fail(400, { action: 'savePolicy', error: '내용은 최대 5,000자까지 입력 가능합니다.' })

    const fieldToParam: Record<string, string> = {
      privacy_text: 'p_privacy',
      terms_text: 'p_terms',
      refund_text: 'p_refund',
    }
    // eslint-disable-next-line security/detect-object-injection
    const params: Record<string, string> = { [fieldToParam[field]]: text }

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_policy_settings', params)
    if (error) return fail(500, { action: 'savePolicy', error: error.message })
    return { action: 'savePolicy', success: true }
  },

  // ─── 서비스 기본 정보(사업자 정보, Migration #566) ───
  // PC 공통푸터·모바일 멤버십 푸터·표준계약서 임대인 정보 3곳이 이 값을 단일 소스로 참조한다
  // (src/lib/services/serviceInfoSettings.ts). 9개 필드를 단일 폼으로 한 번에 저장.
  saveServiceInfo: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'saveServiceInfo', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'saveServiceInfo', error: '권한 없음' })
    const data = await request.formData()

    const fields = {
      company_name:      (data.get('company_name') as string | null)?.trim() ?? '',
      ceo_name:          (data.get('ceo_name') as string | null)?.trim() ?? '',
      biz_address:       (data.get('biz_address') as string | null)?.trim() ?? '',
      biz_reg_no:        (data.get('biz_reg_no') as string | null)?.trim() ?? '',
      mail_order_biz_no: (data.get('mail_order_biz_no') as string | null)?.trim() ?? '',
      privacy_officer:   (data.get('privacy_officer') as string | null)?.trim() ?? '',
      ceo_email:         (data.get('ceo_email') as string | null)?.trim() ?? '',
      cs_phone:          (data.get('cs_phone') as string | null)?.trim() ?? '',
      business_hours:    (data.get('business_hours') as string | null)?.trim() ?? '',
    }

    for (const [key, value] of Object.entries(fields)) {
      if (value.length > 200) return fail(400, { action: 'saveServiceInfo', error: `${key} 항목은 최대 200자까지 입력 가능합니다.` })
    }

    const { error } = await untypedRpc(locals.supabase, 'upsert_service_info_settings', {
      p_company_name: fields.company_name,
      p_ceo_name: fields.ceo_name,
      p_biz_address: fields.biz_address,
      p_biz_reg_no: fields.biz_reg_no,
      p_mail_order_biz_no: fields.mail_order_biz_no,
      p_privacy_officer: fields.privacy_officer,
      p_ceo_email: fields.ceo_email,
      p_cs_phone: fields.cs_phone,
      p_business_hours: fields.business_hours,
    })
    if (error) return fail(500, { action: 'saveServiceInfo', error: error.message })
    return { action: 'saveServiceInfo', success: true }
  },

  // ─── 필수 동의문 ───
  addConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'addConsent', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'addConsent', error: '권한 없음' })
    const data = await request.formData()
    const content = (data.get('content') as string | null)?.trim() ?? ''
    const count = parseInt(data.get('count') as string, 10)

    if (!content) return fail(400, { action: 'addConsent', error: '동의문 내용을 입력해주세요.' })
    if (content.length > 200) return fail(400, { action: 'addConsent', error: '동의문은 최대 200자까지 입력 가능합니다.' })
    if (count >= 10) return fail(400, { action: 'addConsent', error: '필수 동의문은 최대 10개까지 등록할 수 있습니다.' })

    const { error } = await untypedRpc(locals.supabase, 'upsert_rental_consent_item', {
      p_id: null,
      p_content: content,
      p_display_order: count,
    })
    if (error) return fail(500, { action: 'addConsent', error: error.message })
    return { action: 'addConsent', success: true }
  },

  deleteConsent: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'deleteConsent', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'deleteConsent', error: '권한 없음' })
    const data = await request.formData()
    const id = data.get('id') as string
    const { error } = await untypedRpc(locals.supabase, 'delete_rental_consent_item', { p_id: id })
    if (error) return fail(500, { action: 'deleteConsent', error: error.message })
    return { action: 'deleteConsent', success: true }
  },

  reorderConsents: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'reorderConsents', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'reorderConsents', error: '권한 없음' })
    const data = await request.formData()
    const raw = data.get('ids')
    if (!raw) return fail(400, { action: 'reorderConsents', error: 'ids required' })
    const ids = JSON.parse(raw as string) as string[]
    const { error } = await untypedRpc(locals.supabase, 'reorder_rental_consent_items', { p_ids: ids })
    if (error) return fail(500, { action: 'reorderConsents', error: error.message })
    return { action: 'reorderConsents', success: true }
  },

  // ─── 정기구독 정책항목(구 /cms/subscriptions/new ⑤ 정책설정) ───
  addPolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'addPolicyItem', error: '권한 없음' })

    const content = String((await request.formData()).get('content') ?? '').trim()
    if (!content) return fail(400, { action: 'addPolicyItem', error: '정책항목 내용을 입력해주세요' })
    if (content.length > POLICY_ITEM_MAX_LENGTH) {
      return fail(400, { action: 'addPolicyItem', error: `정책항목은 ${POLICY_ITEM_MAX_LENGTH}자 이내로 작성해주세요` })
    }

    const admin = db()
    const { data: existing, count } = await admin
      .from('subscription_policy_items')
      .select('sort_order', { count: 'exact' })
      .order('sort_order', { ascending: false })
      .limit(1)
    if ((count ?? 0) >= POLICY_ITEM_MAX_COUNT) {
      return fail(400, { action: 'addPolicyItem', error: `정책항목은 최대 ${POLICY_ITEM_MAX_COUNT}개까지 등록할 수 있습니다` })
    }
    const nextSortOrder = ((existing?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1

    const { error } = await admin.from('subscription_policy_items').insert({ content, sort_order: nextSortOrder })
    if (error) return fail(500, { action: 'addPolicyItem', error: error.message })
    return { action: 'addPolicyItem', success: true }
  },

  updatePolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'updatePolicyItem', error: '권한 없음' })

    const formData = await request.formData()
    const id = String(formData.get('id') ?? '')
    const content = String(formData.get('content') ?? '').trim()
    if (!id) return fail(400, { action: 'updatePolicyItem', error: '잘못된 요청' })
    if (!content) return fail(400, { action: 'updatePolicyItem', error: '정책항목 내용을 입력해주세요' })
    if (content.length > POLICY_ITEM_MAX_LENGTH) {
      return fail(400, { action: 'updatePolicyItem', error: `정책항목은 ${POLICY_ITEM_MAX_LENGTH}자 이내로 작성해주세요` })
    }

    const { error } = await db()
      .from('subscription_policy_items')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(500, { action: 'updatePolicyItem', error: error.message })
    return { action: 'updatePolicyItem', success: true }
  },

  deletePolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'deletePolicyItem', error: '권한 없음' })

    const id = String((await request.formData()).get('id') ?? '')
    if (!id) return fail(400, { action: 'deletePolicyItem', error: '잘못된 요청' })

    const { error } = await db().from('subscription_policy_items').delete().eq('id', id)
    if (error) return fail(500, { action: 'deletePolicyItem', error: error.message })
    return { action: 'deletePolicyItem', success: true }
  },

  reorderPolicyItems: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'reorderPolicyItems', error: '권한 없음' })

    let orderedIds: string[] | null = null
    try {
      orderedIds = JSON.parse(String((await request.formData()).get('ordered_ids') ?? '[]')) as string[]
    } catch {
      orderedIds = null
    }
    if (!orderedIds || orderedIds.length === 0) return fail(400, { action: 'reorderPolicyItems', error: '잘못된 요청' })

    const admin = db()
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        admin.from('subscription_policy_items').update({ sort_order: index }).eq('id', id)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) return fail(500, { action: 'reorderPolicyItems', error: failed.error.message })
    return { action: 'reorderPolicyItems', success: true }
  },
}
