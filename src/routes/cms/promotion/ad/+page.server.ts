import { fail, redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import { isBadgeSvgUrl } from '$lib/utils/badgeSvgUrl'
import type { BadgeCouponOption, BadgeProductName, BadgeRule, BadgeTemplate } from '$lib/types/badge'
import type { PageServerLoad, Actions } from './$types'

export type Banner = {
  id: string
  slot_key: string
  title: string | null
  image_url: string
  link_url: string | null
  device_type: string
  sort_order: number
  is_active: boolean
  valid_from: string | null
  valid_until: string | null
  created_at: string
}

// 슬롯 키 목록 (참고용 — 실제 상수는 +page.svelte에서 관리)
// hero_pc | hero_mobile | mid_banner_pc | mid_banner_mobile

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const tab = url.searchParams.get('tab') ?? 'dashboard'

  // banners 테이블은 migration #45에서 신설 — 타입 생성 전 캐스트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as unknown as any
  const { data: banners } = await db
    .from('banners')
    .select('*')
    .is('deleted_at', null)
    .order('slot_key')
    .order('sort_order')

  // 배지 탭일 때만 배지 데이터를 읽는다(배지 표는 서버 전용 — 매니저 확인을 통과한 뒤 서비스 롤로 조회)
  const badge = tab === 'badge' || tab === 'badge-settings' ? await loadBadgeData() : EMPTY_BADGE_DATA

  return { tab, banners: (banners ?? []) as Banner[], badge }
}

// ─── 배지 탭 ─────────────────────────────────────────────────────────────────
interface BadgeLoadData {
  rules: BadgeRule[]
  templates: BadgeTemplate[]
  coupons: BadgeCouponOption[]
  productNames: BadgeProductName[]
}
const EMPTY_BADGE_DATA: BadgeLoadData = { rules: [], templates: [], coupons: [], productNames: [] }

async function loadBadgeData(): Promise<BadgeLoadData> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return EMPTY_BADGE_DATA
  const admin = createClient(getSupabaseUrl(), key)

  const [tpl, rul, tgt, cpn] = await Promise.all([
    admin
      .from('badge_templates')
      .select('id, kind, name, svg_url, text, bg_color, text_color, is_active')
      .is('deleted_at', null)
      .order('sort_order')
      .order('created_at'),
    admin
      .from('product_badges')
      .select('id, name, template_id, coupon_id, priority, valid_from, valid_until, is_active')
      .is('deleted_at', null)
      .order('priority')
      .order('created_at'),
    admin.from('product_badge_targets').select('badge_id, target_type, product_id, category_value'),
    admin
      .from('coupons')
      .select('id, code, display_name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(2000),
  ])
  if (tpl.error || rul.error || tgt.error) {
    console.error('[badge] load failed', tpl.error?.message ?? rul.error?.message ?? tgt.error?.message)
    return EMPTY_BADGE_DATA
  }

  const targets = (tgt.data ?? []) as Array<{ badge_id: string; target_type: string; product_id: string | null; category_value: string | null }>
  const rules: BadgeRule[] = ((rul.data ?? []) as Array<Omit<BadgeRule, 'product_ids' | 'categories'>>).map((r) => ({
    ...r,
    product_ids: targets.filter((t) => t.badge_id === r.id && t.target_type === 'product' && t.product_id).map((t) => t.product_id as string),
    categories: targets.filter((t) => t.badge_id === r.id && t.target_type === 'category' && t.category_value).map((t) => t.category_value as string),
  }))

  const productIds = [...new Set(rules.flatMap((r) => r.product_ids))]
  let productNames: BadgeProductName[] = []
  if (productIds.length > 0) {
    const { data: prods } = await admin.from('products').select('id, name').in('id', productIds)
    productNames = ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }))
  }

  const coupons: BadgeCouponOption[] = ((cpn.data ?? []) as Array<{ id: string; code: string | null; display_name: string | null }>).map((c) => ({
    id: c.id,
    label: c.display_name?.trim() || c.code || '이름 없는 쿠폰',
  }))

  return { rules, templates: (tpl.data ?? []) as BadgeTemplate[], coupons, productNames }
}

