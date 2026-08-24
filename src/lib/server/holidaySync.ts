import type { SupabaseClient } from '@supabase/supabase-js'

// 공공데이터포털 특일 정보(한국천문연구원) API — getRestDeInfo(실제 쉬는 날만 반환).
// https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService
const HOLIDAY_API_BASE = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'

interface RestDeInfoItem {
  dateName: string
  isHoliday: string // 'Y' | 'N'
  locdate: number // YYYYMMDD
}

interface RestDeInfoResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: {
      items?: { item?: RestDeInfoItem | RestDeInfoItem[] } | ''
      totalCount?: number
    }
  }
}

function toYmd(locdate: number): string {
  const s = String(locdate)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

async function fetchMonthHolidays(apiKey: string, year: number, month: number): Promise<{ date: string; name: string }[]> {
  // ServiceKey는 공공데이터포털이 이미 퍼센트 인코딩된 값("인코딩" 키, 예: ...%3D%3D)으로
  // 발급한다 — URLSearchParams.set()에 넣으면 다시 인코딩되어(%→%25) 키가 깨지므로,
  // 나머지 파라미터만 URLSearchParams로 만들고 ServiceKey는 이미 인코딩된 그대로 붙인다.
  const url = new URL(HOLIDAY_API_BASE)
  url.searchParams.set('solYear', String(year))
  url.searchParams.set('solMonth', String(month).padStart(2, '0'))
  url.searchParams.set('_type', 'json')
  url.searchParams.set('numOfRows', '20')

  const res = await fetch(`${url.toString()}&ServiceKey=${apiKey}`)
  if (!res.ok) throw new Error(`공휴일 API 응답 오류(${res.status}) — ${year}-${String(month).padStart(2, '0')}`)

  const data = (await res.json()) as RestDeInfoResponse
  const resultCode = data.response?.header?.resultCode
  if (resultCode && resultCode !== '00') {
    throw new Error(`공휴일 API 오류(${resultCode}) — ${data.response?.header?.resultMsg ?? ''}`)
  }

  const rawItems = data.response?.body?.items
  if (!rawItems) return []
  const items = Array.isArray(rawItems.item) ? rawItems.item : rawItems.item ? [rawItems.item] : []

  return items
    .filter((it) => it.isHoliday === 'Y')
    .map((it) => ({ date: toYmd(it.locdate), name: it.dateName }))
}

export interface SyncNationalHolidaysResult {
  upserted: number
  years: number[]
}

// 올해+내년, 1~12월 전부 순회해 법정공휴일을 동기화한다. DATA_GO_KR_HOLIDAY_API_KEY가
// 없으면 서비스가 죽지 않도록 조용히 스킵(fail-soft) — 기존 시딩 데이터로 계속 서비스.
export async function syncNationalHolidays(
  admin: SupabaseClient,
  apiKey: string | undefined,
  now: Date = new Date()
): Promise<SyncNationalHolidaysResult> {
  if (!apiKey) {
    console.warn('[holidaySync] DATA_GO_KR_HOLIDAY_API_KEY 미설정 — 동기화 스킵(기존 데이터 유지)')
    return { upserted: 0, years: [] }
  }

  const years = [now.getFullYear(), now.getFullYear() + 1]
  const monthPromises: Promise<{ date: string; name: string }[]>[] = []
  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      monthPromises.push(fetchMonthHolidays(apiKey, year, month))
    }
  }

  const monthResults = await Promise.all(monthPromises)
  const holidays = monthResults.flat()

  if (holidays.length === 0) return { upserted: 0, years }

  // 동기화 의도 범위를 배치 데이터가 아닌 여기서 명시적으로 전달 — 배치가 우연히
  // 좁아져도(예: 특정 달만 재동기화) 대체공휴일 정정 감지 범위가 함께 좁아지지 않도록 함
  // (TDD로 발견된 결함, Migration 337 참고)
  const rangeStart = `${years[0]}-01-01`
  const rangeEnd = `${years[years.length - 1]}-12-31`

  const { data, error } = await admin.rpc('sync_national_holidays', {
    p_holidays: holidays,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  })
  if (error) throw new Error(`sync_national_holidays RPC 실패: ${error.message}`)

  const upserted = (data as { upserted?: number } | null)?.upserted ?? 0
  return { upserted, years }
}
