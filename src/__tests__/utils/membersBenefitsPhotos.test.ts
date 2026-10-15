import { describe, it, expect } from 'vitest'
import {
  BENEFITS_DEFAULT_FOCUS,
  BENEFITS_DEFAULT_SRC,
  clampPercent,
  compactBenefitsPhoto,
  normalizeBenefitsPhotos,
  resolveBenefitsPhoto,
} from '$lib/utils/membersBenefitsPhotos'

describe('clampPercent', () => {
  it('0~100 으로 자르고 반올림한다', () => {
    expect(clampPercent(-5, 50)).toBe(0)
    expect(clampPercent(140, 50)).toBe(100)
    expect(clampPercent(33.6, 50)).toBe(34)
  })
  it('숫자가 아니면 기본값', () => {
    expect(clampPercent('abc', 42)).toBe(42)
    expect(clampPercent(undefined, 42)).toBe(42)
    expect(clampPercent(NaN, 42)).toBe(42)
    expect(clampPercent('70', 42)).toBe(70)
  })
})

describe('normalizeBenefitsPhotos', () => {
  it('값이 없거나 깨져 있으면 두 사진 모두 null(기본 사진·기본 초점)', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}]) {
      expect(normalizeBenefitsPhotos(raw)).toEqual({ top: null, bottom: null })
    }
  })

  it('이미지도 초점도 없는 빈 항목은 null', () => {
    const r = normalizeBenefitsPhotos({ top: {}, bottom: { url: '', path: '' } })
    expect(r).toEqual({ top: null, bottom: null })
  })

  it('url 과 path 가 둘 다 있어야 업로드 사진으로 본다(한쪽만 있으면 이미지 없음 취급)', () => {
    const r = normalizeBenefitsPhotos({
      top: { url: 'https://x/a.png', path: '', x: 10, y: 20 },
      bottom: { url: '', path: 'p/b.png', x: 30, y: 40 },
    })
    expect(r.top).toEqual({ url: null, path: null, x: 10, y: 20 })
    expect(r.bottom).toEqual({ url: null, path: null, x: 30, y: 40 })
  })

  it('정상 업로드 항목은 유지하고 초점은 범위로 보정한다', () => {
    const r = normalizeBenefitsPhotos({
      top: { url: 'https://x/a.png', path: 'members/a.png', x: 120, y: -3 },
      bottom: { url: 'https://x/b.png', path: 'members/b.png', x: 10, y: 90 },
    })
    expect(r.top).toEqual({ url: 'https://x/a.png', path: 'members/a.png', x: 100, y: 0 })
    expect(r.bottom).toEqual({ url: 'https://x/b.png', path: 'members/b.png', x: 10, y: 90 })
  })

  it('초점이 없으면 슬롯별 기본 초점을 쓴다', () => {
    const r = normalizeBenefitsPhotos({
      top: { url: 'https://x/a.png', path: 'p/a.png' },
      bottom: { url: 'https://x/b.png', path: 'p/b.png' },
    })
    expect(r.top).toMatchObject(BENEFITS_DEFAULT_FOCUS.top)
    expect(r.bottom).toMatchObject(BENEFITS_DEFAULT_FOCUS.bottom)
  })

  it('초점만 있는 항목(기본 사진 + 초점 조정)을 허용한다', () => {
    const r = normalizeBenefitsPhotos({ top: { x: 20, y: 80 } })
    expect(r.top).toEqual({ url: null, path: null, x: 20, y: 80 })
    expect(r.bottom).toBeNull()
  })
})

describe('resolveBenefitsPhoto', () => {
  it('설정이 없으면 기본 사진·기본 초점', () => {
    const s = normalizeBenefitsPhotos(null)
    expect(resolveBenefitsPhoto(s, 'top')).toEqual({
      src: BENEFITS_DEFAULT_SRC.top, ...BENEFITS_DEFAULT_FOCUS.top, isCustom: false,
    })
    expect(resolveBenefitsPhoto(s, 'bottom')).toEqual({
      src: BENEFITS_DEFAULT_SRC.bottom, ...BENEFITS_DEFAULT_FOCUS.bottom, isCustom: false,
    })
  })

  it('업로드 사진이 있으면 그 사진·저장된 초점', () => {
    const s = normalizeBenefitsPhotos({ top: { url: 'https://x/a.png', path: 'p/a.png', x: 30, y: 70 } })
    expect(resolveBenefitsPhoto(s, 'top')).toEqual({ src: 'https://x/a.png', x: 30, y: 70, isCustom: true })
  })

  it('초점만 조정한 경우 기본 사진 + 저장된 초점', () => {
    const s = normalizeBenefitsPhotos({ bottom: { x: 10, y: 90 } })
    expect(resolveBenefitsPhoto(s, 'bottom')).toEqual({
      src: BENEFITS_DEFAULT_SRC.bottom, x: 10, y: 90, isCustom: false,
    })
  })
})

describe('compactBenefitsPhoto', () => {
  it('기본 사진 + 기본 초점이면 null 로 정리한다', () => {
    const def = BENEFITS_DEFAULT_FOCUS.top
    expect(compactBenefitsPhoto({ url: null, path: null, ...def }, 'top')).toBeNull()
    expect(compactBenefitsPhoto(null, 'top')).toBeNull()
  })

  it('업로드 사진이 있거나 초점이 기본과 다르면 유지한다', () => {
    const custom = { url: 'https://x/a.png', path: 'p/a.png', ...BENEFITS_DEFAULT_FOCUS.top }
    expect(compactBenefitsPhoto(custom, 'top')).toEqual(custom)
    const moved = { url: null, path: null, x: 1, y: 2 }
    expect(compactBenefitsPhoto(moved, 'top')).toEqual(moved)
  })
})
