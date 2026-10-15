import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 서류 종류 선택기 배치 회귀 방지 (2026-10-03 QA BLOCKING → 2026-10-15 공용 컴포넌트 CustomerDocRows로 이관)
 * 완료기준: 본인증명 박스에는 identity 선택지만, 외국인증명 박스에는 foreign 선택지만 연결되고, 하나의 공용 박스(snippet)가 종류별 상태로만 갈린다.
 * (컴포넌트 마운트 없이 소스 구조로 검증)
 */
const rows = readFileSync('src/lib/components/cms/CustomerDocRows.svelte', 'utf-8')
const panel = readFileSync('src/lib/components/cms/CustomerDetailPanel.svelte', 'utf-8')
const rental = readFileSync('src/lib/components/cms/RentalDetailPanel.svelte', 'utf-8')

describe('서류 업로드 박스 — 서류 종류 선택기 배치', () => {
  it('본인증명 박스는 identity 선택지, 외국인증명 박스는 foreign 선택지만 받는다', () => {
    expect(rows).toContain("{@render uploadBox('identity', IDENTITY_SLOT_OPTIONS)}")
    expect(rows).toContain("{@render uploadBox('foreign', FOREIGN_SLOT_OPTIONS)}")
    expect(rows).not.toMatch(/uploadBox\('identity', FOREIGN/)
    expect(rows).not.toMatch(/uploadBox\('foreign', IDENTITY/)
  })
  it('공용 박스는 선택기 1개이고 종류별 상태(uploadSlot[type])에 바인딩된다', () => {
    const snip = rows.slice(rows.indexOf('{#snippet uploadBox'), rows.indexOf('{/snippet}', rows.indexOf('{#snippet uploadBox')))
    expect(snip.match(/<SuggestPicker/g)?.length).toBe(1)
    expect(snip).toContain('bind:selectedId={uploadSlot[type]}')
    expect(snip).toContain('{options}')
  })
  it('확인 버튼은 종류를 고르기 전에는 비활성(양쪽)', () => {
    expect(rows).toContain('!uploadSlot[type]')
  })
  it('두 패널이 공용 컴포넌트를 쓰고 자체 업로드 박스를 다시 만들지 않는다', () => {
    expect(panel).toContain('<CustomerDocRows')
    expect(rental).toContain('<CustomerDocRows')
    expect(panel).not.toContain('reuploadIdentityOpen')
  })
})
