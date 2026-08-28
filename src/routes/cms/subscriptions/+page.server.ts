import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { loadSelectedSubscriptionDetail } from '$lib/server/subscriptions/loadSelectedSubscriptionDetail'
import { BENEFIT_TYPES, defaultBenefitParams, type BenefitType } from '$lib/utils/subscriptionBenefits'
import type { PageServerLoad, Actions } from './$types'
import type { SubscriptionPlanRow } from '$lib/types/subscription'

const PAGE_SIZE = 20

function admin() {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
  return createClient(getSupabaseUrl(), serviceRoleKey)
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const db = admin()

  const pageParam = Number(url.searchParams.get('page') ?? '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data: rows, count } = await db
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, monthly_price, membership_grade, sort_order, is_popular, category, product_code, code_series, status, features, deleted_at, created_at', { count: 'exact' })
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)

  const plans: SubscriptionPlanRow[] = (rows ?? []).map((r) => ({
    ...r,
    features: Array.isArray(r.features) ? r.features : [],
    image_urls: Array.isArray(r.image_urls) ? r.image_urls : [],
  })) as SubscriptionPlanRow[]

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  const selectedIdParam = url.searchParams.get('selected')
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const selectedDetail = selectedId
    ? await loadSelectedSubscriptionDetail(db, selectedId)
    : null

  // FREE_RENTAL 대상장비 선택용 — 부모 상품만(products.md §1)
  const [{ data: parentProductRows }, { data: categoryRows }] = await Promise.all([
    db
      .from('products')
      .select('id, name')
      .is('parent_product_id', null)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(500),
    db
      .from('code_mapping_groups')
      .select('default_category, name')
      .not('default_category', 'is', null)
      .eq('is_active', true)
      .eq('show_in_product_filter', true)
      .order('sort_order', { ascending: true }),
  ])

  const parentProducts = (parentProductRows ?? []) as { id: string; name: string }[]
  const categoryOptions = (categoryRows ?? []).map((r: { default_category: unknown; name: string }) => ({
    value: r.default_category as string,
    label: r.name,
  }))

  return {
    plans,
    page,
    totalPages,
    selectedId,
    selectedDetail,
    parentProducts,
    categoryOptions,
  }
}

