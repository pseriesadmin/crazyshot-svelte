import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * get_rental_list 날짜 '겹침' 모드(p_date_overlap) — Stage DB 라이브 통합 시험 (2026-11-27, Migration #860)
 *
 * 완료기준:
 *   정상 동작   : 겹침 모드는 구간과 겹치는 예약(경계에 걸친 예약·이미 종료된 예약 포함)을 모두 돌려주고, 기본(false)은 기존 '완전 포함' 그대로다.
 *   막아야 할 것 : 기본 호출(예약대여현황·예약현황·모바일 날짜 필터)의 결과가 바뀌는 것, 겹침이 아닌 예약이 섞이는 것.
 *   실패했을 때  : 간트에서 구간 경계에 걸친 종료 예약 바가 사라지거나, 다른 화면의 날짜 필터 결과가 달라진다.
 * Stage 의 기존 예약 데이터를 읽기만 한다 — 성질(포함 관계·조건식)을 단언하므로 데이터가 적어도 실패하지는 않는다.
 * 주의: Migration #860 적용 전에는 전부 실패하는 것이 정상.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface Row { reservation_id: number; rental_start: string; rental_end: string; status: string }

async function list(args: Record<string, unknown>): Promise<Row[]> {
  const { data, error } = await admin.rpc('get_rental_list', { p_page: 1, p_per_page: 200, p_exclude_statuses: ['cancelled', 'draft'], ...args })
  expect(error).toBeNull()
  return (data ?? []) as Row[]
}
const day = (n: number): string => new Date(Date.now() + 9 * 3600_000 + n * 86400_000).toISOString().slice(0, 10)

describe.each([false, true])('get_rental_list 겹침 모드 (묶음=%s)', (group) => {
  const from = day(-3), to = day(10)
  it('기본 = 구간 안에 완전히 포함된 예약만(기존 동작)', async () => {
    const rows = await list({ p_date_from: from, p_date_to: to, p_group_by_order: group })
    for (const r of rows) {
      expect(r.rental_start >= from).toBe(true)
      expect(r.rental_end <= to).toBe(true)
    }
  })
  it('겹침 = 구간과 겹치는 예약 전부 — 기본 결과를 포함하고, 추가분은 경계에 걸친 예약뿐', async () => {
    const base = await list({ p_date_from: from, p_date_to: to, p_group_by_order: group })
    const over = await list({ p_date_from: from, p_date_to: to, p_group_by_order: group, p_date_overlap: true })
    const overIds = new Set(over.map((r) => r.reservation_id))
    for (const r of base) expect(overIds.has(r.reservation_id)).toBe(true)
    const baseIds = new Set(base.map((r) => r.reservation_id))
    for (const r of over) {
      expect(r.rental_end >= from && r.rental_start <= to).toBe(true)
      if (!baseIds.has(r.reservation_id)) expect(r.rental_start < from || r.rental_end > to).toBe(true)
    }
  })
  it('구간이 한쪽만 있어도 겹침 조건이 적용된다(종료일 ≥ 시작 / 시작일 ≤ 끝)', async () => {
    const fromOnly = await list({ p_date_from: from, p_group_by_order: group, p_date_overlap: true })
    for (const r of fromOnly) expect(r.rental_end >= from).toBe(true)
    const toOnly = await list({ p_date_to: to, p_group_by_order: group, p_date_overlap: true })
    for (const r of toOnly) expect(r.rental_start <= to).toBe(true)
  })
})

describe('호출부 연결(소스 점검)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8')
  it('간트 두 호출(첫 로드·구간 이동)만 겹침 모드를 켠다', () => {
    expect(read('src/routes/cms/+page.server.ts')).toMatch(/p_date_overlap:\s*true/)
    expect(read('src/routes/api/cms/dashboard/gantt-window/+server.ts')).toMatch(/p_date_overlap:\s*true/)
    for (const p of ['src/routes/cms/rentals/+page.server.ts', 'src/lib/server/cms/reservationStageList.ts', 'src/routes/cms/mobile/rentals/+page.server.ts']) {
      expect(read(p)).not.toContain('p_date_overlap')
    }
  })
  it('간트 다시 불러오기가 선택 예약 주변 범위와 겹치는 행만 겹침 기준으로 지운다', () => {
    const src = read('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte')
    expect(src).toMatch(/r\.rental_end >= from && r\.rental_start <= to/)
    expect(src).not.toMatch(/r\.rental_end >= loadedFrom && r\.rental_start <= loadedTo/) // 불러온 전체 범위 기준으로 되돌리면 200건 절단 위험
  })
})
