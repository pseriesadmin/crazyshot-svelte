import { describe, it, expect } from 'vitest'
import { loadMobileImageMap, pickMobileRepresentativeImage } from '$lib/server/productMobileImages'

const PC = ['https://x/pc1.webp', 'https://x/pc2.webp']

describe('pickMobileRepresentativeImage', () => {
  it('모바일 대표(primary)가 있으면 그것을 쓴다(PC 첫 이미지와 짝이 아니어도)', () => {
    const m = [
      { src: PC[0], url: 'https://x/m1.webp', enabled: true, primary: false },
      { src: PC[1], url: 'https://x/m2.webp', enabled: true, primary: true },
    ]
    expect(pickMobileRepresentativeImage(PC, m)).toBe('https://x/m2.webp')
  })

  it('대표 지정이 없으면 PC 첫 이미지와 짝지어진 모바일 이미지를 쓴다', () => {
    const m = [{ src: PC[1], url: 'https://x/m2.webp' }, { src: PC[0], url: 'https://x/m1.webp' }]
    expect(pickMobileRepresentativeImage(PC, m)).toBe('https://x/m1.webp')
  })

  it('PC 첫 이미지와 짝인 모바일 이미지가 없으면 null(PC 이미지 그대로)', () => {
    expect(pickMobileRepresentativeImage(PC, [{ src: PC[1], url: 'https://x/m2.webp' }])).toBeNull()
  })

  it('사용 안 함(enabled=false)·주소 없음은 제외한다', () => {
    const m = [
      { src: PC[0], url: 'https://x/m1.webp', enabled: false, primary: true },
      { src: PC[0], url: '' },
    ]
    expect(pickMobileRepresentativeImage(PC, m)).toBeNull()
  })

  it('형식이 이상하면 null', () => {
    expect(pickMobileRepresentativeImage(PC, null)).toBeNull()
    expect(pickMobileRepresentativeImage(null, [{ src: PC[0], url: 'u' }])).toBeNull()
    expect(pickMobileRepresentativeImage(PC, 'x')).toBeNull()
  })
})

describe('loadMobileImageMap', () => {
  const client = (result: { data: unknown; error: unknown } | Error) => ({
    from: () => ({
      select: () => ({
        in: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
      }),
    }),
  })

  it('상품별 모바일 대표 이미지 주소 맵을 만든다(없는 상품은 키 없음)', async () => {
    const map = await loadMobileImageMap(
      client({
        data: [
          { id: 'a', image_urls: PC, mobile_images: [{ src: PC[0], url: 'https://x/ma.webp' }] },
          { id: 'b', image_urls: PC, mobile_images: [] },
        ],
        error: null,
      }),
      ['a', 'b', null, 'a'],
    )
    expect(map).toEqual({ a: 'https://x/ma.webp' })
  })

  it('조회 실패·예외는 빈 맵(fail-soft)', async () => {
    expect(await loadMobileImageMap(client({ data: null, error: { message: 'x' } }), ['a'])).toEqual({})
    expect(await loadMobileImageMap(client(new Error('boom')), ['a'])).toEqual({})
  })

  it('id가 없으면 조회하지 않고 빈 맵', async () => {
    expect(await loadMobileImageMap({}, [null, undefined, ''])).toEqual({})
  })
})
