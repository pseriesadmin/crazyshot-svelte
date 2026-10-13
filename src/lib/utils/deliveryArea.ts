// 배송 허용지역 판정 — 장바구니·CMS·검증 API가 공유하는 단일 규칙.
// SQL 쪽 private.is_address_in_delivery_area(Migration 700)와 같은 규칙이어야 한다(두 곳을 함께 바꿀 것).
//
// 규칙
//  · 도로명 주소 앞부분("경기 의정부시 평화로…", 다음 우편번호 형식)에서 시/도·시군구를 읽는다.
//  · 시/도는 약칭(서울·경기·강원…)으로 통일한다 — 카카오맵 역지오코딩은 "경기도"처럼 긴 이름을 준다.
//  · 허용지역이 하나도 없으면 제한 없음(전체 허용).
//  · 허용지역의 sigungu가 비어 있으면 그 시/도 전체 허용.
//  · "성남시"로 등록하면 "성남시 분당구"도 허용(구 단위 등록은 그 구만).
//  · 허용지역에 우편번호 구간(zipRanges — 두발히어로 배송가능 우편번호 카탈로그, Migration #703)이 있고 주소의 우편번호를
//    알면, 그 구간 안의 우편번호만 통과한다(같은 시군구라도 배송 불가 동네 차단). 구간이 없는 지역(지도 클릭 등록 등)이나
//    우편번호를 모르는 경우는 시군구 단위로만 판정한다. SQL 함수(서버 최종 방어)는 우편번호를 받지 못해 시군구 단위다.

/** 우편번호 구간 [시작, 끝] (양 끝 포함, 숫자) */
export type ZipRange = readonly [number, number]

export interface DeliveryAreaLike {
  sido: string
  sigungu: string | null
  /** 이 지역의 배송 가능 우편번호 구간 — 없거나 비어 있으면 시군구 단위로만 판정 */
  zipRanges?: ReadonlyArray<ZipRange> | null
}

/** 다음 우편번호 위젯이 돌려주는 행정구역 정보 */
export interface PostcodeRegionInfo {
  sido: string
  sigungu: string
  sigunguCode: string
  bname: string
  bcode: string
}

export interface AddressRegion {
  sido: string | null
  sigungu: string | null
}

const SIDO_ALIASES: Record<string, string> = {
  서울: '서울', 서울시: '서울', 서울특별시: '서울',
  부산: '부산', 부산시: '부산', 부산광역시: '부산',
  대구: '대구', 대구시: '대구', 대구광역시: '대구',
  인천: '인천', 인천시: '인천', 인천광역시: '인천',
  광주: '광주', 광주시: '광주', 광주광역시: '광주',
  대전: '대전', 대전시: '대전', 대전광역시: '대전',
  울산: '울산', 울산시: '울산', 울산광역시: '울산',
  세종: '세종', 세종시: '세종', 세종특별자치시: '세종',
  경기: '경기', 경기도: '경기',
  강원: '강원', 강원도: '강원', 강원특별자치도: '강원',
  충북: '충북', 충청북도: '충북',
  충남: '충남', 충청남도: '충남',
  전북: '전북', 전라북도: '전북', 전북특별자치도: '전북',
  전남: '전남', 전라남도: '전남',
  경북: '경북', 경상북도: '경북',
  경남: '경남', 경상남도: '경남',
  제주: '제주', 제주도: '제주', 제주특별자치도: '제주',
}

export const SIDO_LIST: string[] = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
]

/** 시/도 이름을 약칭으로 통일. 알 수 없으면 null */
export function normalizeSido(raw: string | null | undefined): string | null {
  const key = (raw ?? '').trim().replace(/\s+/g, '')
  return SIDO_ALIASES[key] ?? null
}

function normalizeSigungu(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ')
  return v === '' ? null : v
}

