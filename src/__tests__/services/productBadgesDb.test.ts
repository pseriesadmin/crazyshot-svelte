import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * Migration #828·#829·#830·#831·#832 라이브 통합시험 (Stage DB — ezyvffjvuwmtuhpxdjrw)
 *  - 비로그인은 CMS 쓰기 함수를 실행할 수 없고 표를 직접 읽을 수 없다
 *  - 로그인했지만 CMS 직원이 아닌 사용자는 쓰기 함수에서 ACCESS_DENIED
 *  - get_product_badges 는 비로그인도 부를 수 있고, 활성·기간·삭제 필터와 정렬이 resolveBadges 규칙과 같다
 *  - 표시용 필드 외(쿠폰·대상 목록)는 내보내지 않는다
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

const cleanups: Array<() => Promise<void>> = []
afterAll(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => undefined)
})

const isPermissionError = (err: { code?: string; message?: string } | null): boolean =>
  !!err && (err.code === '42501' || /permission denied|row-level security/i.test(err.message ?? ''))

const HOUR = 3600 * 1000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

describe('#828 상품 배지 — 권한', () => {
  it('비로그인은 CMS 쓰기 함수 6개를 실행할 수 없다(권한 오류)', async () => {
    const calls = await Promise.all([
      anon.rpc('cms_save_badge_template', { p_id: null, p_kind: 'textbar', p_name: 'x', p_svg_url: null, p_text: 'x', p_bg_color: '#3B2F8A', p_text_color: '#FFFFFF', p_is_active: true }),
      anon.rpc('cms_delete_badge_template', { p_id: '00000000-0000-0000-0000-000000000000' }),
      anon.rpc('cms_save_product_badge', { p_id: null, p_name: 'x', p_template_ids: ['00000000-0000-0000-0000-000000000000'], p_coupon_id: null, p_valid_from: null, p_valid_until: null, p_is_active: true, p_product_ids: [], p_categories: ['x'] }),
      anon.rpc('cms_toggle_product_badge', { p_id: '00000000-0000-0000-0000-000000000000' }),
      anon.rpc('cms_delete_product_badge', { p_id: '00000000-0000-0000-0000-000000000000' }),
      anon.rpc('cms_reorder_product_badges', { p_ids: ['00000000-0000-0000-0000-000000000000'] }),
    ])
    for (const r of calls) expect(isPermissionError(r.error), `${r.error?.code} ${r.error?.message}`).toBe(true)
  })

  it('비로그인은 장바구니용 쿠폰 id 함수도 실행할 수 없다', async () => {
    const r = await anon.rpc('get_badge_coupon_ids', { p_product_ids: ['00000000-0000-0000-0000-000000000000'] })
    expect(isPermissionError(r.error), `${r.error?.code} ${r.error?.message}`).toBe(true)
  })

  it.each(['badge_templates', 'product_badges', 'product_badge_targets'])('%s — 비로그인은 읽기·쓰기 모두 권한 오류', async (table) => {
    const sel = await anon.from(table).select('*').limit(1)
    expect(isPermissionError(sel.error), `${table} select: ${sel.error?.code} ${sel.error?.message}`).toBe(true)
    const ins = await anon.from(table).insert({} as never)
    expect(isPermissionError(ins.error), `${table} insert: ${ins.error?.code} ${ins.error?.message}`).toBe(true)
  })

  it('로그인했지만 CMS 직원이 아니면 쓰기 함수는 ACCESS_DENIED', async () => {
    const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { data: signed, error: signErr } = await client.auth.signInAnonymously()
    if (signErr || !signed.user) return // 익명 로그인이 꺼진 환경이면 건너뜀
    cleanups.push(async () => { await admin.auth.admin.deleteUser(signed.user!.id) })
    const r = await client.rpc('cms_save_badge_template', { p_id: null, p_kind: 'textbar', p_name: 'x', p_svg_url: null, p_text: 'x', p_bg_color: '#3B2F8A', p_text_color: '#FFFFFF', p_is_active: true })
    expect(r.error).toBeNull()
    expect((r.data as { ok: boolean; error?: string }).ok).toBe(false)
    expect((r.data as { error?: string }).error).toBe('ACCESS_DENIED')
  })
})

