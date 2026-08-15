import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { BENEFIT_TYPES, defaultBenefitParams, type BenefitType } from '$lib/utils/subscriptionBenefits'
import { buildComboCategoryCode } from '$lib/utils/comboCategoryCode'
import type { PageServerLoad, Actions } from './$types'
import type { SubscriptionPolicyItem } from '$lib/types/database'

const POLICY_ITEM_MAX_LENGTH = 200
const POLICY_ITEM_MAX_COUNT = 20

export type MappingGroupSimple = { id: string; name: string; default_category: string | null }
export type MappingItemSimple = { group_id: string; taxonomy_code_id: string; combo_row_id: string }
export type TaxonomyCodeSimple = { id: string; code: string; name: string; product_category: string | null; depth: number; code_tier?: string | null }

function admin() {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
  return createClient(getSupabaseUrl(), serviceRoleKey)
}

function parseJsonField<T>(raw: FormDataEntryValue | null): T | null {
  try {
    return JSON.parse(String(raw ?? '[]')) as T
  } catch {
    return null
  }
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const db = admin()
  const [{ data: parentProductRows }, { data: policyItemRows }, { data: rawGroups }, { data: rawItems }] =
    await Promise.all([
      db
        .from('products')
        .select('id, name')
        .is('parent_product_id', null)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500),
      db
        .from('subscription_policy_items')
        .select('id, content, sort_order, created_at, updated_at')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      // products/new와 동일한 코드조합(code_mapping_groups/items) 소스 재사용 — §T1
      db
        .from('code_mapping_groups')
        .select('id, default_category, name')
        .not('default_category', 'is', null)
        .eq('is_active', true)
        .eq('show_in_product_filter', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      db
        .from('code_mapping_items')
        .select('group_id, taxonomy_code_id, combo_row_id'),
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
    parentProducts: (parentProductRows ?? []) as { id: string; name: string }[],
    policyItems: (policyItemRows ?? []) as SubscriptionPolicyItem[],
    mappingGroups: (rawGroups ?? []) as MappingGroupSimple[],
    mappingItems: (rawItems ?? []) as MappingItemSimple[],
    taxonomyCodes,
  }
}

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const name = String(formData.get('name') ?? '').trim()
    if (!name) return fail(400, { error: '상품명은 필수입니다' })

    const category = String(formData.get('category') ?? '').trim()
    if (!category) return fail(400, { error: '분류(카테고리)를 선택해주세요' })

    const monthlyPrice = Number(formData.get('monthly_price') ?? 0)
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
      return fail(400, { error: '월 가격이 올바르지 않습니다' })
    }

    const features = parseJsonField<{ label: string; value: string }[]>(formData.get('features'))
    if (features === null) return fail(400, { error: '스펙 형식이 올바르지 않습니다' })

    const benefitInputs = parseJsonField<
      { benefit_type: BenefitType; is_enabled: boolean; benefit_params: Record<string, unknown> }[]
    >(formData.get('benefits'))
    if (benefitInputs === null) return fail(400, { error: '혜택 형식이 올바르지 않습니다' })

    const freeRentalProductIds = parseJsonField<string[]>(formData.get('free_rental_product_ids')) ?? []

    const db = admin()

    const { data: plan, error: planError } = await db
      .from('subscription_plans')
      .insert({
        name,
        tagline: String(formData.get('tagline') ?? '') || null,
        description: String(formData.get('description') ?? '') || null,
        image_url: String(formData.get('image_url') ?? '') || null,
        monthly_price: monthlyPrice,
        membership_grade: String(formData.get('membership_grade') ?? '') || null,
        sort_order: Number(formData.get('sort_order') ?? 0),
        features,
        status: 'active',
      })
      .select('id')
      .single()

    if (planError || !plan) return fail(500, { error: planError?.message ?? '등록에 실패했습니다' })

    const regWarnings: string[] = []

    // 코드 조합(콤보) 선택 시 합산 분류코드를 서버에서 직접 재조회해 구성한다(클라이언트가
    // 보낸 문자열을 그대로 신뢰하지 않음 — products/new create 액션과 동일한 안전 패턴).
    const comboRowId = String(formData.get('combo_row_id') ?? '').trim() || null
    let categoryCodeOverride: string | null = null
    if (comboRowId) {
      const { data: comboItems } = await db
        .from('code_mapping_items')
        .select('taxonomy_code_id')
        .eq('combo_row_id', comboRowId)

      if (comboItems && comboItems.length > 0) {
        const codeIds = comboItems.map((i: { taxonomy_code_id: string }) => i.taxonomy_code_id)
        const { data: allCodes } = await db
          .from('product_category_codes')
          .select('id, code, code_tier, depth')
          .in('id', codeIds)
          .eq('is_active', true)
          .is('deleted_at', null)
        if (allCodes && allCodes.length > 0) {
          categoryCodeOverride = buildComboCategoryCode(allCodes)
        }
      }
    }

    // 부모(플랜) 품번 구조(code_series) 설정 — 실제 품번은 발급하지 않음(§2-1 부모/자식 원칙).
    // 실패해도 등록 자체는 막지 않음(regWarn — CMS 대표 패널에 "품번 체계 설정" 재시도 버튼 노출)
    const { data: codeResult, error: codeError } = await db.rpc('generate_subscription_product_code', {
      p_plan_id: plan.id,
      p_category: category,
      p_category_code_override: categoryCodeOverride,
    })
    if (codeError || !codeResult?.success) regWarnings.push('code')

    let freeRentalBenefitId: string | null = null
    for (const type of BENEFIT_TYPES) {
      const input = benefitInputs.find((b) => b.benefit_type === type)
      const { data: inserted, error: benefitError } = await db
        .from('tier_benefits')
        .insert({
          plan_id: plan.id,
          benefit_type: type,
          is_enabled: input?.is_enabled ?? false,
          benefit_params: input?.benefit_params ?? defaultBenefitParams(type),
        })
        .select('id')
        .single()

      if (benefitError) {
        regWarnings.push('benefits')
      } else if (type === 'FREE_RENTAL') {
        freeRentalBenefitId = inserted?.id ?? null
      }
    }

    if (freeRentalBenefitId && freeRentalProductIds.length > 0) {
      const { error: itemsError } = await db
        .from('free_rental_items')
        .insert(freeRentalProductIds.map((pid) => ({ tier_benefit_id: freeRentalBenefitId, product_id: pid })))
      if (itemsError) regWarnings.push('items')
    }

    const warnParam = regWarnings.length > 0 ? `&regWarn=${encodeURIComponent(regWarnings.join(','))}` : ''
    throw redirect(303, `/cms/subscriptions?selected=${plan.id}${warnParam}`)
  },

  addPolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const content = String((await request.formData()).get('content') ?? '').trim()
    if (!content) return fail(400, { error: '정책항목 내용을 입력해주세요' })
    if (content.length > POLICY_ITEM_MAX_LENGTH) {
      return fail(400, { error: `정책항목은 ${POLICY_ITEM_MAX_LENGTH}자 이내로 작성해주세요` })
    }

    const db = admin()
    const { data: existing, count } = await db
      .from('subscription_policy_items')
      .select('sort_order', { count: 'exact' })
      .order('sort_order', { ascending: false })
      .limit(1)
    if ((count ?? 0) >= POLICY_ITEM_MAX_COUNT) {
      return fail(400, { error: `정책항목은 최대 ${POLICY_ITEM_MAX_COUNT}개까지 등록할 수 있습니다` })
    }
    const nextSortOrder = ((existing?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1

    const { error } = await db.from('subscription_policy_items').insert({ content, sort_order: nextSortOrder })
    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  updatePolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const id = String(formData.get('id') ?? '')
    const content = String(formData.get('content') ?? '').trim()
    if (!id) return fail(400, { error: '잘못된 요청' })
    if (!content) return fail(400, { error: '정책항목 내용을 입력해주세요' })
    if (content.length > POLICY_ITEM_MAX_LENGTH) {
      return fail(400, { error: `정책항목은 ${POLICY_ITEM_MAX_LENGTH}자 이내로 작성해주세요` })
    }

    const { error } = await admin()
      .from('subscription_policy_items')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  deletePolicyItem: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const id = String((await request.formData()).get('id') ?? '')
    if (!id) return fail(400, { error: '잘못된 요청' })

    const { error } = await admin().from('subscription_policy_items').delete().eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  reorderPolicyItems: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const orderedIds = parseJsonField<string[]>((await request.formData()).get('ordered_ids'))
    if (!orderedIds || orderedIds.length === 0) return fail(400, { error: '잘못된 요청' })

    const db = admin()
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        db.from('subscription_policy_items').update({ sort_order: index }).eq('id', id)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) return fail(500, { error: failed.error.message })
    return { ok: true }
  },
}
