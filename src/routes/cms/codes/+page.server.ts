import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

const FORMAT_KEY   = 'reservation_code_format'
const PREFIX_KEY   = 'prefix_codes'

function db() {
  return createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
}

type AdminClient = ReturnType<typeof db>

/** 분류코드에 연결된 활성 상품 수 반환 */
async function getLinkedProductCount(admin: AdminClient, codeId: string): Promise<number> {
  const { data: codeRow } = await admin
    .from('product_category_codes')
    .select('code, product_category')
    .eq('id', codeId)
    .maybeSingle()
  if (!codeRow) return 0

  const categoryVal = codeRow.product_category ?? codeRow.code.toLowerCase()
  const { count } = await admin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category', categoryVal)
    .is('deleted_at', null)
  return count ?? 0
}

/** 세션 사용자가 superadmin인지 확인 */
async function checkSuperadmin(admin: AdminClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', userId)
    .maybeSingle()
  return (data as { cms_role: string | null } | null)?.cms_role === 'superadmin'
}

export type TaxonomyCode = {
  id: string
  code: string
  name: string
  parent_id: string | null
  depth: number
  path_codes: string[]
  product_category: string | null
  is_active: boolean
  sort_order: number
  description: string | null
  code_rule: Record<string, unknown> | null
  meta_keywords: string[] | null
  code_tier: 'major' | 'middle' | 'minor' | null
  created_at: string
  deleted_at: string | null
}

export type CodeFormat = {
  prefix: string
  date_format: string
  seq_digits: number
  reset_monthly: boolean
  suffix: string
}

export type TaxonomyMapping = {
  id: string
  product_category: string
  taxonomy_code_id: string
  priority: number
  is_auto: boolean
}