describe('#828 get_product_badges — 노출 판정', () => {
  it('활성·기간·삭제 필터와 정렬(우선순위→시작일 NULL 먼저)이 규칙대로 동작하고 내부 필드는 나가지 않는다', async () => {
    const { data: prod } = await admin
      .from('products')
      .select('id')
      .is('parent_product_id', null)
      .is('deleted_at', null)
      .eq('is_active', true)
      .limit(1)
      .single()
    expect(prod?.id).toBeTruthy()
    const productId = prod!.id as string

    const { data: tpl, error: tplErr } = await admin
      .from('badge_templates')
      .insert({ kind: 'textbar', name: 'DB시험', text: 'TEST', bg_color: '#3B2F8A', text_color: '#FFFFFF' })
      .select('id')
      .single()
    expect(tplErr).toBeNull()
    const templateId = tpl!.id as string
    cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', templateId) })

    const mk = async (label: string, over: Record<string, unknown>) => {
      const { data, error } = await admin
        .from('product_badges')
        .insert({ name: 'DB시험규칙', template_id: templateId, priority: 10, ...over })
        .select('id')
        .single()
      expect(error, label).toBeNull()
      const id = data!.id as string
      cleanups.push(async () => { await admin.from('product_badges').delete().eq('id', id) })
      await admin.from('product_badge_targets').insert({ badge_id: id, target_type: 'product', product_id: productId })
      return id
    }

    const okLate = await mk('ok-late', { priority: 2, valid_from: iso(-2 * HOUR) })
    const okNullStart = await mk('ok-null-start', { priority: 2, valid_from: null })
    const okFirst = await mk('ok-first', { priority: 1 })
    await mk('expired', { valid_until: iso(-HOUR) })
    await mk('future', { valid_from: iso(HOUR) })
    await mk('inactive', { is_active: false })
    await mk('deleted', { deleted_at: new Date().toISOString() })

    const { data, error } = await anon.rpc('get_product_badges', { p_product_ids: [productId] })
    expect(error).toBeNull()
    const rows = data as Array<Record<string, unknown>>
    const mine = rows.filter((r) => [okLate, okNullStart, okFirst].includes(r.badge_id as string))
    // 우선순위 오름차순 → 같은 우선순위에서는 시작일이 없는 것(NULL)이 먼저
    expect(mine.map((r) => r.badge_id)).toEqual([okFirst, okNullStart, okLate])
    // 만료·미래·비활성·삭제는 나오지 않는다
    expect(rows.filter((r) => r.product_id === productId && r.text === 'TEST').length).toBe(3)
    // 표시용 필드만 — 쿠폰·대상 목록·기간은 내보내지 않는다
    for (const r of mine) {
      expect(Object.keys(r).sort()).toEqual(['badge_id', 'bg_color', 'kind', 'priority', 'product_id', 'svg_url', 'template_id', 'text', 'text_color'])
    }
  })

  it('목록이 비어 있거나 없는 상품이면 빈 배열', async () => {
    const r = await anon.rpc('get_product_badges', { p_product_ids: [] })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([])
    const r2 = await anon.rpc('get_product_badges', { p_product_ids: ['00000000-0000-0000-0000-000000000000'] })
    expect(r2.data).toEqual([])
  })
})

