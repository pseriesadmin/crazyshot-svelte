import { describe, it, expect } from 'vitest'
import {
  CONSENT_KEYS,
  parseConsents,
  sha256Hex,
  buildConsentLog,
  buildEvidenceRow,
  normalizePolicies,
  type PolicyTexts,
} from '$lib/contract-signature/signatureEvidence'

const POLICIES: PolicyTexts = { terms: '이용정책 본문', refund: '환불규정 본문', privacy: '개인정보처리방침 본문' }
const ALL_CONSENTS = CONSENT_KEYS.map((key) => ({ key, checked: true }))

describe('parseConsents — 필수 동의 3종 서버 검증', () => {
  it('3종 모두 checked=true 이면 통과', () => {
    const r = parseConsents(ALL_CONSENTS)
    expect(r.ok).toBe(true)
  })

  it('필드 자체가 없으면(구버전 화면) 거부', () => {
    expect(parseConsents(undefined).ok).toBe(false)
    expect(parseConsents(null).ok).toBe(false)
  })

  it('배열이 아니면 거부', () => {
    expect(parseConsents('yes').ok).toBe(false)
    expect(parseConsents({ contract: true }).ok).toBe(false)
  })

  it('하나라도 빠지면 거부', () => {
    expect(parseConsents(ALL_CONSENTS.slice(0, 2)).ok).toBe(false)
  })

  it('checked가 true가 아니면 거부(문자열 "true"·1 포함)', () => {
    const bad = ALL_CONSENTS.map((c, i) => (i === 1 ? { ...c, checked: false } : c))
    expect(parseConsents(bad).ok).toBe(false)
    const truthy = ALL_CONSENTS.map((c, i) => (i === 0 ? { ...c, checked: 'true' } : c))
    expect(parseConsents(truthy).ok).toBe(false)
    const one = ALL_CONSENTS.map((c, i) => (i === 2 ? { ...c, checked: 1 } : c))
    expect(parseConsents(one).ok).toBe(false)
  })

  it('알 수 없는 키가 섞이면 거부', () => {
    expect(parseConsents([...ALL_CONSENTS, { key: 'marketing', checked: true }]).ok).toBe(false)
  })

  it('같은 키가 중복되면 거부', () => {
    expect(parseConsents([...ALL_CONSENTS, ALL_CONSENTS[0]]).ok).toBe(false)
  })

  it('거부 시 사용자에게 보일 안내 문구를 돌려준다', () => {
    const r = parseConsents(undefined)
    expect(r.ok === false && r.error.length > 0).toBe(true)
  })
})

