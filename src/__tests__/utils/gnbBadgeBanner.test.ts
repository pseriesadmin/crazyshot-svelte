import { describe, it, expect } from 'vitest'
import { normalizeGnbBadge, pickBadgeIndex, safeBadgeLink } from '$lib/utils/gnbBadgeBanner'

describe('safeBadgeLink', () => {
  it('같은 사이트 경로와 https만 허용', () => {
    expect(safeBadgeLink('/products')).toBe('/products')
    expect(safeBadgeLink('https://crazyshot.kr/a')).toBe('https://crazyshot.kr/a')
  })
  it('위험한 주소는 빈 값', () => {
    expect(safeBadgeLink('javascript:alert(1)')).toBe('')
    expect(safeBadgeLink('//evil.com')).toBe('')
    expect(safeBadgeLink('http://a.com')).toBe('')
    expect(safeBadgeLink('/\\evil')).toBe('')
    expect(safeBadgeLink(123)).toBe('')
    expect(safeBadgeLink('')).toBe('')
  })
})

describe('normalizeGnbBadge', () => {
  it('깨진 값은 빈 목록·랜덤', () => {
    expect(normalizeGnbBadge(null)).toEqual({ items: [], mode: 'random' })
    expect(normalizeGnbBadge({ items: 'x', mode: 'zzz' })).toEqual({ items: [], mode: 'random' })
  })
  it('이미지 주소가 안전하지 않은 항목은 버리고 링크는 걸러낸다', () => {
    const out = normalizeGnbBadge({
      mode: 'sequential',
      items: [
        { id: 'a', url: 'https://x.co/a.png', path: 'p/a.png', link: 'javascript:1' },
        { id: 'b', url: 'javascript:alert(1)', path: 'p/b.png', link: '/x' },
        { url: 'https://x.co/c.svg', link: '/products' },
      ],
    })
    expect(out.mode).toBe('sequential')
    expect(out.items.map((i) => i.url)).toEqual(['https://x.co/a.png', 'https://x.co/c.svg'])
    expect(out.items[0].link).toBe('')
    expect(out.items[1].link).toBe('/products')
  })
})

describe('pickBadgeIndex', () => {
  it('등록이 없으면 -1', () => {
    expect(pickBadgeIndex(0, 'random', null)).toBe(-1)
  })
  it('순서 노출: 처음은 0, 이후 1씩 증가하고 끝에서 처음으로', () => {
    expect(pickBadgeIndex(3, 'sequential', null)).toBe(0)
    expect(pickBadgeIndex(3, 'sequential', 0)).toBe(1)
    expect(pickBadgeIndex(3, 'sequential', 2)).toBe(0)
  })
  it('순서 노출: 개수가 줄어 저장 순번이 범위를 벗어나도 안전', () => {
    expect(pickBadgeIndex(2, 'sequential', 7)).toBe(0)
    expect(pickBadgeIndex(2, 'sequential', -1)).toBe(0)
  })
  it('랜덤 노출은 범위 안', () => {
    expect(pickBadgeIndex(3, 'random', null, () => 0)).toBe(0)
    expect(pickBadgeIndex(3, 'random', null, () => 0.999)).toBe(2)
    expect(pickBadgeIndex(3, 'random', null, () => 1)).toBe(2)
  })
})