describe('#828·#829 노출 대상 제한과 장바구니 쿠폰 id', () => {
  async function mkRule(productId: string, couponId: string | null = null) {
    const { data: tpl } = await admin
      .from('badge_templates')
      .insert({ kind: 'textbar', name: 'DB시험2', text: 'T2', bg_color: '#3B2F8A', text_color: '#FFFFFF' })
      .select('id')
      .single()
    const templateId = tpl!.id as string
    cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', templateId) })
    const { data: rule, error } = await admin
      .from('product_badges')
      .insert({ name: 'DB시험규칙2', template_id: templateId, coupon_id: couponId })
      .select('id')
      .single()
    expect(error).toBeNull()
    const ruleId = rule!.id as string
    cleanups.push(async () => { await admin.from('product_badges').delete().eq('id', ruleId) })
    await admin.from('product_badge_targets').insert({ badge_id: ruleId, target_type: 'product', product_id: productId })
    return ruleId
  }

  it('자식(재고단위)·비노출 상품에는 배지가 나가지 않는다', async () => {
    const { data: child } = await admin.from('products').select('id').not('parent_product_id', 'is', null).is('deleted_at', null).limit(1).maybeSingle()
    const { data: hidden } = await admin.from('products').select('id').is('parent_product_id', null).is('deleted_at', null).eq('is_active', false).limit(1).maybeSingle()
    for (const row of [child, hidden]) {
      if (!row) continue
      await mkRule(row.id as string)
      const r = await anon.rpc('get_product_badges', { p_product_ids: [row.id] })
      expect(r.error).toBeNull()
      expect((r.data as Array<{ text: string }>).filter((x) => x.text === 'T2')).toHaveLength(0)
    }
  })

  it('장바구니 쿠폰 id 는 호출자가 보유한 쿠폰만 돌려준다(보유자 양성·비보유자 빈 목록)', async () => {
    const { data: prod } = await admin.from('products').select('id').is('parent_product_id', null).is('deleted_at', null).eq('is_active', true).limit(1).single()
    const { data: coupon } = await admin.from('coupons').select('id').eq('is_active', true).is('deleted_at', null).limit(1).single()
    const productId = prod!.id as string
    const couponId = coupon!.id as string
    await mkRule(productId, couponId)

    const owner = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const stranger = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const [a, b] = await Promise.all([owner.auth.signInAnonymously(), stranger.auth.signInAnonymously()])
    if (a.error || b.error || !a.data.user || !b.data.user) { console.warn('[SKIP] 익명 로그인 불가 — 보유 쿠폰 시험 건너뜀'); return } // 익명 로그인이 꺼진 환경
    cleanups.push(async () => { await admin.auth.admin.deleteUser(a.data.user!.id); await admin.auth.admin.deleteUser(b.data.user!.id) })
    const { error: grantErr } = await admin.from('user_coupons').insert({ user_id: a.data.user.id, coupon_id: couponId })
    if (grantErr) { console.warn('[SKIP] 쿠폰 지급 불가 — 보유 쿠폰 시험 건너뜀:', grantErr.message); return } // 쿠폰 발급 제약 환경
    cleanups.push(async () => { await admin.from('user_coupons').delete().eq('user_id', a.data.user!.id) })

    const mine = await owner.rpc('get_badge_coupon_ids', { p_product_ids: [productId] })
    expect(mine.error).toBeNull()
    expect(mine.data).toContain(couponId)
    const theirs = await stranger.rpc('get_badge_coupon_ids', { p_product_ids: [productId] })
    expect(theirs.error).toBeNull()
    expect(theirs.data).toEqual([])
  })
})

describe('#830 배지목록 다중 배지 — 개수 제한 없이 선택 순서대로 펼쳐진다', () => {
  it('template_ids 여러 개 → 같은 배지목록이 배지타입별로 선택 순서대로 나가고, 비활성·삭제 배지타입은 빠진다', async () => {
    const { data: prod } = await admin.from('products').select('id').is('parent_product_id', null).is('deleted_at', null).eq('is_active', true).limit(1).maybeSingle()
    if (!prod) return
    const productId = prod.id as string

    const mkTpl = async (text: string, over: Record<string, unknown> = {}) => {
      const { data, error } = await admin
        .from('badge_templates')
        .insert({ kind: 'textbar', name: `DB다중${text}`, text, bg_color: '#3B2F8A', text_color: '#FFFFFF', ...over })
        .select('id')
        .single()
      expect(error, text).toBeNull()
      const id = data!.id as string
      cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', id) })
      return id
    }
    // 4개 이상 — 예전 3개 상한이 없어졌는지 함께 본다
    const t1 = await mkTpl('M1')
    const t2 = await mkTpl('M2')
    const t3 = await mkTpl('M3')
    const t4 = await mkTpl('M4')
    const tOff = await mkTpl('MOFF', { is_active: false })

    const { data: rule, error } = await admin
      .from('product_badges')
      .insert({ name: 'DB다중규칙', template_id: t3, template_ids: [t3, t1, tOff, t4, t2], priority: 5 })
      .select('id')
      .single()
    expect(error).toBeNull()
    const ruleId = rule!.id as string
    cleanups.push(async () => { await admin.from('product_badges').delete().eq('id', ruleId) })
    await admin.from('product_badge_targets').insert({ badge_id: ruleId, target_type: 'product', product_id: productId })

    const { data, error: rpcErr } = await anon.rpc('get_product_badges', { p_product_ids: [productId] })
    expect(rpcErr).toBeNull()
    const mine = (data as Array<{ badge_id: string; text: string; template_id: string }>).filter((r) => r.badge_id === ruleId)
    expect(mine.map((r) => r.text)).toEqual(['M3', 'M1', 'M4', 'M2'])
    expect(new Set(mine.map((r) => r.template_id)).size).toBe(4)
  })

  it('template_ids 가 비어 있는 행은 template_id 한 개로 폴백한다(옛 데이터·직접 입력 호환)', async () => {
    const { data: prod } = await admin.from('products').select('id').is('parent_product_id', null).is('deleted_at', null).eq('is_active', true).limit(1).maybeSingle()
    if (!prod) return
    const productId = prod.id as string
    const { data: tpl } = await admin.from('badge_templates').insert({ kind: 'textbar', name: 'DB폴백', text: 'FB', bg_color: '#3B2F8A', text_color: '#FFFFFF' }).select('id').single()
    const tid = tpl!.id as string
    cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', tid) })
    const { data: rule } = await admin.from('product_badges').insert({ name: 'DB폴백규칙', template_id: tid }).select('id').single()
    const ruleId = rule!.id as string
    cleanups.push(async () => { await admin.from('product_badges').delete().eq('id', ruleId) })
    await admin.from('product_badge_targets').insert({ badge_id: ruleId, target_type: 'product', product_id: productId })
    const { data } = await anon.rpc('get_product_badges', { p_product_ids: [productId] })
    expect((data as Array<{ badge_id: string; text: string }>).filter((r) => r.badge_id === ruleId).map((r) => r.text)).toEqual(['FB'])
  })
})

