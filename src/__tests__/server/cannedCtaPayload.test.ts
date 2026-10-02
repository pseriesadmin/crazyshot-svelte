import { describe, it, expect } from 'vitest'
import { buildCannedCtaPayload } from '$lib/server/cannedCtaPayload'
import { isValidCtaUrl } from '$lib/utils/ctaUrl'

describe('isValidCtaUrl — CTA 링크 검증', () => {
  it('http(s) 절대 URL과 사이트 내부 경로만 허용', () => {
    for (const u of ['https://crazyshot.kr/help', 'http://a.co', '/help', '/products/abc?x=1']) {
      expect(isValidCtaUrl(u)).toBe(true)
    }
  })
  it('빈 값·javascript:·프로토콜 상대(//)·공백 포함·스킴 없음은 거부', () => {
    for (const u of ['', '   ', null, undefined, 'javascript:alert(1)', '//evil.com', 'crazyshot.kr', 'ftp://a.co', 'https://a b.com']) {
      expect(isValidCtaUrl(u as string)).toBe(false)
    }
  })
})

describe('buildCannedCtaPayload — 빠른답변 CTA → canned_cta 카드', () => {
  it('이미지·버튼·링크 모두 없으면 null(일반 텍스트)', () => {
    expect(buildCannedCtaPayload({ id: 'c1' })).toBeNull()
    expect(buildCannedCtaPayload({ id: 'c1', image_url: ' ', cta_label: '', cta_url: null })).toBeNull()
  })

  it('링크만 있어도 카드 — 버튼 텍스트는 기본값 "확인하기" (BLOCKING 회귀: 링크만 입력 시 소실)', () => {
    const p = buildCannedCtaPayload({ id: 'c1', cta_url: 'https://crazyshot.kr/help' })
    expect(p).toEqual({
      type: 'canned_cta',
      button_label: '확인하기',
      action_url: 'https://crazyshot.kr/help',
      product_image: null,
      canned_response_id: 'c1',
    })
  })

  it('버튼 텍스트·링크·이미지가 모두 payload에 실린다', () => {
    const p = buildCannedCtaPayload({ id: 'c2', image_url: 'img', cta_label: ' 자세히 보기 ', cta_url: ' /help ' })
    expect(p?.button_label).toBe('자세히 보기')
    expect(p?.action_url).toBe('/help')
    expect(p?.product_image).toBe('img')
  })

  it('유효하지 않은 링크는 action_url=null로 버린다(javascript: 차단)', () => {
    const p = buildCannedCtaPayload({ id: 'c3', cta_label: '열기', cta_url: 'javascript:alert(1)' })
    expect(p?.action_url).toBeNull()
    expect(p?.button_label).toBe('열기')
  })
})
