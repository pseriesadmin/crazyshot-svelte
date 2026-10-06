import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 대시보드 간트 SSR 초기 데이터 — 예약대여현황(rental.reservation) 메뉴 권한 집행 (1c 후속, 2026-10-04)
 * gantt-window API만 막으면 대시보드 +page.server.ts가 service-role로 직접 읽는 초기 구간(오늘 -3일~+10일, 최대 200건의 고객·예약 정보)이
 * 우회로가 된다 — OFF 계정은 SSR 조회 자체를 하지 않고 빈 간트를 받아야 한다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))

const rpcSpy = vi.fn()
// admin 클라이언트 — 어떤 체인 호출이든 await하면 {data:null,error:null}, rpc는 스파이로 기록
function chain(): unknown {
  return new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: null }) : chain()),
    apply: () => chain(),
  })
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => chain(),
    rpc: (name: string, args: unknown) => {
      rpcSpy(name, args)
      const data = name === 'get_rental_list' ? [{ id: 1 }, { id: 2 }] : null
      return Promise.resolve({ data, error: null })
    },
  }),
}))

const checkSpy = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ checkMenuAccess: (...a: unknown[]) => checkSpy(...a) }))

const { load } = await import('../../routes/cms/+page.server')

const event = () => ({
  parent: async () => ({ cmsRole: 'partner' }),
  fetch: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  locals: {
    safeGetSession: async () => ({ session: { user: { id: 'u1' } } }),
    // 사용자 세션 클라이언트 — 오늘 통계 등 다른 위젯 조회용(여기서는 호출 기록만)
    supabase: {
      from: () => chain(),
      rpc: (name: string, args: unknown) => {
        rpcSpy(name, args)
        return Promise.resolve({ data: null, error: null })
      },
    },
  },
})

describe('대시보드 load — 간트 SSR 초기 데이터 게이트', () => {
  beforeEach(() => {
    rpcSpy.mockClear()
    checkSpy.mockReset()
  })

  it('예약대여현황 허용 → 간트 조회(get_rental_list) 실행·rows 반환 (무회귀)', async () => {
    checkSpy.mockResolvedValue({ ok: true, cmsRole: 'partner' })
    const res = (await load(event() as never)) as { ganttWindow: { rows: unknown[] } }
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), 'rental.reservation')
    expect(rpcSpy.mock.calls.some((c) => c[0] === 'get_rental_list')).toBe(true)
    expect(res.ganttWindow.rows).toHaveLength(2)
  })

  it('예약대여현황 차단(OFF·조회 실패) → get_rental_list 호출 없이 빈 간트', async () => {
    checkSpy.mockResolvedValue({ ok: false, status: 403, error: 'denied' })
    const res = (await load(event() as never)) as { ganttWindow: { rows: unknown[]; from: string; to: string } }
    expect(rpcSpy.mock.calls.some((c) => c[0] === 'get_rental_list')).toBe(false)
    expect(res.ganttWindow.rows).toEqual([])
    expect(res.ganttWindow.from).toBeTruthy() // 간트 창(날짜 범위)은 그대로 — 화면이 깨지지 않게
  })

  it('차단돼도 대시보드의 다른 위젯 조회는 영향 없음(다른 rpc 호출 유지)', async () => {
    checkSpy.mockResolvedValue({ ok: false, status: 403, error: 'denied' })
    await load(event() as never)
    expect(rpcSpy.mock.calls.some((c) => c[0] !== 'get_rental_list')).toBe(true)
  })
})
