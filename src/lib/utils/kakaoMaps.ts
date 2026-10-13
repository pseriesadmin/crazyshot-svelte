// 카카오맵 JavaScript SDK 지연 로더 (CMS 배송지역 관리용).
// 키: PUBLIC_KAKAO_MAP_KEY (카카오 개발자 콘솔 JavaScript 키 + 사이트 도메인 등록 필요).
// 키가 없으면 isKakaoMapConfigured()가 false → 지도 UI만 비활성화하고 나머지 기능은 그대로 동작한다.
import { env } from '$env/dynamic/public'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type KakaoNamespace = any

export function isKakaoMapConfigured(): boolean {
  return Boolean(env.PUBLIC_KAKAO_MAP_KEY)
}

let loading: Promise<KakaoNamespace> | null = null

/** SDK를 한 번만 불러온다(autoload=false → kakao.maps.load). services 라이브러리(역지오코딩) 포함. */
export function loadKakaoMaps(): Promise<KakaoNamespace> {
  const w = window as unknown as { kakao?: KakaoNamespace }
  if (w.kakao?.maps?.services) return Promise.resolve(w.kakao)
  if (loading) return loading
  const key = env.PUBLIC_KAKAO_MAP_KEY
  if (!key) return Promise.reject(new Error('no_key'))

  loading = new Promise<KakaoNamespace>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`
    s.async = true
    s.onload = () => {
      const k = (window as unknown as { kakao?: KakaoNamespace }).kakao
      if (!k?.maps) { loading = null; reject(new Error('load_fail')); return }
      k.maps.load(() => resolve(k))
    }
    s.onerror = () => { loading = null; reject(new Error('load_fail')) }
    document.head.appendChild(s)
  })
  return loading
}

export interface ReverseRegion {
  sido: string
  sigungu: string
}

/** 좌표 → 행정구역(법정동 기준 시/도·시군구). 못 찾으면 null */
export function reverseRegion(kakao: KakaoNamespace, lat: number, lng: number): Promise<ReverseRegion | null> {
  return new Promise((resolve) => {
    const geocoder = new kakao.maps.services.Geocoder()
    geocoder.coord2RegionCode(lng, lat, (result: Array<{ region_type: string; region_1depth_name: string; region_2depth_name: string }>, status: string) => {
      if (status !== kakao.maps.services.Status.OK || !result?.length) { resolve(null); return }
      const r = result.find((x) => x.region_type === 'B') ?? result[0]
      resolve({ sido: r.region_1depth_name, sigungu: r.region_2depth_name })
    })
  })
}

/** "경기 의정부시" 같은 지역 이름 → 좌표(마커 표시용). 못 찾으면 null */
export function geocodeRegion(kakao: KakaoNamespace, query: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const places = new kakao.maps.services.Places()
    places.keywordSearch(query, (data: Array<{ y: string; x: string }>, status: string) => {
      if (status !== kakao.maps.services.Status.OK || !data?.length) { resolve(null); return }
      resolve({ lat: Number(data[0].y), lng: Number(data[0].x) })
    })
  })
}