export const actions: Actions = {
  toggleStatus: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const id = Number(formData.get('id'))
    const currentStatus = String(formData.get('status') ?? 'active')
    if (!id) return fail(400, { error: '잘못된 요청' })

    const nextStatus = currentStatus === 'active' ? 'inactive' : 'active'
    const { error } = await admin().from('subscription_plans').update({ status: nextStatus }).eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  deleteSubscription: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const id = Number(formData.get('id'))
    if (!id) return fail(400, { error: '잘못된 요청' })

    const { error } = await admin()
      .from('subscription_plans')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return fail(500, { error: error.message })
    return { ok: true }
  },

  updateSection: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const planId = Number(formData.get('plan_id'))
    const sectionType = String(formData.get('section_type') ?? '')
    if (!planId) return fail(400, { error: '잘못된 요청' })

    const db = admin()

    if (sectionType === 'basic') {
      const name = String(formData.get('name') ?? '').trim()
      if (!name) return fail(400, { error: '상품명은 필수입니다' })

      const { error } = await db
        .from('subscription_plans')
        .update({
          name,
          tagline: String(formData.get('tagline') ?? '') || null,
          membership_grade: String(formData.get('membership_grade') ?? '') || null,
          sort_order: Number(formData.get('sort_order') ?? 0),
          is_popular: formData.get('is_popular') === 'true',
        })
        .eq('id', planId)
      if (error) return fail(500, { error: error.message })
      return { ok: true }
    }

    if (sectionType === 'pricing') {
      const monthlyPrice = Number(formData.get('monthly_price') ?? 0)
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) return fail(400, { error: '월 가격이 올바르지 않습니다' })

      const { error } = await db
        .from('subscription_plans')
        .update({ monthly_price: monthlyPrice })
        .eq('id', planId)
      if (error) return fail(500, { error: error.message })
      return { ok: true }
    }

    if (sectionType === 'content') {
      const raw = String(formData.get('content_blocks') ?? '[]')
      let contentBlocks: unknown[]
      try {
        const parsed = JSON.parse(raw)
        contentBlocks = Array.isArray(parsed) ? parsed : []
      } catch {
        return fail(400, { error: '상품설명 형식이 올바르지 않습니다' })
      }
      const { error } = await db
        .from('subscription_plans')
        .update({ content_blocks: contentBlocks })
        .eq('id', planId)
      if (error) return fail(500, { error: error.message })
      return { ok: true }
    }

    if (sectionType === 'specs') {
      const raw = String(formData.get('features') ?? '[]')
      let features: { label: string; value: string }[]
      try {
        features = JSON.parse(raw)
      } catch {
        return fail(400, { error: '스펙 형식이 올바르지 않습니다' })
      }
      const { error } = await db.from('subscription_plans').update({ features }).eq('id', planId)
      if (error) return fail(500, { error: error.message })
      return { ok: true }
    }

    if (sectionType === 'benefits') {
      const raw = String(formData.get('benefits') ?? '[]')
      let benefits: { benefit_type: BenefitType; is_enabled: boolean; benefit_params: Record<string, unknown> }[]
      try {
        benefits = JSON.parse(raw)
      } catch {
        return fail(400, { error: '혜택 형식이 올바르지 않습니다' })
      }

      for (const b of benefits) {
        if (!BENEFIT_TYPES.includes(b.benefit_type)) continue
        const { error } = await db
          .from('tier_benefits')
          .upsert(
            {
              plan_id: planId,
              benefit_type: b.benefit_type,
              is_enabled: b.is_enabled,
              benefit_params: b.benefit_params ?? defaultBenefitParams(b.benefit_type),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'plan_id,benefit_type' }
          )
        if (error) return fail(500, { error: error.message })
      }
      return { ok: true }
    }

    if (sectionType === 'freeRentalItems') {
      const tierBenefitId = String(formData.get('tier_benefit_id') ?? '')
      const raw = String(formData.get('product_ids') ?? '[]')
      let productIds: string[]
      try {
        productIds = JSON.parse(raw)
      } catch {
        return fail(400, { error: '장비 목록 형식이 올바르지 않습니다' })
      }
      if (!tierBenefitId) return fail(400, { error: '혜택 정보가 없습니다' })

      const { error: delError } = await db
        .from('free_rental_items')
        .delete()
        .eq('tier_benefit_id', tierBenefitId)
      if (delError) return fail(500, { error: delError.message })

      if (productIds.length > 0) {
        const { error: insError } = await db.from('free_rental_items').insert(
          productIds.map((pid) => ({ tier_benefit_id: tierBenefitId, product_id: pid }))
        )
        if (insError) return fail(500, { error: insError.message })
      }
      return { ok: true }
    }

    return fail(400, { error: '알 수 없는 섹션입니다' })
  },

  retryProductCode: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const planId = Number(formData.get('plan_id'))
    const category = String(formData.get('category') ?? '').trim()
    if (!planId || !category) return fail(400, { error: '잘못된 요청' })

    const { data, error } = await admin().rpc('generate_subscription_product_code', {
      p_plan_id: planId,
      p_category: category,
      p_category_code_override: null,
    })
    if (error) return fail(500, { error: error.message })
    if (!data?.success) return fail(400, { error: '이미 품번 체계가 설정된 상품입니다' })
    return { ok: true }
  },

  retrySubscriberCode: async ({ request, locals }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { error: '권한 없음' })

    const formData = await request.formData()
    const userSubscriptionId = Number(formData.get('user_subscription_id'))
    const planId = Number(formData.get('plan_id'))
    if (!userSubscriptionId || !planId) return fail(400, { error: '잘못된 요청' })

    const { data, error } = await admin().rpc('generate_subscription_inventory_product_code', {
      p_user_subscription_id: userSubscriptionId,
      p_plan_id: planId,
    })
    if (error) return fail(500, { error: error.message })
    if (!data?.success) {
      if (data?.error === 'ALREADY_ISSUED') return fail(400, { error: '이미 품번이 발급된 구독자입니다' })
      if (data?.error === 'NO_CODE_SERIES') return fail(400, { error: '플랜의 품번 체계가 설정되지 않았습니다' })
      return fail(400, { error: data?.error ?? '품번 발급에 실패했습니다' })
    }
    return { ok: true }
  },
}
