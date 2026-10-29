import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 확정 등록 — 구매금액·관리자 메모·가입 방식·생년월일을 대기 목록에 함께 저장한다 (2026-10-29, 1단계)
 */
const h = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[] }))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, to: string) => ({ status, to }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.maybeSingle = async () => ({ data: null, error: null })
      b.insert = async (row: Record<string, unknown>) => {
        h.inserts.push(row)
        return { error: null }
      }
      return b
    },
  }),
}))

import { actions } from '../../routes/cms/customers/legacy-import/+page.server'

interface RowIn { name: string; email: string; signupAt: string | null; purchaseCount: number; purchaseAmount: number; memo: string | null; birthDate: string | null; source: string; isStaff: boolean }
const row = (o: Partial<RowIn> = {}): RowIn => ({
  name: '김고객', email: 'a@ex.com', signupAt: '2026-04-11 19:13:29', purchaseCount: 2, purchaseAmount: 55963,
  memo: '메모 내용', birthDate: '1990-05-17', source: 'kakao', isStaff: false, ...o,
})
const group = (rows: RowIn[], extra: Record<string, unknown> = {}) => ({
  phone: '01011112222',
  rows: rows.map((r) => ({ ...r, phone: '01011112222', rawLine: '' })),
  representEmail: rows[0].email,
  totalPurchaseCount: rows.reduce((s, r) => s + r.purchaseCount, 0),
  totalPurchaseAmount: rows.reduce((s, r) => s + r.purchaseAmount, 0),
  memo: rows.map((r) => r.memo).filter(Boolean).join('\n') || null,
  staff: false,
  excluded: false,
  ...extra,
})

async function confirm(groups: unknown[]) {
  const fd = new FormData()
  fd.set('groups_json', JSON.stringify(groups))
  const confirmAction = (actions as unknown as { confirm: (e: unknown) => Promise<unknown> }).confirm
  return confirmAction({ request: { formData: async () => fd }, locals: { safeGetSession: async () => ({ session: { user: { id: 'u' } } }) } })
}

beforeEach(() => {
  h.inserts.length = 0
})

describe('확정 등록 — 대기 목록 저장 항목', () => {
  it('구매금액·메모·가입 방식·생년월일을 함께 저장한다', async () => {
    await confirm([group([row()])])
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0]).toMatchObject({
      email: 'a@ex.com',
      legacy_source: 'kakao',
      legacy_purchase_count: 2,
      legacy_purchase_amount: 55963,
      legacy_memo: '메모 내용',
      birth_date: '1990-05-17',
    })
  })

  it('같은 전화번호로 묶인 행은 묶음 합계(구매횟수·구매금액)와 이어 붙인 메모를 저장한다', async () => {
    await confirm([group([row({ email: 'a@ex.com', memo: 'A', purchaseCount: 1, purchaseAmount: 10000 }), row({ email: 'b@ex.com', memo: 'B', purchaseCount: 2, purchaseAmount: 20000 })])])
    expect(h.inserts[0]).toMatchObject({ legacy_purchase_count: 3, legacy_purchase_amount: 30000, legacy_memo: 'A\nB' })
  })

  it('대표 이메일 행의 가입 방식을 따른다', async () => {
    const g = group([row({ email: 'a@ex.com', source: 'kakao' }), row({ email: 'b@ex.com', source: 'google' })], { representEmail: 'b@ex.com' })
    await confirm([g])
    expect(h.inserts[0].legacy_source).toBe('google')
  })

  it('메모·생년월일이 없으면 null 로 저장한다', async () => {
    await confirm([group([row({ memo: null, birthDate: null })])])
    expect(h.inserts[0].legacy_memo).toBeNull()
    expect(h.inserts[0].birth_date).toBeNull()
  })

  it('구매금액이 숫자가 아니거나 음수면 0 으로 보정한다(저장 오류 방지)', async () => {
    await confirm([group([row({ purchaseAmount: Number.NaN })], { totalPurchaseAmount: -5 })])
    expect(h.inserts[0].legacy_purchase_amount).toBe(0)
  })

  it('제외 표시된 묶음(운영진 등)은 저장하지 않는다', async () => {
    await confirm([group([row()], { excluded: true, staff: true }), group([row({ email: 'c@ex.com' })])])
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0].email).toBe('c@ex.com')
  })

  it('서버가 입력을 다시 검증한다 — 형식이 틀린 생년월일은 null, 너무 긴 메모는 잘라내고, 너무 큰 금액은 상한으로 줄인다', async () => {
    const g = group([row({ birthDate: '1990-02-31' })], { totalPurchaseAmount: 5e15, memo: 'ㄱ'.repeat(20000) })
    await confirm([g])
    expect(h.inserts[0].birth_date).toBeNull()
    expect((h.inserts[0].legacy_memo as string).length).toBe(10000)
    expect(h.inserts[0].legacy_purchase_amount).toBe(1e12)
  })

  it('날짜 형식이 아닌 생년월일 문자열(조작된 값)은 저장하지 않는다', async () => {
    await confirm([group([row({ birthDate: "1990-01-01'; drop table x;--" })])])
    expect(h.inserts[0].birth_date).toBeNull()
  })

  it('그룹 수가 너무 많으면(5,000 초과) 처리하지 않고 400 으로 거절한다', async () => {
    const many = Array.from({ length: 5001 }, (_, i) => group([row({ email: `u${i}@ex.com` })]))
    const res = (await confirm(many)) as { status?: number }
    expect(res.status).toBe(400)
    expect(h.inserts).toHaveLength(0)
  })

  it('rows 가 비었거나 배열이 아닌 그룹은 서버 오류 없이 건너뛴다', async () => {
    const bad = { ...group([row()]), rows: [] }
    const bad2 = { ...group([row()]), rows: null }
    const res = (await confirm([bad, bad2, group([row({ email: 'ok@ex.com' })])])) as { ok: boolean; summary: { successCount: number; skippedCount: number; errorCount: number } }
    expect(res.ok).toBe(true)
    expect(res.summary.successCount).toBe(1)
    expect(h.inserts).toHaveLength(1)
  })

  it('구매횟수 합계가 음수·소수·너무 큰 값이면 0 이상 정수로 보정한다', async () => {
    await confirm([group([row()], { totalPurchaseCount: -3 })])
    await confirm([group([row({ email: 'b@ex.com' })], { totalPurchaseCount: 2.9 })])
    await confirm([group([row({ email: 'c@ex.com' })], { totalPurchaseCount: 1e12 })])
    expect(h.inserts.map((r) => r.legacy_purchase_count)).toEqual([0, 2, 100000])
  })
})