describe('sha256Hex', () => {
  it('알려진 값과 일치한다(abc)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('한글도 UTF-8 기준으로 64자 16진수', async () => {
    expect(await sha256Hex('서명')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildConsentLog — 해시는 서버가 가진 텍스트 기준', () => {
  it('3개 항목(contract·privacy·terms_copy)을 순서대로 만든다', async () => {
    const log = await buildConsentLog({ contentHash: 'abc123', contractPrivacyText: '계약 개인정보 문단', policies: POLICIES })
    expect(log.map((e) => e.key)).toEqual(['contract', 'privacy', 'terms_copy'])
    expect(log.every((e) => e.checked === true)).toBe(true)
    expect(log.every((e) => e.label.length > 0)).toBe(true)
  })

  it('contract 항목은 서명 직전 스냅샷 해시를 그대로 쓴다', async () => {
    const log = await buildConsentLog({ contentHash: 'abc123', contractPrivacyText: null, policies: POLICIES })
    expect(log[0].text_sha256).toBe('abc123')
  })

  it('privacy 항목은 계약서 개인정보 문단의 해시, 없으면 빈 문자열의 해시', async () => {
    const withText = await buildConsentLog({ contentHash: null, contractPrivacyText: '문단', policies: POLICIES })
    expect(withText[1].text_sha256).toBe(await sha256Hex('문단'))
    const without = await buildConsentLog({ contentHash: null, contractPrivacyText: null, policies: POLICIES })
    expect(without[1].text_sha256).toBe(await sha256Hex(''))
  })

  it('terms_copy 항목은 약관 3종을 합친 해시이고, 하나라도 달라지면 해시가 달라진다', async () => {
    const a = await buildConsentLog({ contentHash: null, contractPrivacyText: null, policies: POLICIES })
    const b = await buildConsentLog({ contentHash: null, contractPrivacyText: null, policies: { ...POLICIES, refund: '환불규정 개정본' } })
    expect(a[2].text_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a[2].text_sha256).not.toBe(b[2].text_sha256)
  })
})

describe('buildEvidenceRow — 서명 이벤트 증적 행', () => {
  const base = {
    contractId: 'c-1',
    signingId: 's-1',
    reservationId: 253,
    signedAt: '2026-10-06T03:10:30.418Z',
    ipAddress: '211.234.198.124',
    userAgent: 'Mozilla/5.0 (iPhone)',
    contentHash: 'h0',
    contractPrivacyText: '개인정보 문단',
    policies: POLICIES,
    signatureData: 'data:image/png;base64,AAAA',
    finalHtml: '<td>박상진 (인)<img src="data:image/png;base64,AAAA"></td>',
  }

  it('모든 증거 필드를 채운다', async () => {
    const row = await buildEvidenceRow(base)
    expect(row.contract_id).toBe('c-1')
    expect(row.signing_id).toBe('s-1')
    expect(row.reservation_id).toBe(253)
    expect(row.signed_at).toBe('2026-10-06T03:10:30.418Z')
    expect(row.ip_address).toBe('211.234.198.124')
    expect(row.user_agent).toBe('Mozilla/5.0 (iPhone)')
    expect(row.content_hash).toBe('h0')
    expect(row.final_html_sha256).toBe(await sha256Hex(base.finalHtml!))
    expect(row.signature_image_sha256).toBe(await sha256Hex(base.signatureData!))
    expect(row.terms_text).toBe('이용정책 본문')
    expect(row.refund_text).toBe('환불규정 본문')
    expect(row.privacy_text).toBe('개인정보처리방침 본문')
    expect(row.terms_sha256).toBe(await sha256Hex('이용정책 본문'))
    expect((row.consent_log as unknown[]).length).toBe(3)
  })

  it('최종 HTML이 없으면(합성 실패·비html 모드) final_html_sha256은 NULL', async () => {
    const row = await buildEvidenceRow({ ...base, finalHtml: null })
    expect(row.final_html_sha256).toBeNull()
  })

  it('User-Agent는 512자로 자르고, 없으면 NULL', async () => {
    const long = await buildEvidenceRow({ ...base, userAgent: 'x'.repeat(2000) })
    expect((long.user_agent as string).length).toBe(512)
    const none = await buildEvidenceRow({ ...base, userAgent: null })
    expect(none.user_agent).toBeNull()
  })

  it('서명 이미지가 없으면 signature_image_sha256은 NULL', async () => {
    const row = await buildEvidenceRow({ ...base, signatureData: null })
    expect(row.signature_image_sha256).toBeNull()
  })
})

describe('약관을 읽지 못했거나 전부 비어 있을 때(policies = null) — 빈 문자열 해시로 위장하지 않는다', () => {
  it('buildConsentLog: terms_copy 항목의 해시는 null이고 출처에 "unavailable"을 남긴다', async () => {
    const log = await buildConsentLog({ contentHash: 'h', contractPrivacyText: null, policies: null })
    expect(log[2].key).toBe('terms_copy')
    expect(log[2].text_sha256).toBeNull()
    expect(log[2].source).toContain('unavailable')
  })

  it('buildEvidenceRow: 약관 원문·해시 6개 컬럼이 전부 NULL', async () => {
    const row = await buildEvidenceRow({
      contractId: 'c', signingId: 's', reservationId: 1, signedAt: '2026-10-06T00:00:00.000Z',
      ipAddress: null, userAgent: null, contentHash: 'h', contractPrivacyText: null,
      policies: null, signatureData: null, finalHtml: null,
    })
    expect(row.terms_text).toBeNull()
    expect(row.refund_text).toBeNull()
    expect(row.privacy_text).toBeNull()
    expect(row.terms_sha256).toBeNull()
    expect(row.refund_sha256).toBeNull()
    expect(row.privacy_sha256).toBeNull()
  })
})

describe('normalizePolicies — 약관 조회 결과를 증적용으로 정리', () => {
  it('조회 오류면 null', () => {
    expect(normalizePolicies(null, true)).toBeNull()
  })
  it('행이 없으면 null', () => {
    expect(normalizePolicies(null, false)).toBeNull()
  })
  it('세 항목이 모두 비어(공백 포함) 있으면 null', () => {
    expect(normalizePolicies({ terms_text: '', refund_text: '  ', privacy_text: null }, false)).toBeNull()
  })
  it('하나라도 내용이 있으면 그대로 반환하되, 비어 있는 항목은 빈 문자열(등록 안 됨이라는 사실)로 유지', () => {
    expect(normalizePolicies({ terms_text: '정책', refund_text: null, privacy_text: '' }, false))
      .toEqual({ terms: '정책', refund: '', privacy: '' })
  })
})
