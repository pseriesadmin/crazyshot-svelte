import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 예약 패널 서류 상태 조회 effect가 무한 재조회 루프를 만들지 않는다 (QA B-1, 2026-10-15)
 * effect가 로딩 플래그를 읽고 쓰면 조회가 끝날 때마다 다시 실행된다 → 로딩 플래그는 untrack으로 읽고 '마지막 조회 키' 가드를 둔다.
 */
const src = readFileSync(resolve(process.cwd(), 'src/lib/components/cms/RentalDetailPanel.svelte'), 'utf8')
const effect = src.slice(src.indexOf("fetch(`/api/cms/reservations/${id}/customer-docs`)") - 900, src.indexOf("fetch(`/api/cms/reservations/${id}/customer-docs`)") + 400)

describe('RentalDetailPanel customer-docs 조회 effect', () => {
  it('로딩 플래그를 untrack으로 읽는다', () => {
    expect(src).toContain("import { untrack } from 'svelte'")
    expect(effect).toContain('untrack(() => customerDocsLoading)')
    expect(effect).not.toMatch(/if \(customerDocsLoading\)/)
  })
  it('같은 조회 키(예약·상태·계약서 발송 여부)면 다시 조회하지 않는다', () => {
    expect(effect).toContain('customerDocsFetchedKey === key')
    expect(effect).toContain('row.signing_sent_at')
  })
  it('승인완료는 예약승인 기록(approved) 또는 계약서 발송 여부로 판정하고, 승인 전 hold는 계약서 탭 발행을 잠근다 (2026-10-15)', () => {
    const state = src.slice(src.indexOf('const approveState'), src.indexOf('const approveLabel'))
    expect(state).toContain('customerDocs?.approved')
    expect(state).toContain('signing_sent_at')
    expect(src).toContain('const contractApprovalLocked')
    expect(src).toContain('approvalLocked={contractApprovalLocked}')
  })
})
