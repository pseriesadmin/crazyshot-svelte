import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { updateSpecialNotesInHtml } from '$lib/utils/contract-substitution'
import { normalizeContractSpecs, mergeContractSpecs, MAX_CONTRACT_SPEC_ROWS } from '$lib/utils/contractSpecs'

describe('예약별 계약 특약 사전 등록', () => {
  it('정규화: 항목명 없는 행 제외·공백 제거·개수 상한', () => {
    expect(normalizeContractSpecs([{ key: ' 보증 ', value: ' 면제 ' }, { key: '', value: 'x' }, null, 5])).toEqual([{ key: '보증', value: '면제' }])
    expect(normalizeContractSpecs('x')).toEqual([])
    expect(normalizeContractSpecs(Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, value: '' }))).length).toBe(MAX_CONTRACT_SPEC_ROWS)
  })
  it('병합: 양식 특약 뒤에 예약 특약', () => {
    expect(mergeContractSpecs([{ key: 'a', value: '1' }], [{ key: 'b', value: '2' }])).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])
    expect(mergeContractSpecs(null, undefined)).toEqual([])
  })
  it('자동발행·수동 발행·API가 같은 규칙을 쓰고 manager 이상 게이트가 있다', () => {
    expect(readFileSync('src/lib/server/contractAutoIssue.ts', 'utf-8')).toContain('mergeContractSpecs(tpl.specifications, reservationSpecs)')
    expect(readFileSync('src/lib/components/cms/ContractTemplatePreviewModal.svelte', 'utf-8')).toContain('...reservationSpecs')
    const api = readFileSync('src/routes/api/cms/reservations/[id]/contract-specs/+server.ts', 'utf-8')
    expect(api).toContain('hasSettingsAccess')
    expect(api).toContain("requireMenuAccessApi(locals, 'rental.reservation')")
  })

  it("특약 내용의 $&·$1·$'·$` 가 HTML 치환 패턴으로 해석되지 않는다", () => {
    const html = '<table><tr><td class="cs-special-notes-cell" colspan="2">&nbsp;</td></tr></table>'
    const out = updateSpecialNotesInHtml(html, [{ key: '메모', value: "a $& b $1 c $' d $` e $$" }])
    expect(out).toContain('메모: a $&amp; b $1 c $')
    expect(out).toContain('e $$')
    expect(out.match(/<td class="cs-special-notes-cell"/g)?.length).toBe(1)
    expect(out.match(/<\/td>/g)?.length).toBe(1)
  })
})