type RpcResult = { ok: boolean; error?: string } | null

/** 배지 폼 액션 공통 — 로그인·메뉴 권한·매니저 이상 확인. 통과하면 null */
async function badgeGuard(locals: App.Locals) {
  const denied = await requireMenuAccessAction(locals, 'promotion.ad')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return fail(401, { error: '인증 필요' })
  const role = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(role ?? '')) return fail(403, { error: '권한 없음' })
  return null
}

const BADGE_ERRORS: Record<string, string> = {
  ACCESS_DENIED: '권한이 없어요',
  TEMPLATE_IN_USE: '이 배지를 쓰는 노출이 있어 삭제할 수 없어요',
  TEMPLATE_NOT_FOUND: '배지를 찾을 수 없어요',
  BADGE_NOT_FOUND: '배지 노출을 찾을 수 없어요',
}

interface BadgeRpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

function asBadgeRpcClient(client: unknown): BadgeRpcClient {
  if (!client || typeof (client as { rpc?: unknown }).rpc !== 'function') throw new Error('rpc client unavailable')
  return client as BadgeRpcClient
}

async function callBadgeRpc(locals: App.Locals, fn: string, args: Record<string, unknown>) {
  const db = asBadgeRpcClient(locals.supabase)
  const { data, error } = await db.rpc(fn, args)
  if (error) return fail(400, { error: '처리에 실패했어요' })
  const result = data as RpcResult
  if (!result?.ok) return fail(400, { error: BADGE_ERRORS[result?.error ?? ''] ?? result?.error ?? '처리에 실패했어요' })
  return { ok: true as const, id: (data as { id?: string }).id }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asUuidOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}
const asTimestampOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim()
  return s !== '' && !Number.isNaN(Date.parse(s)) ? s : null
}

