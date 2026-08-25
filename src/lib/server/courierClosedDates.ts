import type { SupabaseClient } from '@supabase/supabase-js'

export interface CourierClosedDate {
  date: string
  reason: string
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

  const todayIso = new Date().toISOString().slice(0, 10)
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
        const iso = d.toISOString().slice(0, 10)
        if (!closed.has(iso)) closed.set(iso, '일요일 휴무')
      }
    }
  }

  return [...closed.entries()].map(([date, reason]) => ({ date, reason }))
}
