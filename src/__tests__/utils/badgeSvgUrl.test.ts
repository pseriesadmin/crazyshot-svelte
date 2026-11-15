import { describe, it, expect } from 'vitest'
import { isBadgeSvgUrl } from '$lib/utils/badgeSvgUrl'

const OK = 'https://ezyvffjvuwmtuhpxdjrw.supabase.co/storage/v1/object/public/badge-icons/badges/123e4567-e89b-12d3-a456-426614174000.svg'

describe('isBadgeSvgUrl — 배지 SVG 주소는 배지 버킷 주소만 허용', () => {
  it('배지 버킷의 업로드 파일 주소는 통과한다', () => {
    expect(isBadgeSvgUrl(OK)).toBe(true)
  })

  it('외부 주소·다른 버킷·다른 경로·다른 확장자는 거절한다', () => {
    expect(isBadgeSvgUrl('https://evil.example/x.svg')).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('badge-icons', 'product-images'))).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('/badges/', '/other/'))).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('.svg', '.png'))).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('https://', 'http://'))).toBe(false)
    expect(isBadgeSvgUrl('javascript:alert(1)')).toBe(false)
    expect(isBadgeSvgUrl('')).toBe(false)
  })

  it('다른 Supabase 프로젝트의 같은 경로는 거절하고 Production 호스트는 허용한다', () => {
    expect(isBadgeSvgUrl(OK.replace('ezyvffjvuwmtuhpxdjrw', 'otherproject123456'))).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('ezyvffjvuwmtuhpxdjrw', 'vnbpmvxruyciuuaermyh'))).toBe(true)
  })

  it('호스트 위장(.supabase.co 가 호스트 끝이 아닌 경우)과 경로 조작을 거절한다', () => {
    expect(isBadgeSvgUrl('https://x.supabase.co.evil.example/storage/v1/object/public/badge-icons/badges/123e4567-e89b-12d3-a456-426614174000.svg')).toBe(false)
    expect(isBadgeSvgUrl(OK + '?x=1')).toBe(false)
    expect(isBadgeSvgUrl(OK.replace('badges/', 'badges/../'))).toBe(false)
  })
})
