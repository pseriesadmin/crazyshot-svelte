/**
 * TDD: 자식 재고의 부모 정보 "복사 → 참조" 전환 — Phase 2B (표시·알림·목록 DB 함수 읽기 전환)
 *
 * 정책: 자식 재고(parent_product_id 있음)의 이름·분류·대표 이미지는 "부모 우선, 자식 폴백"으로 표시한다.
 * 부모·자식 값이 서로 다른 픽스처로 부모 우선을 판별하고, 부모가 없는 단독 상품은 자기 값 그대로인지 확인한다.
 * 대여목록 검색은 부모 이름·자식 이름 둘 다 매칭한다(결정 D4).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품·사용자를 만들고 종료 시 삭제한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-childdisp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function makeProduct(o: {
  parentId?: string
  name: string
  category: string
  image: string
  active?: boolean
}): Promise<string> {
  const slug = tag()
  const { data, error } = await admin
    .from('products')
    .insert({
      name: o.name, category: o.category, slug, is_active: o.active ?? false,
      image_urls: [o.image],
      ...(o.parentId ? { parent_product_id: o.parentId } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('products').delete().eq('id', id) })
  return id
}

async function makeUser(): Promise<string> {
  const email = `${tag()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => {
    const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', id)
    for (const s of sessions ?? []) {
      await admin.from('chat_messages').delete().eq('session_id', s.id)
      await admin.from('chat_sessions').delete().eq('id', s.id)
    }
    await admin.auth.admin.deleteUser(id)
  })
  return id
}

async function makeReservation(
  productId: string, userId: string, o: { status?: string; start?: string; end?: string } = {},
): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      product_id: productId, user_id: userId,
      start_date: o.start ?? '2030-06-10', end_date: o.end ?? '2030-06-11',
      pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit', status: o.status ?? 'hold',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 예약 생성 실패: ${error?.message}`)
  const rid = data.id as number
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
  return rid
}

interface Pair { parentName: string; parentCat: string; parentImg: string; childName: string; childCat: string; childImg: string; child: string; parent: string }

async function makePair(): Promise<Pair> {
  const t = tag()
  const parentName = `부모이름-${t}`
  const childName = `옛자식이름-${t}`
  const parentCat = `TDD-P-${t}`
  const childCat = `TDD-C-${t}`
  const parentImg = `https://example.com/parent-${t}.png`
  const childImg = `https://example.com/child-${t}.png`
  const parent = await makeProduct({ name: parentName, category: parentCat, image: parentImg, active: false })
  const child = await makeProduct({ parentId: parent, name: childName, category: childCat, image: childImg, active: true })
  return { parentName, parentCat, parentImg, childName, childCat, childImg, child, parent }
}

interface ListRow { reservation_id: number; product_name: string; product_category: string; product_image_url: string | null }

async function listRow(rid: number, groupByOrder: boolean, search?: string): Promise<ListRow | undefined> {
  const { data, error } = await admin.rpc('get_rental_list', {
    p_reservation_id: rid, p_group_by_order: groupByOrder, p_per_page: 50,
    ...(search ? { p_search: search } : {}),
  })
  if (error) throw new Error(`get_rental_list 실패: ${error.message}`)
  return ((data ?? []) as ListRow[]).find(r => Number(r.reservation_id) === rid)
}

describe('[TDD] Phase 2B — get_rental_list: 이름·분류·이미지는 부모 우선', () => {
  for (const grouped of [false, true]) {
    it(`DL-${grouped ? 2 : 1} 부모·자식 값이 다를 때 부모 값으로 표시(${grouped ? '주문 묶음' : '일반'} 분기)`, async () => {
      const p = await makePair()
      const rid = await makeReservation(p.child, await makeUser())
      const row = await listRow(rid, grouped)
      expect(row).toBeDefined()
      expect(row?.product_name).toBe(p.parentName)
      expect(row?.product_category).toBe(p.parentCat)
      expect(row?.product_image_url).toBe(p.parentImg)
    })
  }

  it('DL-3 부모 이미지가 비어 있으면 자식 이미지로 폴백', async () => {
    const p = await makePair()
    await admin.from('products').update({ image_urls: [] }).eq('id', p.parent)
    const rid = await makeReservation(p.child, await makeUser())
    const row = await listRow(rid, false)
    expect(row?.product_image_url).toBe(p.childImg)
    expect(row?.product_name).toBe(p.parentName)
  })

  it('DL-4 [회귀] 부모 없는 단독 상품은 자기 값 그대로', async () => {
    const t = tag()
    const solo = await makeProduct({ name: `단독-${t}`, category: `TDD-S-${t}`, image: `https://example.com/solo-${t}.png`, active: true })
    const rid = await makeReservation(solo, await makeUser())
    const row = await listRow(rid, false)
    expect(row?.product_name).toBe(`단독-${t}`)
    expect(row?.product_category).toBe(`TDD-S-${t}`)
    expect(row?.product_image_url).toBe(`https://example.com/solo-${t}.png`)
  })

  it('DL-5 검색(D4): 부모 이름으로도, 옛 자식 이름으로도 같은 예약이 검색된다', async () => {
    const p = await makePair()
    const rid = await makeReservation(p.child, await makeUser())
    expect((await listRow(rid, false, p.parentName))?.reservation_id).toBe(rid)
    expect((await listRow(rid, false, p.childName))?.reservation_id).toBe(rid)
    expect((await listRow(rid, true, p.parentName))?.reservation_id).toBe(rid)
    expect((await listRow(rid, true, p.childName))?.reservation_id).toBe(rid)
  })
})

async function chatProductNames(userId: string): Promise<string[]> {
  const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
  const ids = (sessions ?? []).map(s => s.id as string)
  if (ids.length === 0) return []
  const { data: msgs } = await admin.from('chat_messages').select('content, action_payload').in('session_id', ids)
  return (msgs ?? []).map(m => `${m.content ?? ''} ${JSON.stringify(m.action_payload ?? {})}`)
}

describe('[TDD] Phase 2B — 채팅 알림 문구의 상품명은 부모 이름', () => {
  it('DN-1 send_rental_chat_notification: 카드에 부모 이름(옛 자식 이름 아님)', async () => {
    const p = await makePair()
    const userId = await makeUser()
    const rid = await makeReservation(p.child, userId, { status: 'confirmed' })
    const { data, error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: rid, p_notify_type: 'reservation_approval' })
    expect(error).toBeNull()
    expect((data as { ok?: boolean } | null)?.ok).toBe(true)
    const texts = (await chatProductNames(userId)).join('\n')
    expect(texts).toContain(p.parentName)
    expect(texts).not.toContain(p.childName)
  })

  it('DN-2 send_rental_chat_notification_batch: 카드에 부모 이름', async () => {
    const p = await makePair()
    const userId = await makeUser()
    const rid = await makeReservation(p.child, userId, { status: 'confirmed' })
    const { data, error } = await admin.rpc('send_rental_chat_notification_batch', { p_reservation_ids: [rid], p_notify_type: 'reservation_approval' })
    expect(error).toBeNull()
    expect((data as { ok?: boolean } | null)?.ok).toBe(true)
    const texts = (await chatProductNames(userId)).join('\n')
    expect(texts).toContain(p.parentName)
    expect(texts).not.toContain(p.childName)
  })

  it('DN-3 get_return_remind_targets: 반납일 당일 대상의 상품명이 부모 이름', async () => {
    const p = await makePair()
    const userId = await makeUser()
    const today = new Date().toISOString().slice(0, 10) // DB 시간대(UTC) 기준 CURRENT_DATE
    const rid = await makeReservation(p.child, userId, { status: 'in_use', start: today, end: today })
    const { data, error } = await admin.rpc('get_return_remind_targets', { p_limit: 5000 })
    expect(error).toBeNull()
    const row = ((data ?? []) as Array<{ reservation_id: number; product_name: string }>).find(r => Number(r.reservation_id) === rid)
    expect(row).toBeDefined()
    expect(row?.product_name).toBe(p.parentName)
  })
})

describe('[TDD] Phase 2B — claim_reservations_due_for_locker_guide: 상품명은 부모 이름', () => {
  // 함수는 "KST 23시~09시 사이의 방문 반납, 반납 1시간 이내" 예약만 집는다 — 시각 조건을 테스트가 바꿀 수 없어
  // (1) 항상 실행 스모크(구문·참조 오류는 실행 계획 단계에서 드러남) (2) 지금이 해당 시간대일 때만 값을 검증한다.
  const target = new Date(Date.now() + 9 * 3600 * 1000 + 30 * 60 * 1000) // KST 기준 30분 뒤
  const hour = target.getUTCHours()
  const inWindow = hour === 23 || hour < 9
  const hh = String(hour).padStart(2, '0')
  const mm = String(target.getUTCMinutes()).padStart(2, '0')
  const kstDate = target.toISOString().slice(0, 10)

  it('DN-4 스모크: 함수가 오류 없이 실행된다(치환 SQL 유효성)', async () => {
    const { error } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 1 })
    expect(error).toBeNull()
  })

  it.skipIf(!inWindow)('DN-5 방문 반납 1시간 이내 + 보관함 비밀번호 → 반환 상품명이 부모 이름', async () => {
    const p = await makePair()
    const userId = await makeUser()
    const { data, error } = await admin.from('rental_reservations').insert({
      product_id: p.child, user_id: userId, status: 'in_use', pickup_method: 'visit', return_method: 'visit',
      start_date: kstDate, end_date: kstDate, pickup_time: '10:00', return_time: `${hh}:${mm}`, locker_password: 'tdd1234',
    }).select('id').single()
    expect(error).toBeNull()
    const rid = data?.id as number
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
    const { data: rows, error: e2 } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 50 })
    expect(e2).toBeNull()
    const row = ((rows ?? []) as Array<{ reservation_id: number; leg: string; product_name: string }>).find(r => Number(r.reservation_id) === rid)
    expect(row?.leg).toBe('return')
    expect(row?.product_name).toBe(p.parentName)
  })
})

describe('[TDD] Phase 3 — 앱 코드: 예약 행의 products 임베드를 부모 값으로 (실제 임베드 쿼리)', () => {
  it('AP-1 account·알림 코드와 같은 형태의 임베드 조회 결과가 부모 이름·분류로 바뀐다(품번은 자식 값 유지)', async () => {
    const p = await makePair()
    const rid = await makeReservation(p.child, await makeUser())
    const { data, error } = await admin
      .from('rental_reservations')
      .select('id, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
      .eq('id', rid)
    expect(error).toBeNull()
    const rows = (data ?? []) as unknown[]
    await applyParentFieldsToRowProducts(rows, ['name', 'category'], admin)
    const emb = (rows[0] as { products: { name: string; category: string; parent_product_id: string | null } }).products
    expect(emb.name).toBe(p.parentName)
    expect(emb.category).toBe(p.parentCat)
    expect(emb.parent_product_id).toBe(p.parent) // 자식 고유값은 덮어쓰지 않는다
  })

  it('AP-2 [회귀] 부모를 조회할 수 없는(삭제된) 경우에도 자식 값으로 폴백하고 오류를 내지 않는다', async () => {
    const p = await makePair()
    const rid = await makeReservation(p.child, await makeUser())
    const { data } = await admin
      .from('rental_reservations')
      .select('id, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
      .eq('id', rid)
    const rows = (data ?? []) as unknown[]
    const brokenClient = createClient(PUBLIC_SUPABASE_URL, 'invalid-key')
    await applyParentFieldsToRowProducts(rows, ['name'], brokenClient)
    expect((rows[0] as { products: { name: string } }).products.name).toBe(p.childName)
  })
})

