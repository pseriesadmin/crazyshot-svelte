import type { SupabaseClient } from '@supabase/supabase-js'

export interface CourierClosedDate {
  date: string
  reason: string
}

// 로컬 타임존 기준 YYYY-MM-DD 문자열(2026-09-20 결함 수정) — Date.toISOString()은 항상 UTC
// 기준이라, 서버 프로세스의 로컬 타임존이 UTC가 아니면(예: 이 저장소의 로컬 개발 서버처럼
// Asia/Seoul, UTC+9) getDay()(로컬 기준)와 toISOString().slice(0,10)(UTC 기준)이 같은
// Date 객체에서 서로 다른 날짜를 가리키는 결함이 있었다 — 예: KST 00:00~09:00 사이의
// 어느 순간에는 getDay()가 "일요일"(KST 기준, 맞음)이라고 판단하는데 toISOString()은
// 아직 전날(UTC 기준, 그 날짜는 실제로 토요일)을 반환해, 실제로는 토요일인 날짜가
// "일요일 휴무"로 하루 앞당겨 잘못 기록됐다(전체 일요일 목록이 체계적으로 하루씩
// 밀리는 결함 — 로컬 개발 환경에서 실측 확인: 실제 일요일 9/27이 courierClosedDates에
// 전혀 없고 대신 있지도 않은 "일요일"인 9/19가 기록돼 있었음). getDay()와 항상 같은
// 기준(로컬)으로 날짜 문자열을 만들어 이 불일치를 원천 차단한다 — "이 날짜가 일요일인가"는
// 타임존과 무관한 달력 사실이므로, getDay()와 날짜 문자열 생성 기준만 서로 일치시키면
// 서버가 어떤 타임존에서 실행되든(로컬 KST든 Vercel의 UTC든) 항상 올바르게 동작한다.
function toLocalIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 택배 휴무일 캘린더 제어 — 마스터 토글 OFF면 조건문 자체를 완전히 스킵(빈 배열 반환).
// 반환된 날짜 목록은 "그 날짜가 휴무"라는 의미 — 수령(전날 기준)·반납(당일 기준) 판정은
// 클라이언트(cart/+page.svelte)에서 각각 다르게 적용한다.
// reason은 CMS에서 등록한 사유(법정공휴일명·임시휴무 사유)를 그대로 실어 클라이언트 경고
// 토스트에 노출하기 위함(2026-08-25 — 사유가 select에서 빠져 토스트에 반영 안 되던 결함 수정)
export async function loadCourierClosedDates(supabase: SupabaseClient): Promise<CourierClosedDate[]> {
  const { data: cutoffRow } = await supabase
    .from('delivery_cutoff_settings')
    .select('enable_prev_day_check, enable_fixed_holidays, enable_manual_holidays')
    .limit(1)
    .single()

  const cutoff = cutoffRow as {
    enable_prev_day_check: boolean
    enable_fixed_holidays: boolean
    enable_manual_holidays: boolean
  } | null

  if (!cutoff?.enable_prev_day_check) return []

  const todayIso = toLocalIso(new Date())
  const holidayTypes: string[] = []
  if (cutoff.enable_fixed_holidays) holidayTypes.push('national')
  if (cutoff.enable_manual_holidays) holidayTypes.push('manual')

  const closed = new Map<string, string>()
  if (holidayTypes.length > 0) {
    const { data: holidayRows } = await supabase
      .from('public_holidays')
      .select('date, name')
      .eq('is_active', true)
      .gte('date', todayIso)
      .in('holiday_type', holidayTypes)
    for (const h of (holidayRows ?? []) as { date: string; name: string }[]) {
      closed.set(h.date, h.name)
    }
  }

  if (cutoff.enable_fixed_holidays) {
    // 일요일은 조회 없이 계산(400일 범위 — 법정공휴일 API 동기화 커버리지와 유사한 여유)
    // — 이미 법정공휴일 사유가 있는 날짜(대체공휴일 등)는 그 사유를 그대로 우선 유지
    const start = new Date()
    for (let i = 0; i < 400; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      if (d.getDay() === 0) {
        const iso = toLocalIso(d)
        if (!closed.has(iso)) closed.set(iso, '일요일 휴무')
      }
    }
  }

  return [...closed.entries()].map(([date, reason]) => ({ date, reason }))
}
