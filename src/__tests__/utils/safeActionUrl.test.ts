import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safeActionUrl } from '$lib/utils/safeActionUrl'

// 상담 액션 카드의 버튼 주소 검사 (2026-10-24 sp5 SEC-001 — 위조·오입력 카드의 javascript: 주소가 관리자/고객 화면에서 실행되는 것을 막는다)
describe('safeActionUrl', () => {
  it('자사 내부 경로는 그대로 통과한다', () => {
    expect(safeActionUrl('/account/rental/12/history')).toBe('/account/rental/12/history')
    expect(safeActionUrl('/cms/customers?post=3#a')).toBe('/cms/customers?post=3#a')
  })

  it('http·https 절대 주소는 통과한다 (관리자가 직접 입력하는 외부 링크)', () => {
    expect(safeActionUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeActionUrl('http://example.com')).toBe('http://example.com')
  })

  it('스크립트·데이터 등 실행 가능한 주소는 거절한다', () => {
    expect(safeActionUrl('javascript:alert(1)')).toBeNull()
    expect(safeActionUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeActionUrl('  javascript:alert(1)')).toBeNull()
    expect(safeActionUrl('java\tscript:alert(1)')).toBeNull()
    expect(safeActionUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeActionUrl('vbscript:msgbox(1)')).toBeNull()
    expect(safeActionUrl('file:///etc/passwd')).toBeNull()
  })

  it('프로토콜 상대 주소·백슬래시·제어문자는 거절한다', () => {
    expect(safeActionUrl('//evil.com/x')).toBeNull()
    expect(safeActionUrl('/\\evil.com')).toBeNull()
    expect(safeActionUrl('/ok\nnext')).toBeNull()
    expect(safeActionUrl('https://a.com/\u0000')).toBeNull()
  })

  it('빈 값·비문자·주소 형식이 아닌 값은 null', () => {
    expect(safeActionUrl(null)).toBeNull()
    expect(safeActionUrl(undefined)).toBeNull()
    expect(safeActionUrl('')).toBeNull()
    expect(safeActionUrl('   ')).toBeNull()
    expect(safeActionUrl('example.com')).toBeNull()
    expect(safeActionUrl('https://')).toBeNull()
    expect(safeActionUrl(123 as unknown as string)).toBeNull()
  })

  it('ActionCard 는 payload.action_url 을 이 검사를 거쳐서만 사용한다', () => {
    const src = readFileSync('src/lib/components/chat/ActionCard.svelte', 'utf8')
    expect(src).toContain("from '$lib/utils/safeActionUrl'")
    expect(src).toMatch(/ctaUrl\s*=\s*\$derived\(safeActionUrl\(payload\.action_url\)\)/)
    // 검사를 거치지 않은 원본 주소를 직접 열거나 링크에 쓰는 곳이 없어야 한다
    expect(src).not.toMatch(/location\.href\s*=\s*payload\.action_url/)
    expect(src).not.toMatch(/window\.open\(\s*payload\.action_url/)
    expect(src).not.toMatch(/href=\{payload\.action_url\}/)
    expect(src).not.toMatch(/goto\(\s*payload\.action_url/)
  })
})