export const actions: Actions = {
  saveBadgeTemplate: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const f = await request.formData()
    const svgUrl = String(f.get('svg_url') ?? '').trim()
    // 이미지형이면 배지 버킷에 업로드된 SVG 주소만 허용(외부 주소 삽입 차단 — DB 함수도 같은 규칙)
    if (String(f.get('kind') ?? '') === 'image' && !isBadgeSvgUrl(svgUrl)) {
      return fail(400, { error: 'SVG 이미지는 가져오기로만 등록할 수 있어요' })
    }
    return callBadgeRpc(locals, 'cms_save_badge_template', {
      p_id: asUuidOrNull(f.get('id')),
      p_kind: String(f.get('kind') ?? ''),
      p_name: String(f.get('name') ?? ''),
      p_svg_url: String(f.get('svg_url') ?? '') || null,
      p_text: String(f.get('text') ?? '') || null,
      p_bg_color: String(f.get('bg_color') ?? '') || null,
      p_text_color: String(f.get('text_color') ?? '#FFFFFF'),
      p_is_active: String(f.get('is_active') ?? 'true') !== 'false',
    })
  },

  deleteBadgeTemplate: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const id = asUuidOrNull((await request.formData()).get('id'))
    if (!id) return fail(400, { error: '잘못된 요청이에요' })
    return callBadgeRpc(locals, 'cms_delete_badge_template', { p_id: id })
  },

  saveProductBadge: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const f = await request.formData()
    const name = String(f.get('name') ?? '').trim()
    if (name === '' || name.length > 40) return fail(400, { error: '명칭은 1~40자로 입력해 주세요' })
    const templateId = asUuidOrNull(f.get('template_id'))
    if (!templateId) return fail(400, { error: '배지 템플릿을 선택해 주세요' })
    const productIds = f.getAll('product_ids').map((v) => asUuidOrNull(v)).filter((v): v is string => v !== null)
    const categories = f.getAll('categories').map((v) => String(v).trim()).filter((v) => v !== '')
    return callBadgeRpc(locals, 'cms_save_product_badge', {
      p_id: asUuidOrNull(f.get('id')),
      p_name: name,
      p_template_id: templateId,
      p_coupon_id: asUuidOrNull(f.get('coupon_id')),
      p_valid_from: asTimestampOrNull(f.get('valid_from')),
      p_valid_until: asTimestampOrNull(f.get('valid_until')),
      p_is_active: String(f.get('is_active') ?? 'true') !== 'false',
      p_product_ids: productIds,
      p_categories: categories,
    })
  },

  toggleProductBadge: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const id = asUuidOrNull((await request.formData()).get('id'))
    if (!id) return fail(400, { error: '잘못된 요청이에요' })
    return callBadgeRpc(locals, 'cms_toggle_product_badge', { p_id: id })
  },

  deleteProductBadge: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const id = asUuidOrNull((await request.formData()).get('id'))
    if (!id) return fail(400, { error: '잘못된 요청이에요' })
    return callBadgeRpc(locals, 'cms_delete_product_badge', { p_id: id })
  },

  reorderProductBadges: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const ids = (await request.formData()).getAll('ids').map((v) => asUuidOrNull(v)).filter((v): v is string => v !== null)
    if (ids.length === 0) return fail(400, { error: '잘못된 요청이에요' })
    return callBadgeRpc(locals, 'cms_reorder_product_badges', { p_ids: ids })
  },

  reorderBadgeTemplates: async ({ request, locals }) => {
    const denied = await badgeGuard(locals)
    if (denied) return denied
    const ids = (await request.formData()).getAll('ids').map((v) => asUuidOrNull(v)).filter((v): v is string => v !== null)
    if (ids.length === 0) return fail(400, { error: '잘못된 요청이에요' })
    return callBadgeRpc(locals, 'cms_reorder_badge_templates', { p_ids: ids })
  },

  createBanner: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return { ok: false, error: '인증 필요' }
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const slot_key    = String(form.get('slot_key') ?? '')
    const title       = String(form.get('title') ?? '').trim() || null
    const image_url   = String(form.get('image_url') ?? '').trim()
    const link_url    = String(form.get('link_url') ?? '').trim() || null
    const device_type = String(form.get('device_type') ?? 'all')
    const sort_order  = Number(form.get('sort_order') ?? 0)
    const valid_from  = String(form.get('valid_from') ?? '') || null
    const valid_until = String(form.get('valid_until') ?? '') || null

    if (!slot_key || !image_url) return { ok: false, error: '슬롯과 이미지 URL은 필수입니다.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_create_banner', {
      p_slot_key: slot_key,
      p_title: title,
      p_image_url: image_url,
      p_link_url: link_url,
      p_device_type: device_type,
      p_sort_order: sort_order,
      p_valid_from: valid_from,
      p_valid_until: valid_until,
    })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '생성 실패' }
    return { ok: true }
  },

  toggleBanner: async ({ request, locals }) => {
    const { session: sess2 } = await locals.safeGetSession()
    if (!sess2) return { ok: false, error: '인증 필요' }
    const cmsRole2 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole2 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_toggle_banner', { p_id: id })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '처리 실패' }
    return { ok: true }
  },

  deleteBanner: async ({ request, locals }) => {
    const { session: sess3 } = await locals.safeGetSession()
    if (!sess3) return { ok: false, error: '인증 필요' }
    const cmsRole3 = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole3 ?? '')) return { ok: false, error: '권한 없음' }
    const form = await request.formData()
    const id = String(form.get('id'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_delete_banner', { p_id: id })

    if (error) return { ok: false, error: error.message }
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return { ok: false, error: result?.error ?? '삭제 실패' }
    return { ok: true }
  },
}