describe('#831 배지 목록 품번 — 만들 때 한 번 부여, 영구 고정', () => {
  it('새 배지목록은 기존 최대 품번 다음 번호를 자동으로 받고, 삭제해도 그 번호는 다시 쓰이지 않는다', async () => {
    const { data: tpl } = await admin.from('badge_templates').insert({ kind: 'textbar', name: 'DB품번', text: 'NO', bg_color: '#3B2F8A', text_color: '#FFFFFF' }).select('id').single()
    const tid = tpl!.id as string
    cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', tid) })
    const { data: before } = await admin.from('product_badges').select('badge_no').order('badge_no', { ascending: false }).limit(1).maybeSingle()
    const prevMax = (before?.badge_no as number | undefined) ?? 0

    const mk = async () => {
      const { data, error } = await admin.from('product_badges').insert({ name: 'DB품번규칙', template_id: tid }).select('id, badge_no').single()
      expect(error).toBeNull()
      const id = data!.id as string
      cleanups.push(async () => { await admin.from('product_badges').delete().eq('id', id) })
      return { id, no: data!.badge_no as number }
    }
    const a = await mk()
    expect(a.no).toBeGreaterThan(prevMax)
    // soft delete 후에도 번호는 그대로 남고, 다음 행은 더 큰 번호를 받는다(재사용 없음)
    await admin.from('product_badges').update({ deleted_at: new Date().toISOString() }).eq('id', a.id)
    const b = await mk()
    expect(b.no).toBeGreaterThan(a.no)
    const { data: kept } = await admin.from('product_badges').select('badge_no').eq('id', a.id).single()
    expect(kept!.badge_no).toBe(a.no)
  })
})

describe('#832 텍스트바 10자 + PNG 등록', () => {
  it('텍스트바 문구는 10자까지 저장되고 11자는 DB 제약이 막는다', async () => {
    const ok = await admin.from('badge_templates').insert({ kind: 'textbar', name: 'DB10자', text: '가나다라마바사아자차', bg_color: '#3B2F8A', text_color: '#FFFFFF' }).select('id').single()
    expect(ok.error).toBeNull()
    const id = ok.data!.id as string
    cleanups.push(async () => { await admin.from('badge_templates').delete().eq('id', id) })
    const over = await admin.from('badge_templates').insert({ kind: 'textbar', name: 'DB11자', text: '가나다라마바사아자차카', bg_color: '#3B2F8A', text_color: '#FFFFFF' })
    expect(over.error).not.toBeNull()
  })

  it('배지 버킷은 PNG 를 받고(SVG 도 유지), 다른 형식은 거절한다', async () => {
    // 1x1 PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const pngPath = `badges/${crypto.randomUUID()}.png`
    const up = await admin.storage.from('badge-icons').upload(pngPath, new Blob([png], { type: 'image/png' }), { contentType: 'image/png', upsert: false })
    expect(up.error).toBeNull()
    cleanups.push(async () => { await admin.storage.from('badge-icons').remove([pngPath]) })
    const gifPath = `badges/${crypto.randomUUID()}.gif`
    const bad = await admin.storage.from('badge-icons').upload(gifPath, new Blob([png], { type: 'image/gif' }), { contentType: 'image/gif', upsert: false })
    expect(bad.error).not.toBeNull()
  })
})
