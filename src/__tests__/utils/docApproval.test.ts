import { describe, it, expect } from 'vitest'
import {
  identityRequiredMet,
  foreignRequiredMet,
  getDocGateStatus,
  missingIdentityDocs,
  missingForeignDocs,
  buildMissingDocsMessage,
  docLandingKind,
  DOC_GATE_MESSAGES,
} from '$lib/utils/docApproval'

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

describe('missingIdentityDocs / missingForeignDocs (2026-10-05 — 등록 직후 빠진 서류 안내)', () => {
  it('본인증명: 신분증만 → 주민등록등본 / 등본만 → 신분증 / 둘 다 없음 → 둘 다 / 충족 → 빈 배열', () => {
    expect(missingIdentityDocs(['resident'])).toEqual(['주민등록등본'])
    expect(missingIdentityDocs(['driver'])).toEqual(['주민등록등본'])
    expect(missingIdentityDocs(['resident_copy'])).toEqual(['주민등록증(또는 운전면허증)'])
    expect(missingIdentityDocs([])).toEqual(['주민등록증(또는 운전면허증)', '주민등록등본'])
    expect(missingIdentityDocs(null)).toEqual(['주민등록증(또는 운전면허증)', '주민등록등본'])
    expect(missingIdentityDocs(['resident', 'resident_copy'])).toEqual([])
    expect(missingIdentityDocs(['student', 'other'])).toEqual(['주민등록증(또는 운전면허증)', '주민등록등본'])
  })

  it('외국인증명: 단기 등록분 기준으로 빠진 항목만 반환(체류유형 힌트 없이도 판별)', () => {
    expect(missingForeignDocs(['passport_photo', 'accommodation_reservation'])).toEqual(['입국 E-Ticket', '출국 E-Ticket'])
    expect(missingForeignDocs(['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'])).toEqual([])
  })

  it('외국인증명: 장기 전용 서류가 있으면 장기 기준', () => {
    expect(missingForeignDocs(['arc_front'])).toEqual(['외국인등록증 뒷면', '여권사진면', '외국인사실증명서'])
    expect(missingForeignDocs(['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'])).toEqual([])
  })

  it('외국인증명: 공통 서류(여권)만·비어있으면 stayType 따름(기본 단기)', () => {
    expect(missingForeignDocs(['passport_photo'], 'long')).toEqual(['외국인등록증 앞면', '외국인등록증 뒷면', '외국인사실증명서'])
    expect(missingForeignDocs(['passport_photo'], 'short')).toEqual(['숙소예약확인서', '입국 E-Ticket', '출국 E-Ticket'])
    expect(missingForeignDocs([], null)).toEqual(['여권사진면', '숙소예약확인서', '입국 E-Ticket', '출국 E-Ticket'])
  })

  it('missing이 비어 있을 때와 필수 조합 충족 판정이 항상 일치(서버 안내=차단 판정)', () => {
    const idCases = [[], ['resident'], ['resident_copy'], ['resident', 'resident_copy'], ['driver', 'resident_copy']]
    for (const t of idCases) expect(missingIdentityDocs(t).length === 0).toBe(identityRequiredMet(t))
    const foCases = [[], ['passport_photo'], ['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'],
      ['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket']]
    for (const t of foCases) expect(missingForeignDocs(t).length === 0).toBe(foreignRequiredMet(t))
  })
})

describe('buildMissingDocsMessage', () => {
  it('받침에 따라 을/를을 고르고 여러 항목은 쉼표로 잇는다', () => {
    expect(buildMissingDocsMessage(['주민등록등본'])).toBe('주민등록등본을 추가 등록해주세요.')
    expect(buildMissingDocsMessage(['주민등록증(또는 운전면허증)'])).toBe('주민등록증(또는 운전면허증)을 추가 등록해주세요.')
    expect(buildMissingDocsMessage(['숙소예약확인서'])).toBe('숙소예약확인서를 추가 등록해주세요.')
    expect(buildMissingDocsMessage(['입국 E-Ticket', '출국 E-Ticket'])).toBe('입국 E-Ticket, 출국 E-Ticket를 추가 등록해주세요.')
    expect(buildMissingDocsMessage([])).toBe('')
  })
})

describe('docLandingKind / DOC_GATE_MESSAGES', () => {
  it('외국인증명만 등록(시작)한 고객은 foreign 탭으로, 그 외는 identity', () => {
    expect(docLandingKind(null)).toBe('identity')
    expect(docLandingKind({ identity_type: ['resident'] })).toBe('identity')
    expect(docLandingKind({ foreign_type: ['passport_photo'] })).toBe('foreign')
    expect(docLandingKind({ foreign_doc_urls: ['u'] })).toBe('foreign')
    expect(docLandingKind({ identity_type: ['resident'], foreign_type: ['passport_photo'] })).toBe('identity')
  })

  it('확정 문구(Stephen 2026-10-05)', () => {
    expect(DOC_GATE_MESSAGES.none).toBe('본인증명정보를 등록해주세요.')
    expect(DOC_GATE_MESSAGES.pending).toBe('본인증명정보를 승인 중입니다. 조금만 기다려 주세요.')
  })
})
