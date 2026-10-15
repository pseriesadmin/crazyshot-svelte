import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { identityTypeLabel, foreignTypeLabel, identityFileLabel, formatDocDate, needsDocApproval } from '$lib/utils/customerDocLabels'

// 고객 관리 패널과 예약 패널 고객정보 탭의 서류 행이 같은 컴포넌트를 쓰는지(2026-10-15 동기화 요구) + 공용 라벨 규칙
const read = (p: string) => readFileSync(p, 'utf-8')

describe('서류 행 공용화', () => {
  it('두 패널 모두 CustomerDocRows를 쓴다', () => {
    expect(read('src/lib/components/cms/CustomerDetailPanel.svelte')).toContain('<CustomerDocRows')
    expect(read('src/lib/components/cms/RentalDetailPanel.svelte')).toContain('<CustomerDocRows')
  })
  it('customer-docs API는 서류 파일 URL을 싣지 않는다', () => {
    const src = read('src/routes/api/cms/reservations/[id]/customer-docs/+server.ts')
    const resp = src.slice(src.lastIndexOf('return json({'))
    expect(resp).not.toMatch(/doc_url/)
    expect(src).toContain('types: row.identity_type')
  })
  it('라벨·날짜 규칙', () => {
    expect(identityTypeLabel(['student', 'resident', 'resident_copy'])).toBe('학생증, 주민등록증, 주민등록등본')
    expect(identityTypeLabel(null)).toBe('일반 증명')
    expect(foreignTypeLabel('short', ['passport_photo'])).toBe('단기체류(90일 내) · 여권사진면')
    expect(identityFileLabel(['student'], 0, 1)).toBe('학생증')
    expect(formatDocDate('2026-10-15T03:00:00Z')).toBe('2026.10.15')
    expect(needsDocApproval('2026-10-15', null)).toBe(true)
    expect(needsDocApproval('2026-10-15', '2026-10-16')).toBe(false)
  })
})
