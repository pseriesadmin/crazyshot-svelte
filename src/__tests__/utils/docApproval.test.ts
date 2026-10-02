import { describe, it, expect } from 'vitest'
import { identityRequiredMet, foreignRequiredMet, getDocGateStatus } from '$lib/utils/docApproval'

/**
 * 본인증명·외국인증명 필수 조합 + 예약 게이트 판정 (2026-10-02, Stephen 확정)
 * 완료기준: 필수 조합을 갖춘 증명 중 하나라도 승인되면 approved / 조합 충족+미승인=pending / 조합 미충족=none(승인 무관)
 */
describe('identityRequiredMet', () => {
  it.each([
    [['resident', 'resident_copy'], true],
    [['driver', 'resident_copy'], true],
    [['resident'], false],
    [['resident_copy'], false],
    [['student', 'resident_copy'], false],
    [[], false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (types, expected) => {
    expect(identityRequiredMet(types as string[] | null | undefined)).toBe(expected)
  })
})

describe('foreignRequiredMet (체류 유형별 4종 전부)', () => {
  it('단기 4종 → true', () => {
    expect(foreignRequiredMet(['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'])).toBe(true)
  })
  it('장기 4종 → true', () => {
    expect(foreignRequiredMet(['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'])).toBe(true)
  })
  it('일부만(여권+숙소예약, 여권+등록증 앞뒷면) → false', () => {
    expect(foreignRequiredMet(['passport_photo', 'accommodation_reservation'])).toBe(false)
    expect(foreignRequiredMet(['passport_photo', 'arc_front', 'arc_back'])).toBe(false)
  })
  it('단기·장기가 섞여 각각 일부씩만 있으면 false', () => {
    expect(foreignRequiredMet(['passport_photo', 'accommodation_reservation', 'arc_front', 'arc_back'])).toBe(false)
  })
  it('null/빈 배열 → false', () => {
    expect(foreignRequiredMet(null)).toBe(false)
    expect(foreignRequiredMet([])).toBe(false)
  })
})

describe('getDocGateStatus', () => {
  const identityFull = { identity_doc_url: ['a', 'b'], identity_type: ['resident', 'resident_copy'] }
  it('null → none', () => expect(getDocGateStatus(null)).toBe('none'))
  it('파일은 있으나 type이 비어 있음 → none', () => {
    expect(getDocGateStatus({ identity_doc_url: ['a'], identity_type: [] })).toBe('none')
  })
  it('일부 파일만 + 승인됨 → none', () => {
    expect(getDocGateStatus({ identity_doc_url: ['a'], identity_type: ['resident'], identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z' })).toBe('none')
  })
  it('조합 충족 + 미승인 → pending', () => {
    expect(getDocGateStatus({ ...identityFull, identity_verified_at: '2026-10-01T00:00:00Z' })).toBe('pending')
  })
  it('조합 충족 + 승인(승인 ≥ 제출) → approved', () => {
    expect(getDocGateStatus({ ...identityFull, identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-01T00:00:00Z' })).toBe('approved')
  })
  it('승인 후 재제출(승인 < 제출) → pending', () => {
    expect(getDocGateStatus({ ...identityFull, identity_verified_at: '2026-10-02T00:00:00Z', identity_approved_at: '2026-10-01T00:00:00Z' })).toBe('pending')
  })
  it('본인증명 pending + 외국인증명 approved → approved', () => {
    expect(getDocGateStatus({
      ...identityFull, identity_verified_at: '2026-10-01T00:00:00Z',
      foreign_doc_urls: ['1', '2', '3', '4'], foreign_type: ['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'],
      foreign_verified_at: '2026-10-01T00:00:00Z', foreign_approved_at: '2026-10-02T00:00:00Z',
    })).toBe('approved')
  })
  it('외국인 3종만 + 승인됨 → none', () => {
    expect(getDocGateStatus({ foreign_doc_urls: ['1', '2', '3'], foreign_type: ['passport_photo', 'accommodation_reservation', 'entry_eticket'], foreign_verified_at: '2026-10-01T00:00:00Z', foreign_approved_at: '2026-10-02T00:00:00Z' })).toBe('none')
  })
})
