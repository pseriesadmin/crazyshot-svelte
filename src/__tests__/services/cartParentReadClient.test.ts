/**
 * TDD: 장바구니 로더는 부모 값을 서비스 클라이언트로 읽는다 — 노출 OFF(비공개) 부모의 판매전용·이름·이미지가 고객 세션(RLS)에 막히지 않는다
 * (자식 재고 부모 참조 전환 Phase 5 후속 M-1: 새 재고는 부모 값을 복사하지 않아 "자식 값 폴백"이 더는 먹지 않는다)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 — 전용 임시 상품·사용자 생성 후 삭제.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const { load } = await import('../../routes/cart/+page.server')

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-cartpar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('[TDD] cart load — 비공개 부모의 값을 부모 우선으로', () => {
  it('CP-1 부모 노출 OFF + 새 재고(복사값 없음): 카트 상품이 부모 이름·이미지·판매전용으로 나온다', async () => {
    const t = tag()
    const parentName = `부모-${t}`
    const parentImg = `https://example.com/${t}.png`
    const { data: parent, error: pe } = await admin.from('products').insert({
      name: parentName, slug: t, category: 'TDD', is_active: false, image_urls: [parentImg], sale_only: true, sale_price: 33000,
    }).select('id').single()
    if (pe || !parent) throw new Error(`부모 생성 실패: ${pe?.message}`)
    cleanups.push(async () => { await admin.from('products').delete().eq('id', parent.id) })
    const { data: child, error: ce } = await admin.from('products').insert({
      name: `자식-${t}`, slug: `${t}-inv`, category: 'TDD', is_active: true, parent_product_id: parent.id,
    }).select('id').single()
    if (ce || !child) throw new Error(`자식 생성 실패: ${ce?.message}`)
    cleanups.push(async () => { await admin.from('products').delete().eq('id', child.id) })

    const email = `${t}@example.com`
    const { data: u } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    const userId = u.user?.id as string
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })
    const { data: r, error: re } = await admin.from('rental_reservations').insert({
      product_id: child.id, user_id: userId, status: 'hold', duration_type: 'purchase',
    }).select('id').single()
    if (re || !r) throw new Error(`예약 생성 실패: ${re?.message}`)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', r.id) })

    const userClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: se } = await userClient.auth.signInWithPassword({ email, password: 'Test1234!' })
    if (se) throw new Error(`로그인 실패: ${se.message}`)

    const result = (await load({
      locals: { supabase: userClient, safeGetSession: async () => ({ session: { user: { id: userId } } }) },
      url: new URL('http://localhost/cart'),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>

    const text = JSON.stringify(result)
    expect(text, '카트 결과에 부모 이름이 있어야 한다').toContain(parentName)
    expect(text).toContain(parentImg)
  })
})
