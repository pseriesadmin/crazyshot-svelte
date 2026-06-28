import { redirect, fail } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad, Actions } from './$types'

const FORMAT_KEY = 'reservation_code_format'

function db() {
  return createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY ?? '')
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
  created_at: string
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
    { data: productCounts },
    { data: mappings },
  ] = await Promise.all([
    admin
      .from('product_category_codes')
      .select('id, code, name, parent_id, depth, path_codes, product_category, is_active, sort_order, description, code_rule, created_at')
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
      .from('products')
      .select('category')
      .is('deleted_at', null),
    admin
      .from('category_taxonomy_map')
      .select('id, product_category, taxonomy_code_id, priority, is_auto'),
  ])

  const productCountMap: Record<string, number> = {}
  for (const p of productCounts ?? []) {
    const cat = (p as { category: string }).category
    productCountMap[cat] = (productCountMap[cat] ?? 0) + 1
  }

  return {
    codes: (codes ?? []) as TaxonomyCode[],
    codeFormat: ((fmtRow as { value?: CodeFormat } | null)?.value ?? DEFAULT_FORMAT) as CodeFormat,
    productCountMap,
    mappings: (mappings ?? []) as TaxonomyMapping[],
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

    if (!code || !name)
      return fail(400, { action: 'addCode', error: '코드와 코드명은 필수입니다.' })
    if (!/^[A-Z0-9][A-Z0-9-]{0,14}$/.test(code))
      return fail(400, { action: 'addCode', error: '코드: 영문 대문자·숫자·하이픈, 첫 글자는 영문/숫자, 최대 15자.' })

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

    const { error } = await admin.rpc('cms_add_taxonomy_code', {
      p_code: code,
      p_name: name,
      p_parent_id: parent_id,
      p_depth: depth,
      p_path_codes: path_codes,
      p_product_category: product_category,
      p_description: description,
      p_sort_order: sort_order,
    })
    if (error) return fail(500, { action: 'addCode', error: '추가에 실패했습니다: ' + error.message })
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

    if (!name) return fail(400, { action: 'editCode', error: '코드명은 필수입니다.' })

    const { error } = await db().rpc('cms_edit_taxonomy_code', {
      p_id: id,
      p_name: name,
      p_description: description,
      p_product_category: product_category,
      p_sort_order: sort_order,
    })

    if (error) return fail(500, { action: 'editCode', error: '수정에 실패했습니다.' })
    return { action: 'editCode', success: true }
  },

  // ── 코드 삭제 (소프트) ─────────────────────────────────────────────────
  deleteCode: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { action: 'deleteCode', error: '인증 필요' })

    const id = ((await request.formData()).get('id') as string) ?? ''
    const admin = db()

    // 하위 코드 존재 시 삭제 불가
    const { count } = await admin
      .from('product_category_codes')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id)
      .is('deleted_at', null)
    if (count && count > 0)
      return fail(400, { action: 'deleteCode', error: `하위 코드 ${count}개가 존재합니다. 하위 코드를 먼저 삭제해주세요.` })

    const { error } = await admin.rpc('cms_delete_taxonomy_code', { p_id: id })

    if (error) return fail(500, { action: 'deleteCode', error: '삭제 실패' })
    return { action: 'deleteCode', success: true }
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

  // ── 예약코드 형식 저장 ────────────────────────────────────────────────
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
}