export type MappingGroup = {
  id: string
  name: string
  description: string | null
  keywords: string[]
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type MappingItem = {
  id: string
  group_id: string
  taxonomy_code_id: string
  sort_order: number
  date_option: 'none' | 'ym' | 'ymd'
  max_sequence: number
  combo_row_id: string
  combo_name: string | null
  combo_keywords: string[]
  created_at: string
}

const DEFAULT_FORMAT: CodeFormat = {
  prefix: 'CS',
  date_format: 'YYMM',
  seq_digits: 3,
  reset_monthly: true,
  suffix: '',
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const admin = db()

  const [
    { data: codes },
    { data: fmtRow },
    { data: prefixRow },
    { data: productCounts },
    { data: mappings },
    { data: userProfile },
    mappingGroupsResult,
    mappingItemsResult,
  ] = await Promise.all([
    admin
      .from('product_category_codes')
      .select('id, code, name, parent_id, depth, path_codes, product_category, is_active, sort_order, description, code_rule, meta_keywords, created_at, code_tier')
      .is('deleted_at', null)
      .order('depth')
      .order('sort_order')
      .order('code'),
    admin
      .from('cms_settings')
      .select('value')
      .eq('key', FORMAT_KEY)
      .maybeSingle(),
    admin
      .from('cms_settings')
      .select('value')
      .eq('key', PREFIX_KEY)
      .maybeSingle(),
    admin
      .from('products')
      .select('category')
      .is('deleted_at', null),
    admin
      .from('category_taxonomy_map')
      .select('id, product_category, taxonomy_code_id, priority, is_auto'),
    admin
      .from('user_profiles')
      .select('cms_role')
      .eq('id', session.user.id)
      .maybeSingle(),
    admin
      .from('code_mapping_groups')
      .select('id, name, description, keywords, is_active, sort_order, created_at, updated_at')
      .order('sort_order')
      .order('name'),
    admin
      .from('code_mapping_items')
      .select('id, group_id, taxonomy_code_id, sort_order, date_option, max_sequence, combo_row_id, combo_name, combo_keywords, created_at')
      .order('sort_order'),
  ])

  const productCountMap: Record<string, number> = {}
  for (const p of productCounts ?? []) {
    const cat = (p as { category: string }).category
    // eslint-disable-next-line security/detect-object-injection
    productCountMap[cat] = (productCountMap[cat] ?? 0) + 1
  }

  const rawPrefixValue = (prefixRow as { value?: unknown } | null)?.value
  const prefixCodes: string[] = Array.isArray(rawPrefixValue) ? (rawPrefixValue as string[]) : ['CS']

  return {
    codes: (codes ?? []) as TaxonomyCode[],
    codeFormat: ((fmtRow as { value?: CodeFormat } | null)?.value ?? DEFAULT_FORMAT) as CodeFormat,
    prefixCodes,
    productCountMap,
    mappings: (mappings ?? []) as TaxonomyMapping[],
    mappingGroups: (mappingGroupsResult.data ?? []) as MappingGroup[],
    mappingItems: (mappingItemsResult.data ?? []) as MappingItem[],
    userRole: (userProfile as { cms_role: string | null } | null)?.cms_role ?? null,
  }
}

export const actions: Actions = {
  // ── 코드 추가 ──────────────────────────────────────────────────────────
  addCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'addCode', error: '인증 필요' })

    const form = await request.formData()
    const code       = ((form.get('code')      as string) ?? '').trim().toUpperCase()
    const name       = ((form.get('name')      as string) ?? '').trim()
    const parent_id  = ((form.get('parent_id') as string) ?? '') || null
    const product_category = ((form.get('product_category') as string) ?? '') || null
    const description      = ((form.get('description')      as string) ?? '').trim() || null
    const sort_order = parseInt((form.get('sort_order') as string) ?? '99') || 99
    const keywordsRaw = ((form.get('meta_keywords') as string) ?? '').trim()
    const meta_keywords: string[] = keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(Boolean)
      : []
    const prefix_override = ((form.get('prefix_override') as string) ?? '').trim().toUpperCase() || null
    const date_include = form.get('date_include') !== 'false'   // 'false' 명시 시 년월 생략
    const code_tier_raw = ((form.get('code_tier') as string) ?? '').trim()
    const code_tier = (['major', 'middle', 'minor'].includes(code_tier_raw) ? code_tier_raw : null) as 'major' | 'middle' | 'minor' | null
    const seq_limit_raw = parseInt((form.get('seq_limit') as string) ?? '0')
    const seq_limit = (seq_limit_raw > 0 && seq_limit_raw <= 999) ? seq_limit_raw : null

    if (!code || !name)
      return fail(400, { action: 'addCode', error: '코드와 코드명은 필수입니다.' })
    if (!/^[A-Za-z0-9#%&@]{1,20}$/.test(code))
      return fail(400, { action: 'addCode', error: '코드: 영문·숫자·#%&@만 허용, 최대 20자. 하이픈 사용 불가.' })

    const admin = db()

    // 중복 확인
    const { data: dup } = await admin
      .from('product_category_codes')
      .select('id')
      .eq('code', code)
      .is('deleted_at', null)
      .maybeSingle()
    if (dup) return fail(400, { action: 'addCode', error: `'${code}' 코드가 이미 존재합니다.` })

    // 부모 정보로 depth·path 계산
    let depth = 0
    let path_codes: string[] = [code]

    if (parent_id) {
      const { data: parent } = await admin
        .from('product_category_codes')
        .select('depth, path_codes')
        .eq('id', parent_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!parent) return fail(400, { action: 'addCode', error: '유효하지 않은 상위 코드입니다.' })
      depth = (parent as { depth: number }).depth + 1
      path_codes = [...((parent as { path_codes: string[] }).path_codes), code]
    }

    // code_rule 조립 (prefix_override·date_include 합산)
    let code_rule: Record<string, unknown> | null = null
    const ruleEntries: Record<string, unknown> = {}
    if (prefix_override && prefix_override !== 'CS') ruleEntries.prefix = prefix_override
    if (!date_include) ruleEntries.date_format = 'NONE'
    if (seq_limit) ruleEntries.seq_limit = seq_limit
    if (Object.keys(ruleEntries).length > 0) code_rule = ruleEntries

    const { error } = await admin.rpc('cms_add_taxonomy_code', {
      p_code: code,
      p_name: name,
      p_parent_id: parent_id,
      p_depth: depth,
      p_path_codes: path_codes,
      p_product_category: product_category,
      p_description: description,
      p_sort_order: sort_order,
      p_meta_keywords: meta_keywords,
    })
    if (error) return fail(500, { action: 'addCode', error: '추가에 실패했습니다: ' + error.message })

    // code_rule + code_tier 업데이트
    if (code_rule || code_tier) {
      const { data: newNode } = await admin
        .from('product_category_codes')
        .select('id, code_rule')
        .eq('code', code)
        .is('deleted_at', null)
        .maybeSingle()
      if (newNode) {
        const updatePayload: Record<string, unknown> = {}
        if (code_rule) {
          updatePayload.code_rule = { ...(((newNode as { code_rule?: Record<string, unknown> }).code_rule) ?? {}), ...code_rule }
        }
        if (code_tier) {
          updatePayload.code_tier = code_tier
        }
        await admin
          .from('product_category_codes')
          .update(updatePayload)
          .eq('id', (newNode as { id: string }).id)
      }
    }

    return { action: 'addCode', success: true }
  },

  // ── 코드 편집 ──────────────────────────────────────────────────────────
  editCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'editCode', error: '인증 필요' })

    const form = await request.formData()
    const id               = (form.get('id')               as string) ?? ''
    const name             = ((form.get('name')            as string) ?? '').trim()
    const description      = ((form.get('description')     as string) ?? '').trim() || null
    const product_category = ((form.get('product_category') as string) ?? '') || null
    const sort_order = parseInt((form.get('sort_order') as string) ?? '99') || 99
    const keywordsRaw = ((form.get('meta_keywords') as string) ?? '').trim()
    const meta_keywords: string[] = keywordsRaw
      ? keywordsRaw.split(',').map(k => k.trim()).filter(Boolean)
      : []
    const date_include = form.get('date_include') !== 'false'
    const seq_limit_raw = parseInt((form.get('seq_limit') as string) ?? '0')
    const seq_limit = (seq_limit_raw > 0 && seq_limit_raw <= 9999) ? seq_limit_raw : null

    if (!name) return fail(400, { action: 'editCode', error: '코드명은 필수입니다.' })

    const admin = db()

    // 연결 상품 존재 시 수정 불가 (모든 관리자)
    const linkedCount = await getLinkedProductCount(admin, id)
    if (linkedCount > 0)
      return fail(400, { action: 'editCode', error: `이 코드로 등록된 상품 ${linkedCount}개가 있어 수정할 수 없습니다.` })

    const { error } = await admin.rpc('cms_edit_taxonomy_code', {
      p_id: id,
      p_name: name,
      p_description: description,
      p_product_category: product_category,
      p_sort_order: sort_order,
      p_meta_keywords: meta_keywords,
    })

    if (error) return fail(500, { action: 'editCode', error: '수정에 실패했습니다.' })

    // date_include → code_rule.date_format 갱신 (prefix 등 기존 필드 보존)
    const { data: existing } = await admin
      .from('product_category_codes')
      .select('code_rule')
      .eq('id', id)
      .maybeSingle()
    const currentRule = (existing as { code_rule: Record<string, unknown> | null } | null)?.code_rule ?? {}
    const updatedRule: Record<string, unknown> = { ...currentRule }
    if (!date_include) {
      updatedRule.date_format = 'NONE'
    } else {
      delete updatedRule.date_format
    }
    if (seq_limit !== null) {
      updatedRule.seq_limit = seq_limit
    } else {
      delete updatedRule.seq_limit
    }
    await admin
      .from('product_category_codes')
      .update({ code_rule: Object.keys(updatedRule).length > 0 ? updatedRule : null })
      .eq('id', id)

    return { action: 'editCode', success: true }
  },

  // ── 코드 삭제 (소프트) ─────────────────────────────────────────────────
  deleteCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'deleteCode', error: '인증 필요' })

    const formData = await request.formData()
    const id = (formData.get('id') as string) ?? ''
    const cascade = formData.get('cascade') === 'true'
    const admin = db()

    // cascade 삭제: 모든 하위 코드 포함 재귀 삭제
    if (cascade) {
      const toDelete: string[] = []
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        const { data: children } = await admin
          .from('product_category_codes')
          .select('id')
          .eq('parent_id', current)
          .is('deleted_at', null)
        children?.forEach(c => queue.push(c.id))
        toDelete.push(current)
      }
      for (const cid of [...toDelete].reverse()) {
        await admin.rpc('cms_delete_taxonomy_code', { p_id: cid })
      }
      return { action: 'deleteCode', success: true, orphaned: 0 }
    }

    // 하위 코드 존재 시 삭제 불가 (비cascade 단건)
    const { count: childCount } = await admin
      .from('product_category_codes')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id)
      .is('deleted_at', null)
    if (childCount && childCount > 0)
      return fail(400, { action: 'deleteCode', error: `하위 코드 ${childCount}개가 존재합니다. 하위 코드를 먼저 삭제해주세요.` })

    // 연결 상품 존재 시 superadmin만 통삭제 가능
    const linkedCount = await getLinkedProductCount(admin, id)
    if (linkedCount > 0) {
      const isSuperadmin = await checkSuperadmin(admin, session.user.id)
      if (!isSuperadmin)
        return fail(403, { action: 'deleteCode', error: '접근권한이 없습니다.' })

      // superadmin 통삭제: 연결 상품의 product_code를 NULL로 초기화 (고아 상품 발생)
      const { data: codeRow } = await admin
        .from('product_category_codes')
        .select('code, product_category')
        .eq('id', id)
        .maybeSingle()
      if (codeRow) {
        const categoryVal = codeRow.product_category ?? codeRow.code.toLowerCase()
        await admin
          .from('products')
          .update({ product_code: null })
          .eq('category', categoryVal)
          .is('deleted_at', null)
      }
    }

    const { error } = await admin.rpc('cms_delete_taxonomy_code', { p_id: id })

    if (error) return fail(500, { action: 'deleteCode', error: '삭제 실패' })
    return { action: 'deleteCode', success: true, orphaned: linkedCount }
  },

  // ── 활성 토글 ──────────────────────────────────────────────────────────
  toggleActive: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'toggleActive', error: '인증 필요' })

    const form = await request.formData()
    const id      = (form.get('id')        as string) ?? ''
    const current = form.get('is_active') === 'true'

    const { error } = await db().rpc('cms_toggle_taxonomy_active', { p_id: id, p_current: current })

    if (error) return fail(500, { action: 'toggleActive', error: '변경 실패' })
    return { action: 'toggleActive', success: true }
  },

  // ── 상품 품번 포맷 저장 (reservation_code_format 키 공용 — M3 예약코드 구현 시 분리 예정) ──
  saveFormat: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'saveFormat', error: '인증 필요' })

    const form = await request.formData()
    const prefix       = ((form.get('prefix') as string) ?? 'CS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CS'
    const date_format  = form.get('date_format') === 'YYYYMM' ? 'YYYYMM' : 'YYMM'
    const seq_digits   = Math.min(6, Math.max(2, parseInt((form.get('seq_digits') as string) ?? '3') || 3))
    const reset_monthly = form.get('reset_monthly') !== 'false'
    const suffix       = ((form.get('suffix') as string) ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)

    const value: CodeFormat = { prefix, date_format, seq_digits, reset_monthly, suffix }

    const { error } = await db()
      .from('cms_settings')
      .upsert({ key: FORMAT_KEY, value, updated_at: new Date().toISOString() })

    if (error) return fail(500, { action: 'saveFormat', error: '저장 실패' })
    return { action: 'saveFormat', success: true }
  },

  // ── 코드 이관 (superadmin 전용) ───────────────────────────────────────
  // 소스 코드에 연결된 상품 → 타겟 코드로 이관 + 품번 재발행 + QR 재생성
  transferCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'transferCode', error: '인증 필요' })

    const isSuperadmin = await checkSuperadmin(db(), session.user.id)
    if (!isSuperadmin) return fail(403, { action: 'transferCode', error: '접근권한이 없습니다.' })

    const form = await request.formData()
    const sourceId = (form.get('source_id') as string) ?? ''
    const targetId = (form.get('target_id') as string) ?? ''

    if (!sourceId || !targetId)
      return fail(400, { action: 'transferCode', error: '소스·타겟 코드 ID가 필요합니다.' })
    if (sourceId === targetId)
      return fail(400, { action: 'transferCode', error: '소스와 타겟이 같습니다.' })

    const admin = db()

    // 소스·타겟 코드 정보 조회
    const [{ data: sourceRow }, { data: targetRow }] = await Promise.all([
      admin
        .from('product_category_codes')
        .select('code, product_category')
        .eq('id', sourceId)
        .is('deleted_at', null)
        .maybeSingle(),
      admin
        .from('product_category_codes')
        .select('code, product_category')
        .eq('id', targetId)
        .is('deleted_at', null)
        .maybeSingle(),
    ])

    if (!sourceRow) return fail(400, { action: 'transferCode', error: '소스 코드를 찾을 수 없습니다.' })
    if (!targetRow) return fail(400, { action: 'transferCode', error: '타겟 코드를 찾을 수 없습니다.' })

    const sourceCat = sourceRow.product_category ?? sourceRow.code.toLowerCase()
    const targetCat = targetRow.product_category ?? targetRow.code.toLowerCase()

    // 소스 코드에 연결된 상품 조회
    const { data: products } = await admin
      .from('products')
      .select('id')
      .eq('category', sourceCat)
      .is('deleted_at', null)

    if (!products || products.length === 0)
      return fail(400, { action: 'transferCode', error: '이관할 상품이 없습니다.' })

    // 각 상품을 타겟 카테고리로 이관 + product_code NULL 초기화
    const productIds = (products as { id: string }[]).map((p) => p.id)

    await admin
      .from('products')
      .update({ category: targetCat, product_code: null })
      .in('id', productIds)
      .is('deleted_at', null)

    // 각 상품 품번 재발행 (generate_product_code는 product_code를 항상 덮어씀)
    for (const id of productIds) {
      await admin.rpc('generate_product_code', {
        p_product_id: id,
        p_category: targetCat,
      })
    }

    // QR payload 재생성 (경로 기반 — QR은 상품 ID로 고정)
    const qrBase = 'https://crazyshot.kr/qr/product/'
    await admin
      .from('products')
      .update({ qr_payload: null })
      .in('id', productIds)
      .is('deleted_at', null)
    for (const id of productIds) {
      await admin
        .from('products')
        .update({ qr_payload: qrBase + id })
        .eq('id', id)
    }

    // taxonomy_map에서 소스 매핑 삭제 (타겟 매핑은 이미 존재하거나 없어도 무방)
    await admin
      .from('category_taxonomy_map')
      .delete()
      .eq('product_category', sourceCat)

    return { action: 'transferCode', success: true, transferred: productIds.length }
  },

  // ── 대분류별 코드 구조(included_levels) 저장 ─────────────────────────
  updateCodeRule: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'updateCodeRule', error: '인증 필요' })

    const form = await request.formData()
    const id             = (form.get('id') as string) ?? ''
    const levelsRaw      = (form.get('included_levels') as string) ?? ''
    const included_levels: string[] = levelsRaw
      ? levelsRaw.split(',').map(l => l.trim()).filter(l => ['L0','L1','L2','seq'].includes(l))
      : []

    if (!id) return fail(400, { action: 'updateCodeRule', error: 'ID가 필요합니다.' })

    // 기존 code_rule을 읽어 merged로 저장 (다른 필드 보존)
    const admin = db()
    const { data: existing } = await admin
      .from('product_category_codes')
      .select('code_rule')
      .eq('id', id)
      .maybeSingle()

    const currentRule = (existing as { code_rule: Record<string, unknown> | null } | null)?.code_rule ?? {}
    const updatedRule = { ...currentRule, included_levels }

    const { error } = await admin
      .from('product_category_codes')
      .update({ code_rule: updatedRule })
      .eq('id', id)
      .is('deleted_at', null)

    if (error) return fail(500, { action: 'updateCodeRule', error: '저장 실패: ' + error.message })
    return { action: 'updateCodeRule', success: true }
  },

  // ── 상품 카테고리 매핑 저장 ───────────────────────────────────────────
  saveMapping: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'saveMapping', error: '인증 필요' })

    const form     = await request.formData()
    const category = (form.get('product_category') as string) ?? ''
    const code_id  = (form.get('taxonomy_code_id') as string) ?? ''

    const admin = db()

    if (!code_id) {
      // 매핑 해제
      await admin.from('category_taxonomy_map').delete().eq('product_category', category)
      return { action: 'saveMapping', success: true }
    }

    await admin.from('category_taxonomy_map').upsert(
      { product_category: category, taxonomy_code_id: code_id, priority: 1, is_auto: false },
      { onConflict: 'product_category,taxonomy_code_id' }
    )
    return { action: 'saveMapping', success: true }
  },

  // ── Prefix 목록 저장 ───────────────────────────────────────────────────
  savePrefixCodes: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'savePrefixCodes', error: '인증 필요' })

    const form  = await request.formData()
    const raw   = (form.get('prefix_codes') as string) ?? '[]'
    let codes: string[]
    try {
      codes = JSON.parse(raw)
      if (!Array.isArray(codes)) throw new Error()
      codes = codes
        .map((c: string) => c.trim().toUpperCase())
        .filter((c: string) => /^[A-Za-z0-9]{1,10}$/.test(c))
    } catch {
      return fail(400, { action: 'savePrefixCodes', error: '잘못된 prefix 형식입니다.' })
    }
    if (codes.length === 0) codes = ['CS']

    const admin = db()
    await admin.from('cms_settings').upsert(
      { key: PREFIX_KEY, value: codes },
      { onConflict: 'key' }
    )
    return { action: 'savePrefixCodes', success: true }
  },

  // ── 매핑그룹 추가 ─────────────────────────────────────────────────────
  addGroup: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'addGroup', error: '인증 필요' })

    const form = await request.formData()
    const name        = ((form.get('name')        as string) ?? '').trim()
    const description = ((form.get('description') as string) ?? '').trim() || null
    const kwRaw       = ((form.get('keywords')    as string) ?? '').trim()
    const keywords    = kwRaw ? kwRaw.split(',').map(k => k.trim()).filter(Boolean) : []
    const sort_order  = parseInt((form.get('sort_order') as string) ?? '99') || 99

    if (!name) return fail(400, { action: 'addGroup', error: '그룹명은 필수입니다.' })

    const { data, error } = await db()
      .from('code_mapping_groups')
      .insert({ name, description, keywords, sort_order })
      .select('id')
      .single()

    if (error) return fail(500, { action: 'addGroup', error: '추가 실패: ' + error.message })
    return { action: 'addGroup', success: true, id: (data as { id: string }).id }
  },

  // ── 매핑그룹 편집 ─────────────────────────────────────────────────────
  editGroup: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'editGroup', error: '인증 필요' })

    const form = await request.formData()
    const id          = (form.get('id')           as string) ?? ''
    const name        = ((form.get('name')        as string) ?? '').trim()
    const description = ((form.get('description') as string) ?? '').trim() || null
    const kwRaw       = ((form.get('keywords')    as string) ?? '').trim()
    const keywords    = kwRaw ? kwRaw.split(',').map(k => k.trim()).filter(Boolean) : []
    const sort_order  = parseInt((form.get('sort_order') as string) ?? '99') || 99

    if (!id || !name) return fail(400, { action: 'editGroup', error: '그룹명은 필수입니다.' })

    const { error } = await db()
      .from('code_mapping_groups')
      .update({ name, description, keywords, sort_order, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return fail(500, { action: 'editGroup', error: '수정 실패: ' + error.message })
    return { action: 'editGroup', success: true }
  },

  // ── 매핑그룹 삭제 ─────────────────────────────────────────────────────
  deleteGroup: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'deleteGroup', error: '인증 필요' })

    const form = await request.formData()
    const id = (form.get('id') as string) ?? ''
    if (!id) return fail(400, { action: 'deleteGroup', error: 'ID가 필요합니다.' })

    const { error } = await db()
      .from('code_mapping_groups')
      .delete()
      .eq('id', id)

    if (error) return fail(500, { action: 'deleteGroup', error: '삭제 실패: ' + error.message })
    return { action: 'deleteGroup', success: true }
  },

  // ── 매핑그룹 활성 토글 ────────────────────────────────────────────────
  toggleGroupActive: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'toggleGroupActive', error: '인증 필요' })

    const form = await request.formData()
    const id      = (form.get('id')        as string) ?? ''
    const current = form.get('is_active') === 'true'

    const { error } = await db()
      .from('code_mapping_groups')
      .update({ is_active: !current, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return fail(500, { action: 'toggleGroupActive', error: '변경 실패' })
    return { action: 'toggleGroupActive', success: true }
  },

  // ── 그룹 코드 추가 ────────────────────────────────────────────────────
  addGroupItem: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'addGroupItem', error: '인증 필요' })

    const form = await request.formData()
    const group_id         = (form.get('group_id')         as string) ?? ''
    const taxonomy_code_id = (form.get('taxonomy_code_id') as string) ?? ''
    const combo_row_id     = ((form.get('combo_row_id')    as string) ?? '').trim()

    if (!group_id || !taxonomy_code_id)
      return fail(400, { action: 'addGroupItem', error: 'group_id, taxonomy_code_id가 필요합니다.' })

    // combo_row_id 제공 시 해당 조합 행에 추가, 미제공 시 DB 기본값(gen_random_uuid) 사용
    const payload: { group_id: string; taxonomy_code_id: string; combo_row_id: string } = {
      group_id,
      taxonomy_code_id,
      combo_row_id: combo_row_id || globalThis.crypto.randomUUID(),
    }

    const { error } = await db()
      .from('code_mapping_items')
      .insert(payload)

    if (error) {
      if (error.code === '23505') return fail(400, { action: 'addGroupItem', error: '이 조합에 이미 추가된 코드입니다.' })
      return fail(500, { action: 'addGroupItem', error: '추가 실패: ' + error.message })
    }
    return { action: 'addGroupItem', success: true }
  },

  // ── 그룹 코드 설정 업데이트 (조합 행 단위) ──────────────────────────
  updateGroupItemSettings: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'updateGroupItemSettings', error: '인증 필요' })

    const form = await request.formData()
    const combo_row_id = ((form.get('combo_row_id') as string) ?? '').trim()
    const group_id     = ((form.get('group_id')     as string) ?? '').trim()
    const date_option  = (form.get('date_option')   as string) ?? 'ym'
    const max_seq_raw  = parseInt((form.get('max_sequence') as string) ?? '999')
    const combo_name_raw = (form.get('combo_name') as string | null)
    const combo_name = combo_name_raw !== null ? combo_name_raw.trim().slice(0, 30) || null : undefined
    const kw_raw = (form.get('combo_keywords') as string | null)
    const combo_keywords = kw_raw !== null
      ? kw_raw.split(',').map(k => k.trim()).filter(k => k.length > 0).slice(0, 10)
      : undefined

    if (!combo_row_id || !group_id)
      return fail(400, { action: 'updateGroupItemSettings', error: 'combo_row_id, group_id가 필요합니다.' })
    if (!['none', 'ym', 'ymd'].includes(date_option))
      return fail(400, { action: 'updateGroupItemSettings', error: '잘못된 date_option 값입니다.' })
    const max_sequence = (max_seq_raw >= 1 && max_seq_raw <= 99999) ? max_seq_raw : 999

    // 동일 combo_row_id를 가진 모든 아이템에 일괄 적용
    const updatePayload: Record<string, unknown> = { date_option, max_sequence }
    if (combo_name !== undefined) updatePayload.combo_name = combo_name
    if (combo_keywords !== undefined) updatePayload.combo_keywords = combo_keywords

    const { error } = await db()
      .from('code_mapping_items')
      .update(updatePayload)
      .eq('combo_row_id', combo_row_id)
      .eq('group_id', group_id)

    if (error) return fail(500, { action: 'updateGroupItemSettings', error: '저장 실패: ' + error.message })
    return { action: 'updateGroupItemSettings', success: true }
  },

  // ── 조합 행 전체 삭제 ─────────────────────────────────────────────────
  removeGroupCombo: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'removeGroupCombo', error: '인증 필요' })

    const form = await request.formData()
    const combo_row_id = ((form.get('combo_row_id') as string) ?? '').trim()
    const group_id     = ((form.get('group_id')     as string) ?? '').trim()

    if (!combo_row_id || !group_id)
      return fail(400, { action: 'removeGroupCombo', error: 'combo_row_id, group_id가 필요합니다.' })

    const { error } = await db()
      .from('code_mapping_items')
      .delete()
      .eq('combo_row_id', combo_row_id)
      .eq('group_id', group_id)

    if (error) return fail(500, { action: 'removeGroupCombo', error: '삭제 실패: ' + error.message })
    return { action: 'removeGroupCombo', success: true }
  },

  // ── 그룹 코드 제거 (개별 코드) ───────────────────────────────────────
  removeGroupItem: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'removeGroupItem', error: '인증 필요' })

    const form = await request.formData()
    const group_id         = (form.get('group_id')         as string) ?? ''
    const taxonomy_code_id = (form.get('taxonomy_code_id') as string) ?? ''

    if (!group_id || !taxonomy_code_id)
      return fail(400, { action: 'removeGroupItem', error: 'group_id, taxonomy_code_id가 필요합니다.' })

    const { error } = await db()
      .from('code_mapping_items')
      .delete()
      .eq('group_id', group_id)
      .eq('taxonomy_code_id', taxonomy_code_id)

    if (error) return fail(500, { action: 'removeGroupItem', error: '제거 실패: ' + error.message })
    return { action: 'removeGroupItem', success: true }
  },

  // ── 조합 내 단일 코드 제거 (item.id 기준) ────────────────────────────
  removeComboItem: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'removeComboItem', error: '인증 필요' })

    const form = await request.formData()
    const id = ((form.get('id') as string) ?? '').trim()

    if (!id) return fail(400, { action: 'removeComboItem', error: 'id가 필요합니다.' })

    const { error } = await db()
      .from('code_mapping_items')
      .delete()
      .eq('id', id)

    if (error) return fail(500, { action: 'removeComboItem', error: '제거 실패: ' + error.message })
    return { action: 'removeComboItem', success: true }
  },
}
