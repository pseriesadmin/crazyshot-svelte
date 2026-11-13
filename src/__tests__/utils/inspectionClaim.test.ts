import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BILLING_ISSUE_KEY, CLAIM_AMOUNT_MAX, CLAIM_KINDS, INSPECTION_ISSUE_TYPES, claimKindLabel, validateIssueInput } from '$lib/utils/inspection'

/**
 * CS 이슈 '청구' 항목 (2026-11-14, Stephen 확정) — 청구 사유(복수)·금액을 함께 기록한다. 지금은 기록만(PG 연동은 이후).
 */

const ownedPath = () => true
const base = { detail: '청구 건', media: [] }

describe("CS 이슈 항목 '청구'", () => {
  it("항목 목록에 '청구'가 있고 '기타'는 맨 끝에 남는다", () => {
    const keys = INSPECTION_ISSUE_TYPES.map((t) => t.key)
    expect(keys).toContain(BILLING_ISSUE_KEY)
    expect(INSPECTION_ISSUE_TYPES.find((t) => t.key === BILLING_ISSUE_KEY)?.label).toBe('청구')
    expect(keys[keys.length - 1]).toBe('etc')
  })

  it('청구 사유는 파손·분실·연체·반품배송요금', () => {
    expect(CLAIM_KINDS.map((k) => k.label)).toEqual(['파손', '분실', '연체', '반품배송요금'])
    expect(claimKindLabel('return_shipping')).toBe('반품배송요금')
  })

  it('청구를 고르면 사유별 금액이 필수 — 없거나 어긋나면 거절', () => {
    const none = validateIssueInput({ ...base, types: ['billing'] }, ownedPath)
    expect(none).toEqual({ ok: false, error: '청구 사유를 1개 이상 선택해 주세요.' })
    const empty = validateIssueInput({ ...base, types: ['billing'], claim_items: [] }, ownedPath)
    expect(empty.ok).toBe(false)
    const badKind = validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'hack', amount: 1000 }] }, ownedPath)
    expect(badKind.ok).toBe(false)
    const dupKind = validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'damage', amount: 1000 }, { kind: 'damage', amount: 2000 }] }, ownedPath)
    expect(dupKind.ok).toBe(false)
    for (const amount of [undefined, 0, -5, 1.5, '1000', CLAIM_AMOUNT_MAX + 1]) {
      const r = validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'damage', amount }] }, ownedPath)
      expect(r).toEqual({ ok: false, error: '청구 금액을 1원 이상 1억 원 이하로 입력해 주세요.' })
    }
  })

  it('사유 2개 중 한쪽 금액이 비면 거절(사유마다 금액 필수)', () => {
    const r = validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'damage', amount: 150000 }, { kind: 'overdue' }] }, ownedPath)
    expect(r.ok).toBe(false)
  })

  it('사유별 금액이 있으면 통과하고 합계를 계산한다', () => {
    const r = validateIssueInput({ ...base, types: ['billing', 'exterior_damage'], claim_items: [{ kind: 'damage', amount: 150000 }, { kind: 'overdue', amount: 30000 }] }, ownedPath)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.claim).toEqual({ items: [{ kind: 'damage', amount: 150000 }, { kind: 'overdue', amount: 30000 }], total: 180000 })
  })

  it('금액 1원·1억 원은 허용하고, 합계가 1억 원을 넘으면 거절', () => {
    for (const amount of [1, CLAIM_AMOUNT_MAX]) {
      expect(validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'lost', amount }] }, ownedPath).ok).toBe(true)
    }
    const over = validateIssueInput({ ...base, types: ['billing'], claim_items: [{ kind: 'damage', amount: 90_000_000 }, { kind: 'lost', amount: 20_000_000 }] }, ownedPath)
    expect(over).toEqual({ ok: false, error: '청구 금액 합계는 1억 원 이하로 입력해 주세요.' })
  })

  it("청구를 고르지 않으면 청구 값은 무시한다(claim 없음)", () => {
    const r = validateIssueInput({ ...base, types: ['malfunction'], claim_items: [{ kind: 'damage', amount: 5000 }] }, ownedPath)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.claim ?? null).toBeNull()
  })
})

describe('청구 저장 연결(소스 점검)', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')
  it('서버는 RPC 에 청구 사유·금액을 넘기고, 조회 API 는 청구 칼럼을 내려준다', () => {
    const srv = read('src/lib/server/inspection.ts')
    expect(srv).toContain('p_claim_items: input.claim?.items ?? null')
    const api = read('src/routes/api/cms/reservations/[id]/return-evidence/+server.ts')
    expect(api).toContain('claim_kinds, claim_amount, claim_status, claim_items')
    expect(api).toContain('claim_items: i.claim_items ?? null')
  })

  it('Migration #826·#827: 서버 전용 권한 + 청구 일관성 CHECK + 이슈 항목 billing 일 때만 사유별 금액 저장', () => {
    const m826 = read('supabase/migrations/20261114010000_826_inspection_issue_claim.sql')
    expect(m826).toContain('chk_inspection_issues_claim')
    const mig = read('supabase/migrations/20261114020000_827_inspection_issue_claim_items.sql')
    expect(mig).toContain('REVOKE ALL ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;')
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, jsonb) TO service_role;')
    expect(mig).toContain('chk_inspection_issues_claim_items')
    expect(mig).toContain("v_billing := 'billing' = ANY(p_types);")
    expect(mig).toContain('DROP FUNCTION IF EXISTS public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb, text[], integer);')
    expect(mig).toContain("v_kind = ANY(v_kinds)") // 사유 중복 거절
  })

  it("패널: '청구' 선택 시에만 사유·금액을 받고, 금액은 천단위 콤마 표시·숫자만 전송, 미입력이면 등록 버튼 비활성", () => {
    const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(panel).toContain('issueTypesSel.includes(BILLING_ISSUE_KEY)')
    expect(panel).toContain("toLocaleString('ko-KR')")
    expect(panel).toContain('payload.claim_items = claimItemsPayload')
    expect(panel).toContain('{#each issueClaimKinds as kind (kind)}') // 선택한 사유마다 금액 입력칸
    expect(panel).toContain('!issueBillingReady')
    expect(panel).toContain('oncompositionend')
  })
})
