import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { buildComboCategoryCode } from '$lib/utils/comboCategoryCode'
import type { PageServerLoad, Actions } from './$types'

const MEMBER_CODE_FORMAT_KEY = 'member_code_format'

export type MappingGroupSimple = { id: string; name: string; default_category: string | null }
export type MappingItemSimple = {
  group_id: string
  taxonomy_code_id: string
  combo_row_id: string
  combo_name: string | null
}
export type TaxonomyCodeSimple = {
  id: string
  code: string
  name: string
  product_category: string | null
  depth: number
  code_tier?: string | null
}
export interface MemberCodeSetting {
  prefix: string
  group_name: string
  combo_row_id: string
}
export type SequenceStateRow = { member_type: string; year_month: string; next_seq: number }

function admin() {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
  return createClient(getSupabaseUrl(), serviceRoleKey)
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const db = admin()

  const [{ data: rawGroups }, { data: rawItems }, { data: settingRow }, { count: activeCustomerCount }, { data: rawSequences }] =
    await Promise.all([
      // '회원' 카테고리로 태그된 코드조합만(Stephen 확정) — products/subscriptions 등록화면과
      // 달리 show_in_product_filter는 상품 전용 노출 플래그라 여기선 조건에서 제외한다.
      db
        .from('code_mapping_groups')
        .select('id, default_category, name')
        .eq('default_category', 'member')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      db
        .from('code_mapping_items')
        .select('group_id, taxonomy_code_id, combo_row_id, combo_name'),
      db
        .from('cms_settings')
        .select('value')
        .eq('key', MEMBER_CODE_FORMAT_KEY)
        .maybeSingle(),
      db
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null),
      // 코드 조합 목록·채번 예시가 실제 발급 상태와 어긋나지 않도록(2026-08-17 Stephen 지적 —
      // "001~999" 고정 표기가 실제로는 이미 그 범위를 넘어 채번 중인 접두어와 불일치) 현재
      // member_code_sequences 전체를 함께 조회해 클라이언트에서 접두어별 실제 다음 순번을
      // 그대로 노출한다(테이블 소규모라 필터 없이 전체 로드 — mappingItems/taxonomyCodes와
      // 동일 패턴).
      db.from('member_code_sequences').select('member_type, year_month, next_seq'),
    ])

  const codeIds = [...new Set((rawItems ?? []).map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id))]
  let taxonomyCodes: TaxonomyCodeSimple[] = []
  if (codeIds.length > 0) {
    const { data: codes } = await db
      .from('product_category_codes')
      .select('id, code, name, product_category, depth, code_tier')
      .in('id', codeIds)
      .eq('is_active', true)
      .is('deleted_at', null)
    taxonomyCodes = (codes ?? []) as TaxonomyCodeSimple[]
  }

  return {
    mappingGroups: (rawGroups ?? []) as MappingGroupSimple[],
    mappingItems: (rawItems ?? []) as MappingItemSimple[],
    taxonomyCodes,
    currentSetting: (settingRow?.value as MemberCodeSetting | null) ?? null,
    activeCustomerCount: activeCustomerCount ?? 0,
    sequenceState: (rawSequences ?? []) as SequenceStateRow[],
  }
}

export const actions: Actions = {
  // 기준코드 저장 — 이 액션은 신규 가입자에게만 즉시 영향을 준다(비파괴적).
  // 기존 고객 반영은 반드시 별도의 bulkReissue 액션(명시적 확인 필요)에서만 이뤄진다.
  saveMemberCodeCombo: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'saveMemberCodeCombo', error: '권한 없음' })

    const formData = await request.formData()
    const comboRowId = String(formData.get('combo_row_id') ?? '').trim()
    const groupName = String(formData.get('group_name') ?? '').trim()
    if (!comboRowId) return fail(400, { action: 'saveMemberCodeCombo', error: '코드 조합을 선택해주세요' })

    const db = admin()

    // 코드 조합의 분류코드를 서버에서 직접 재조회해 접두어를 구성한다(클라이언트가 보낸
    // 문자열을 그대로 신뢰하지 않음 — products/new, subscriptions/new create 액션과 동일 패턴).
    const { data: comboItems } = await db
      .from('code_mapping_items')
      .select('taxonomy_code_id')
      .eq('combo_row_id', comboRowId)

    if (!comboItems || comboItems.length === 0) {
      return fail(400, { action: 'saveMemberCodeCombo', error: '유효하지 않은 코드 조합입니다' })
    }

    const codeIds = comboItems.map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id)
    const { data: allCodes } = await db
      .from('product_category_codes')
      .select('id, code, code_tier, depth')
      .in('id', codeIds)
      .eq('is_active', true)
      .is('deleted_at', null)

    if (!allCodes || allCodes.length === 0) {
      return fail(400, { action: 'saveMemberCodeCombo', error: '코드 조합의 분류코드를 찾을 수 없습니다' })
    }

    const prefix = buildComboCategoryCode(allCodes)
    if (!prefix) return fail(400, { action: 'saveMemberCodeCombo', error: '접두어 계산에 실패했습니다' })
    // member_code_sequences.member_type 컬럼 폭(VARCHAR(30), migration 276)을 초과하는 접두어는
    // generate_member_code 채번 시점(실제 신규가입 발생 시)에야 DB 에러(22001)로 터져 회원가입
    // 자체를 막는 장애로 이어진다 — 저장 시점에 미리 차단한다(GATE E 검수 중 발견·수정, migration 276).
    if (prefix.length > 30) {
      return fail(400, { action: 'saveMemberCodeCombo', error: `선택한 코드 조합의 접두어(${prefix})가 너무 깁니다(최대 30자)` })
    }

    const value: MemberCodeSetting = { prefix, group_name: groupName, combo_row_id: comboRowId }

    const { error } = await db
      .from('cms_settings')
      .upsert({ key: MEMBER_CODE_FORMAT_KEY, value, updated_at: new Date().toISOString() })

    if (error) return fail(500, { action: 'saveMemberCodeCombo', error: '저장 실패' })
    return { action: 'saveMemberCodeCombo', success: true }
  },

  // 기존 고객 일괄 재발급 — 되돌릴 수 없는 대량 변경. confirmed=true(체크박스 확인)가 없으면
  // 무조건 거부해 저장 액션과 완전히 분리된 명시적 확인 단계를 강제한다.
  bulkReissue: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'bulkReissue', error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { action: 'bulkReissue', error: '권한 없음' })

    const formData = await request.formData()
    if (formData.get('confirmed') !== 'true') {
      return fail(400, { action: 'bulkReissue', error: '재발급 확인이 필요합니다' })
    }

    const db = admin()
    const { data: settingRow } = await db
      .from('cms_settings')
      .select('value')
      .eq('key', MEMBER_CODE_FORMAT_KEY)
      .maybeSingle()

    const prefix = (settingRow?.value as MemberCodeSetting | null)?.prefix
    if (!prefix) return fail(400, { action: 'bulkReissue', error: '기준 코드가 먼저 설정돼야 합니다' })

    const { data, error } = await db.rpc('bulk_reissue_member_codes', {
      p_prefix: prefix,
      p_reissued_by: session.user.email ?? session.user.id,
    })

    if (error) return fail(500, { action: 'bulkReissue', error: error.message })

    const result = data as { success: boolean; reissued_count?: number; error?: string } | null
    if (!result?.success) return fail(400, { action: 'bulkReissue', error: result?.error ?? '재발급 실패' })

    return { action: 'bulkReissue', success: true, reissuedCount: result.reissued_count ?? 0 }
  },
}
