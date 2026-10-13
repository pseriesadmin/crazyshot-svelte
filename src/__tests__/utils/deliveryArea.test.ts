import { describe, it, expect } from 'vitest'
import {
  normalizeSido,
  parseAddressRegion,
  isAddressInDeliveryArea,
  toAreaFromRegionNames,
  areaLabel,
  attachZipRanges,
  zipRangeLabel,
} from '$lib/utils/deliveryArea'

describe('normalizeSido', () => {
  it('긴 이름·약칭을 약칭으로 통일한다', () => {
    expect(normalizeSido('경기도')).toBe('경기')
    expect(normalizeSido('경기')).toBe('경기')
    expect(normalizeSido('서울특별시')).toBe('서울')
    expect(normalizeSido('강원특별자치도')).toBe('강원')
    expect(normalizeSido('전북특별자치도')).toBe('전북')
    expect(normalizeSido('충청남도')).toBe('충남')
    expect(normalizeSido('제주특별자치도')).toBe('제주')
  })
  it('알 수 없으면 null', () => {
    expect(normalizeSido('아무데나')).toBeNull()
    expect(normalizeSido('')).toBeNull()
    expect(normalizeSido(null)).toBeNull()
  })
})

describe('parseAddressRegion', () => {
  it('다음 우편번호 형식(약칭 + 시군구)을 읽는다', () => {
    expect(parseAddressRegion('경기 의정부시 평화로568번길 45')).toEqual({ sido: '경기', sigungu: '의정부시' })
    expect(parseAddressRegion('서울 강남구 테헤란로 1')).toEqual({ sido: '서울', sigungu: '강남구' })
  })
  it('시 + 구 2단 구조', () => {
    expect(parseAddressRegion('경기 성남시 분당구 판교역로 1')).toEqual({ sido: '경기', sigungu: '성남시 분당구' })
  })
  it('세종은 시군구 없음', () => {
    expect(parseAddressRegion('세종특별자치시 한누리대로 2130')).toEqual({ sido: '세종', sigungu: null })
  })
  it('읽을 수 없으면 null', () => {
    expect(parseAddressRegion('')).toEqual({ sido: null, sigungu: null })
    expect(parseAddressRegion('모르는 주소')).toEqual({ sido: null, sigungu: null })
  })
})

describe('isAddressInDeliveryArea', () => {
  const areas = [
    { sido: '서울', sigungu: null },
    { sido: '경기', sigungu: '의정부시' },
    { sido: '경기', sigungu: '성남시' },
    { sido: '경기', sigungu: '고양시 일산동구' },
  ]
  it('허용지역이 없으면 제한 없음', () => {
    expect(isAddressInDeliveryArea('부산 해운대구 1', [])).toBe(true)
    expect(isAddressInDeliveryArea('', [])).toBe(true)
  })
  it('시/도 전체 등록은 그 시/도 전체 허용', () => {
    expect(isAddressInDeliveryArea('서울 노원구 1', areas)).toBe(true)
  })
  it('시군구 등록은 그 시군구만 허용', () => {
    expect(isAddressInDeliveryArea('경기 의정부시 평화로568번길 45', areas)).toBe(true)
    expect(isAddressInDeliveryArea('경기 양주시 1', areas)).toBe(false)
  })
  it('시 단위 등록은 그 시의 구도 허용, 구 단위 등록은 그 구만', () => {
    expect(isAddressInDeliveryArea('경기 성남시 분당구 판교역로 1', areas)).toBe(true)
    expect(isAddressInDeliveryArea('경기 고양시 일산동구 1', areas)).toBe(true)
    expect(isAddressInDeliveryArea('경기 고양시 덕양구 1', areas)).toBe(false)
  })
  it('다른 시/도·읽을 수 없는 주소는 차단', () => {
    expect(isAddressInDeliveryArea('부산 해운대구 1', areas)).toBe(false)
    expect(isAddressInDeliveryArea('모르는 주소', areas)).toBe(false)
  })
  it('시도 이름이 긴 형태로 등록돼도 약칭 주소와 일치', () => {
    expect(isAddressInDeliveryArea('경기 의정부시 1', [{ sido: '경기도', sigungu: '의정부시' }])).toBe(true)
  })
})

describe('toAreaFromRegionNames / areaLabel', () => {
  it('카카오 역지오코딩 이름을 정리한다', () => {
    expect(toAreaFromRegionNames('경기도', '의정부시')).toEqual({ sido: '경기', sigungu: '의정부시' })
    expect(toAreaFromRegionNames('세종특별자치시', '')).toEqual({ sido: '세종', sigungu: null })
    expect(toAreaFromRegionNames('없는곳', 'x')).toBeNull()
  })
  it('표시 이름', () => {
    expect(areaLabel({ sido: '서울', sigungu: null })).toBe('서울 전체')
    expect(areaLabel({ sido: '경기', sigungu: '의정부시' })).toBe('경기 의정부시')
  })
})

describe('우편번호 구간 정밀 판정', () => {
  const rows = [
    { sido: '경기', sigungu: '성남시 분당구', range_start: 13440, range_end: 13441 },
    { sido: '경기', sigungu: '성남시 분당구', range_start: 13454, range_end: 13592 },
  ]
  const areas = attachZipRanges(
    [
      { sido: '경기', sigungu: '성남시 분당구' },
      { sido: '서울', sigungu: '강남구' }, // 카탈로그 구간 없음 → 시군구 단위
    ],
    rows,
  )
  it('구간이 붙는 지역과 안 붙는 지역', () => {
    expect(areas[0].zipRanges).toEqual([[13440, 13441], [13454, 13592]])
    expect(areas[1].zipRanges).toBeNull()
  })
  it('구간 안 우편번호는 통과, 구간 밖(같은 시군구)은 차단', () => {
    expect(isAddressInDeliveryArea('경기 성남시 분당구 서판교로 32', areas, '13479')).toBe(true)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 서판교로 32', areas, '13441')).toBe(true)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 어딘가 1', areas, '13500')).toBe(true)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 어딘가 1', areas, '13450')).toBe(false)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 어딘가 1', areas, '13700')).toBe(false)
  })
  it('우편번호를 모르거나 형식이 틀리면 시군구 단위로만 판정', () => {
    expect(isAddressInDeliveryArea('경기 성남시 분당구 서판교로 32', areas)).toBe(true)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 서판교로 32', areas, '')).toBe(true)
    expect(isAddressInDeliveryArea('경기 성남시 분당구 서판교로 32', areas, '1347')).toBe(true)
  })
  it('구간이 없는 지역은 우편번호와 무관하게 시군구 단위', () => {
    expect(isAddressInDeliveryArea('서울 강남구 테헤란로 1', areas, '99999')).toBe(true)
  })
  it('다른 지역은 우편번호가 구간 안이어도 차단', () => {
    expect(isAddressInDeliveryArea('경기 양주시 1', areas, '13479')).toBe(false)
  })
  it('범위 표시 문자열', () => {
    expect(zipRangeLabel(areas[0].zipRanges)).toBe('13440~13592')
    expect(zipRangeLabel([[1000, 1000]])).toBe('01000')
    expect(zipRangeLabel(null)).toBeNull()
  })
})
