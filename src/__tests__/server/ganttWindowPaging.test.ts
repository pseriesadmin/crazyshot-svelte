/**
 * ganttWindowPaging.test.ts — 홈 간트 구간 API 의 200건 상한 처리 + 화면 로딩 보호 장치 (2026-11-27)
 *  W1 200건을 넘으면 다음 페이지를 이어서 받고, 최대 3장까지 받아도 모자라면 truncated:true 로 알린다
 *  W2 한 장이면 truncated:false, 겹침 모드(p_date_overlap)·제외 상태가 항상 전달된다
 *  W3 화면(소스): 재조회는 전체 범위가 아니라 선택 예약 주변만, 절단(truncated) 때는 지우지 않는다, 과거·미래 한도, 사전 로드(트리거) 설정
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const calls: Array<Record<string, unknown>> = []
let totalRows = 0
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args)
      const page = Number(args.p_page), per = Number(args.p_per_page)
      const start = (page - 1) * per
      const n = Math.max(0, Math.min(per, totalRows - start))
      return { data: Array.from({ length: n }, (_, i) => ({ reservation_id: start + i + 1, total_count: totalRows })), error: null }
    },
  }),
}))

import { GET } from '../../routes/api/cms/dashboard/gantt-window/+server'

const locals = { safeGetSession: async () => ({ session: { user: { id: 'u' } } }) }
const get = async (): Promise<{ status: number; json: { rows: unknown[]; truncated: boolean } }> => {
  const res = await GET({ url: new URL('http://x/api/cms/dashboard/gantt-window?from=2026-11-01&to=2026-11-14'), locals } as unknown as Parameters<typeof GET>[0])
  return { status: res.status, json: (await res.json()) as { rows: unknown[]; truncated: boolean } }
}

beforeEach(() => { calls.length = 0; totalRows = 0 })

describe('W1·W2 구간 API 페이지 처리', () => {
  it('200건 이하는 한 장만 받고 truncated:false, 겹침 모드와 제외 상태를 전달한다', async () => {
    totalRows = 57
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.json.rows).toHaveLength(57)
    expect(r.json.truncated).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ p_date_overlap: true, p_exclude_statuses: ['cancelled', 'draft'], p_per_page: 200 })
  })
  it('정확히 200건이어도 더 있는지 확인하지 않고 끝낸다(total 과 같으면 중단)', async () => {
    totalRows = 200
    const r = await get()
    expect(r.json.rows).toHaveLength(200)
    expect(r.json.truncated).toBe(false)
    expect(calls).toHaveLength(1)
  })
  it('450건이면 3장(200+200+50)을 이어서 받는다 — 누락 없음', async () => {
    totalRows = 450
    const r = await get()
    expect(r.json.rows).toHaveLength(450)
    expect(r.json.truncated).toBe(false)
    expect(calls.map((c) => c.p_page)).toEqual([1, 2, 3])
  })
  it('700건이면 3장(600건)까지만 받고 truncated:true — 서버 부하를 묶는다', async () => {
    totalRows = 700
    const r = await get()
    expect(r.json.rows).toHaveLength(600)
    expect(r.json.truncated).toBe(true)
    expect(calls).toHaveLength(3)
  })
})

describe('W3 화면 로딩 보호(소스 점검)', () => {
  const src = readFileSync('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte', 'utf8')
  it('재조회는 불러온 전체 범위가 아니라 선택한 예약 주변(REFETCH_PAD)만 받는다', () => {
    const body = src.slice(src.indexOf('async function refetchCurrentWindow'), src.indexOf('function checkEdges'))
    expect(body).toContain('REFETCH_PAD')
    expect(body).not.toMatch(/fetchWindow\(loadedFrom,\s*loadedTo\)/)
  })
  it('서버가 상한 때문에 다 못 줬으면(truncated) 기존 행을 지우지 않는다', () => {
    const body = src.slice(src.indexOf('async function refetchCurrentWindow'), src.indexOf('function checkEdges'))
    expect(body).toMatch(/if \(!got\.truncated\)/)
  })
  it('과거·미래로 불러올 수 있는 범위에 한도(MAX_SPAN_D)가 있고, 사전 로드 트리거가 가장자리 직전(10일)이다', () => {
    expect(src).toMatch(/MAX_SPAN_D\s*=\s*365/)
    expect(src).toMatch(/loadedFrom <= addDays\(todayStr, -MAX_SPAN_D\)/)
    expect(src).toMatch(/loadedTo >= addDays\(todayStr, MAX_SPAN_D\)/)
    expect(src).toMatch(/TRIGGER_D\s*=\s*10\b/)
  })
  it('불러오기 실패 시 범위를 늘리지 않아 다음 스크롤에서 다시 시도한다', () => {
    expect(src).toMatch(/if \(!got\) return/)
  })
})
