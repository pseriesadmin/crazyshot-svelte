// @vitest-environment node
/**
 * clearIssuedContract.test.ts — 계약서 콘텐츠 초기화 로직 TDD
 *
 * 핵심 불변식 (contract.md "계약서 양식 편집 제한 정책" 동일 원칙):
 *   서명완료(signed_at) 또는 발송됨(sent_at)이 확인된 계약서는
 *   콘텐츠 초기화를 서버에서도 거부한다 — 클라이언트 버튼 숨김만으로는 불충분.
 *
 * 3 케이스:
 *   C1. 서명 완료 계약서 → 초기화 거부 (400, 서명완료 에러)
 *   C2. 발송됨 계약서 → 초기화 거부 (400, 발송됨 에러)
 *   C3. 서명/발송 없는 계약서 → content_blocks [] 로 초기화 성공
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { clearIssuedContractContent } from '$lib/server/clearIssuedContractHelper'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let testProductId: string
type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-clearcontract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  return data.user.id
}

async function deleteEphemeralUser(userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId).catch(() => undefined)
}

async function createReservation(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: testProductId, start_date: '2026-10-01', end_date: '2026-10-03', status: 'hold', pickup_method: 'visit', return_method: 'visit' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`)
  return data.id as number
}

async function createContract(userId: string, reservationId: number): Promise<string> {
  const { data, error } = await admin
    .from('contracts')
    .insert({ reservation_id: reservationId, user_id: userId, contract_type: 'rental', status: 'active', content_blocks: [{ type: 'text', html: '<p>계약내용</p>' }] })
    .select('id')
    .single()
  if (error || !data) throw new Error(`contract 생성 실패: ${error?.message}`)
  return data.id as string
}

async function createSigning(contractId: string, userId: string, opts: { signed_at?: string; sent_at?: string } = {}): Promise<string> {
  const { data, error } = await admin
    .from('contract_signings')
    .insert({ contract_id: contractId, user_id: userId, ...opts })
    .select('id')
    .single()
  if (error || !data) throw new Error(`contract_signings 생성 실패: ${error?.message}`)
  return data.id as string
}

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').is('parent_product_id', null).limit(1).single()
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`)
  testProductId = data.id as string
})

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn()
  }
})

describe('[C1] 서명 완료 계약서 — 초기화 거부', () => {
  it('signed_at이 있으면 clearIssuedContractContent가 ok:false + httpStatus:400을 반환한다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation(userId)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const contractId = await createContract(userId, reservationId)
    const signingId  = await createSigning(contractId, userId, { signed_at: new Date().toISOString() })
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId)
      await admin.from('contracts').delete().eq('id', contractId)
    })

    const result = await clearIssuedContractContent(contractId, admin)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(400)
      expect(result.error).toContain('서명 완료')
    }
  })

  it('서명 완료 계약서는 DB content_blocks가 변경되지 않아야 한다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation(userId)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const contractId = await createContract(userId, reservationId)
    const signingId  = await createSigning(contractId, userId, { signed_at: new Date().toISOString() })
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId)
      await admin.from('contracts').delete().eq('id', contractId)
    })

    await clearIssuedContractContent(contractId, admin)

    const { data } = await admin.from('contracts').select('content_blocks').eq('id', contractId).single()
    const blocks = data?.content_blocks as unknown[]
    expect(Array.isArray(blocks) && blocks.length > 0).toBe(true)
  })
})

describe('[C2] 발송됨 계약서 — 초기화 거부', () => {
  it('sent_at이 있으면 clearIssuedContractContent가 ok:false + httpStatus:400을 반환한다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation(userId)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const contractId = await createContract(userId, reservationId)
    const signingId  = await createSigning(contractId, userId, { sent_at: new Date().toISOString() })
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId)
      await admin.from('contracts').delete().eq('id', contractId)
    })

    const result = await clearIssuedContractContent(contractId, admin)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(400)
      expect(result.error).toContain('발송')
    }
  })
})

describe('[C3] 서명/발송 없는 계약서 — content_blocks 초기화 성공', () => {
  it('signing row가 없으면 content_blocks를 []로 비우고 ok:true를 반환한다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation(userId)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const contractId = await createContract(userId, reservationId)
    cleanups.push(async () => { await admin.from('contracts').delete().eq('id', contractId) })

    const result = await clearIssuedContractContent(contractId, admin)
    expect(result.ok).toBe(true)

    const { data } = await admin.from('contracts').select('content_blocks').eq('id', contractId).single()
    const blocks = data?.content_blocks as unknown[]
    expect(Array.isArray(blocks) && blocks.length === 0).toBe(true)
  })

  it('signing row는 있지만 sent_at도 signed_at도 null이면 초기화 성공', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation(userId)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const contractId = await createContract(userId, reservationId)
    const signingId  = await createSigning(contractId, userId)  // sent_at, signed_at 모두 null
    cleanups.push(async () => {
      await admin.from('contract_signings').delete().eq('id', signingId)
      await admin.from('contracts').delete().eq('id', contractId)
    })

    const result = await clearIssuedContractContent(contractId, admin)
    expect(result.ok).toBe(true)
  })
})
