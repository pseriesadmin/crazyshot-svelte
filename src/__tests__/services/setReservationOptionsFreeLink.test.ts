/**
 * setReservationOptionsFreeLink.test.ts
 * set_reservation_options 무료(is_free) 옵션 저장단가 강제 0원 — 본상품(부모) 기준 링크 조회 (Migration 586)
 *
 * 배경: 예약(rental_reservations.product_id)은 항상 재고(자식) id로 저장되지만 옵션 링크
 * (product_option_links.product_id)는 부모에 저장된다. Migration 569는 자식 id로 링크를 조회해
 * 무료 옵션이어도 클라이언트가 보낸 정가가 reservation_options.unit_price에 그대로 저장됐다
 * (청구·화면은 Migration 585가 이미 0원 — 저장값 표기만 어긋남).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 모든 fixture는 테스트마다 격리 생성·정리한다.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function createSession(): Promise<SupabaseClient> {
  const email = `tdd-optfree-${tag()}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`임시 사용자 로그인 실패: ${signInErr.message}`)
  cleanups.push(async () => {
    await admin.auth.admin.deleteUser(userId)
  })
  return asUser
}

/** 부모(본상품) + 활성 자식 childCount개를 만들고 { parentId, childId }를 반환 */
async function makeProduct(label: string, childCount: number): Promise<{ parentId: string; childId: string | null }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD] ${label} ${tag()}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  let childId: string | null = null
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: ce } = await admin
      .from('products')
      .insert({ name: `[TDD] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (ce || !c) throw new Error(`자식상품 생성 실패: ${ce?.message}`)
    childId = childId ?? (c as { id: string }).id
  }
  return { parentId, childId }
}

async function makeLink(mainId: string, optionId: string, o: { isFree: boolean; deleted?: boolean }): Promise<void> {
  const { error } = await admin.from('product_option_links').insert({
    product_id: mainId,
    option_product_id: optionId,
    is_free: o.isFree,
    deleted_at: o.deleted ? new Date().toISOString() : null,
  })
  if (error) throw new Error(`product_option_links 생성 실패: ${error.message}`)
  cleanups.push(async () => {
    await admin.from('product_option_links').delete().eq('product_id', mainId).eq('option_product_id', optionId)
  })
}

type DraftRow = { success: boolean; reservation_id: number | null; error_message: string | null }

/** 사용자 소유 예약을 만들고 product_id를 지정한 값(자식/부모)으로 맞춘 뒤 hold로 전환 */
async function makeReservation(client: SupabaseClient, mainParentId: string, storedProductId: string): Promise<number> {
  const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: mainParentId })
  if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
  const row = (data as DraftRow[] | null)?.[0]
  if (!row?.success || row.reservation_id == null) throw new Error(`create_draft_reservation 실패: ${row?.error_message}`)
  const id = row.reservation_id
  cleanups.push(async () => {
    await admin.from('reservation_options').delete().eq('reservation_id', id)
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  const { error: upErr } = await admin
    .from('rental_reservations')
    .update({ product_id: storedProductId, status: 'hold' })
    .eq('id', id)
  if (upErr) throw new Error(`예약 product_id 설정 실패: ${upErr.message}`)
  return id
}

async function saveOption(client: SupabaseClient, reservationId: number, optionId: string, unitPrice: number): Promise<void> {
  const { error } = await client.rpc('set_reservation_options', {
    p_reservation_id: reservationId,
    p_options: [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1, unit_price: unitPrice }],
  })
  if (error) throw new Error(`set_reservation_options 실패: ${error.message}`)
}

async function storedPrice(reservationId: number): Promise<number | null> {
  const { data } = await admin.from('reservation_options').select('unit_price').eq('reservation_id', reservationId)
  const rows = (data ?? []) as Array<{ unit_price: number }>
  return rows.length === 1 ? Number(rows[0].unit_price) : null
}

describe('[TDD] set_reservation_options — 무료 링크 저장단가 0 강제 (본상품=부모 기준)', () => {
  it('OF-1: 자식(재고) id로 저장된 예약 + 부모의 무료 링크 → 클라이언트가 정가를 보내도 0으로 저장', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(main.parentId, opt.parentId, { isFree: true })
    const resId = await makeReservation(client, main.parentId, main.childId as string)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(0)
  })

  it('OF-2 [회귀]: 부모 id로 저장된 예약 + 부모의 무료 링크 → 0', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(main.parentId, opt.parentId, { isFree: true })
    const resId = await makeReservation(client, main.parentId, main.parentId)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(0)
  })

  it('OF-3: 링크가 자식 id에만 있으면(잘못 저장된 링크) 무시 → 정가 그대로', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(main.childId as string, opt.parentId, { isFree: true })
    const resId = await makeReservation(client, main.parentId, main.childId as string)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(5000)
  })

  it('OF-4: 다른 본상품에만 무료 링크가 있으면 이 본상품의 같은 옵션은 정가 (무료 번짐 차단)', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const other = await makeProduct('다른본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(other.parentId, opt.parentId, { isFree: true })
    await makeLink(main.parentId, opt.parentId, { isFree: false })
    const resId = await makeReservation(client, main.parentId, main.childId as string)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(5000)
  })

  it('OF-5: 삭제된 무료 링크는 무료로 보지 않음 → 정가', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(main.parentId, opt.parentId, { isFree: true, deleted: true })
    const resId = await makeReservation(client, main.parentId, main.childId as string)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(5000)
  })

  it('OF-6: 무료가 아닌 링크(is_free=false)는 저장 단가 그대로', async () => {
    const client = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 1)
    await makeLink(main.parentId, opt.parentId, { isFree: false })
    const resId = await makeReservation(client, main.parentId, main.childId as string)
    await saveOption(client, resId, opt.parentId, 5000)
    expect(await storedPrice(resId)).toBe(5000)
  })
})