/** 도로명 주소 앞부분에서 시/도·시군구 추출 */
export function parseAddressRegion(road: string | null | undefined): AddressRegion {
  const tokens = (road ?? '').trim().split(/\s+/).filter(Boolean)
  const sido = normalizeSido(tokens[0])
  if (!sido) return { sido: null, sigungu: null }
  if (sido === '세종') return { sido, sigungu: null }
  const second = tokens[1] ?? null
  if (!second) return { sido, sigungu: null }
  // "성남시 분당구"처럼 시 + 구 2단 구조
  const third = tokens[2] ?? null
  if (/시$/.test(second) && third && /구$/.test(third)) {
    return { sido, sigungu: `${second} ${third}` }
  }
  return { sido, sigungu: second }
}

/** 지역 표시 이름 (예: "경기 의정부시", "서울 전체") */
export function areaLabel(area: DeliveryAreaLike): string {
  return area.sigungu ? `${area.sido} ${area.sigungu}` : `${area.sido} 전체`
}

function matchesArea(region: AddressRegion, area: DeliveryAreaLike, postal: number | null): boolean {
  const aSido = normalizeSido(area.sido)
  if (!aSido || region.sido !== aSido) return false
  const aSigungu = normalizeSigungu(area.sigungu)
  if (aSigungu) {
    const r = region.sigungu
    if (!r) return false
    if (!(r === aSigungu || r.startsWith(`${aSigungu} `))) return false
  }
  // 우편번호 구간이 있는 지역은 우편번호를 아는 경우 구간 안에서만 통과
  if (postal !== null && area.zipRanges && area.zipRanges.length > 0) {
    return area.zipRanges.some(([from, to]) => postal >= from && postal <= to)
  }
  return true
}

function parsePostal(postal: string | null | undefined): number | null {
  const v = (postal ?? '').trim()
  return /^[0-9]{5}$/.test(v) ? Number(v) : null
}

/**
 * 도로명 주소가 배송 허용지역 안인지.
 * 허용지역이 없으면 제한 없음(true). 주소를 읽지 못하면(시/도 불명) 제한이 있을 때 false.
 */
export function isAddressInDeliveryArea(
  road: string | null | undefined,
  areas: ReadonlyArray<DeliveryAreaLike>,
  postalCode?: string | null,
): boolean {
  if (areas.length === 0) return true
  const region = parseAddressRegion(road)
  if (!region.sido) return false
  const postal = parsePostal(postalCode)
  return areas.some((a) => matchesArea(region, a, postal))
}

/** get_delivery_zip_ranges() 결과를 허용지역에 붙인다(시/도 이름은 약칭으로 비교) */
export function attachZipRanges<T extends DeliveryAreaLike>(
  areas: ReadonlyArray<T>,
  rows: ReadonlyArray<{ sido: string; sigungu: string; range_start: number; range_end: number }>,
): Array<T & { zipRanges: ZipRange[] | null }> {
  const byKey = new Map<string, ZipRange[]>()
  for (const r of rows) {
    const key = `${normalizeSido(r.sido) ?? r.sido}|${r.sigungu}`
    const list = byKey.get(key) ?? []
    list.push([r.range_start, r.range_end])
    byKey.set(key, list)
  }
  return areas.map((a) => {
    const key = `${normalizeSido(a.sido) ?? a.sido}|${normalizeSigungu(a.sigungu) ?? ''}`
    return { ...a, zipRanges: byKey.get(key) ?? null }
  })
}

/** 우편번호 구간 표시 문자열 — 가장 작은 번호 ~ 가장 큰 번호 (예: "13381~13638") */
export function zipRangeLabel(ranges: ReadonlyArray<ZipRange> | null | undefined): string | null {
  if (!ranges || ranges.length === 0) return null
  const min = Math.min(...ranges.map((r) => r[0]))
  const max = Math.max(...ranges.map((r) => r[1]))
  const pad = (n: number) => String(n).padStart(5, '0')
  return min === max ? pad(min) : `${pad(min)}~${pad(max)}`
}

/** 다음 우편번호/카카오 지역 정보를 허용지역 한 건 형태로 정리 (등록 UI용) */
export function toAreaFromRegionNames(
  sidoRaw: string | null | undefined,
  sigunguRaw: string | null | undefined,
): DeliveryAreaLike | null {
  const sido = normalizeSido(sidoRaw)
  if (!sido) return null
  if (sido === '세종') return { sido, sigungu: null }
  return { sido, sigungu: normalizeSigungu(sigunguRaw) }
}
