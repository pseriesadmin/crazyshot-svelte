import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 두발히어로 클라이언트(dhero.ts) — 2026-10-27 dev 실험(R1~R7·E1~E7) 결과를 고정하는 시험
 *
 * DC-1  접수 이력이 없으면 예약코드 그대로 접수한다(print:'r')
 * DC-2  살아 있는 접수가 이미 있으면 새로 접수하지 않고 그 번호를 이어받는다(reused)
 * DC-3  이력이 전부 취소됐으면 취소된 번호를 되돌려받지 않도록 `예약코드-2` 로 새로 접수한다 (실험 R4: print:'r' 는 취소된 접수를 돌려준다)
 * DC-4  `-2` 까지 취소됐으면 `-3` 로 넘어가고, 중간에 살아 있는 `-2` 가 있으면 그것을 이어받는다
 * DC-5  메모는 100자(글자 기준)로 자르고, 공백뿐이면 보내지 않는다
 * DC-6  모든 호출에 응답 대기 상한(signal)이 붙는다
 * DC-7  조회 응답이 { rows } 모양(실제)·배열 모양 모두 읽는다
 * DC-8  접수·취소가 상한(10번)만큼 반복되면 오류로 멈춘다(취소된 번호로 접수하지 않음)
 * DC-9  이력 조회가 404 면 이력 없음으로 보고 접수한다(운영 서버 응답 방어)
 * DC-10 이력 조회가 그 밖의 오류(500)면 접수하지 않고 오류로 멈춘다(fail-closed — 중복 접수 방지)
 * DC-11 메모 절단은 글자(코드포인트) 기준 — 이모지가 쪼개지지 않는다
 * DC-12 공동현관 출입번호는 frontdoorPassword 로 50자까지, 비면 보내지 않는다(메모와 별도 칸)
 */

vi.mock('$env/dynamic/private', () => ({ env: { DHERO_API_BASE_URL: 'https://partner-api.dev.dhero.kr', DHERO_TOKEN: 'tok', DHERO_SPOT_CODE: 'S1' } }))

interface Call { method: string; path: string; body?: Record<string, unknown>; signal?: AbortSignal | null }
let calls: Call[] = []
// 예약코드별 접수 이력(조회 응답 rows)
let history: Record<string, Array<{ bookId: string; canceledAt: string | null; receiverDongGroupName?: string; placePageUrl?: string; addressNotSupported?: boolean }>> = {}
let nextBook = 1000

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://partner-api.dev.dhero.kr', '')
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method: String(init.method), path, body, signal: init.signal })
    const m = path.match(/^\/deliveries\/order-id-from-corps\/(.+)$/)
    if (m && init.method === 'GET') {
      return new Response(JSON.stringify({ rows: history[decodeURIComponent(m[1])] ?? [] }), { status: 200 })
    }
    if (path === '/deliveries' && init.method === 'POST') {
      const id = String(body?.orderIdFromCorp)
      const list = history[id] ?? (history[id] = [])
      const row = { bookId: `B${nextBook++}`, canceledAt: null }
      list.push(row)
      return new Response(JSON.stringify({ bookId: row.bookId, orderIdFromCorp: id, dongGroup: 'G1', addressNotSupported: false }), { status: 201 })
    }
    return new Response('{}', { status: 200 })
  }))
}

const params = {
  receiverName: '홍길동', receiverMobile: '010', receiverAddress: '서울 영등포구 도신로 31', receiverAddressDetail: '101호',
  receiverAddressPostalCode: '07376', productName: 'Sony FX3', orderIdFromCorp: 'CS1',
}
const posts = () => calls.filter((c) => c.method === 'POST')

beforeEach(() => { calls = []; history = {}; nextBook = 1000; stubFetch() })
afterEach(() => { vi.unstubAllGlobals() })

describe('dhero.ts createDelivery — 예약코드 기준 이어받기', () => {
  it('DC-1: 이력이 없으면 예약코드 그대로 접수', async () => {
    const { createDelivery } = await import('../../lib/server/dhero')
    const r = await createDelivery(params)
    expect(r.bookId).toBe('B1000')
    expect(posts()).toHaveLength(1)
    expect(posts()[0].body?.orderIdFromCorp).toBe('CS1')
    expect(posts()[0].body?.print).toBe('r')
    expect(posts()[0].body?.spotCode).toBe('S1')
  })

  it('DC-2: 살아 있는 접수가 있으면 새로 접수하지 않고 번호를 이어받는다', async () => {
    history.CS1 = [{ bookId: 'B-OLD', canceledAt: null, receiverDongGroupName: '동작', placePageUrl: 'https://p', addressNotSupported: false }]
    const { createDelivery } = await import('../../lib/server/dhero')
    const r = await createDelivery(params)
    expect(r.bookId).toBe('B-OLD')
    expect(r.reused).toBe(true)
    expect(r.dongGroup).toBe('동작')
    expect(r.placePageUrl).toBe('https://p')
    expect(posts()).toHaveLength(0)
  })

  it('DC-3: 이력이 전부 취소됐으면 취소된 번호 대신 `예약코드-2` 로 새로 접수한다', async () => {
    history.CS1 = [{ bookId: 'B-CANCELED', canceledAt: '2026-10-27 15:34:52' }]
    const { createDelivery } = await import('../../lib/server/dhero')
    const r = await createDelivery(params)
    expect(r.bookId).not.toBe('B-CANCELED')
    expect(posts()).toHaveLength(1)
    expect(posts()[0].body?.orderIdFromCorp).toBe('CS1-2')
  })

  it('DC-4: `-2` 까지 취소됐으면 `-3`, 살아 있는 `-2` 가 있으면 이어받는다', async () => {
    history.CS1 = [{ bookId: 'A', canceledAt: 'x' }]
    history['CS1-2'] = [{ bookId: 'B', canceledAt: 'x' }]
    const { createDelivery } = await import('../../lib/server/dhero')
    await createDelivery(params)
    expect(posts()[0].body?.orderIdFromCorp).toBe('CS1-3')

    calls = []; history = { CS1: [{ bookId: 'A', canceledAt: 'x' }], 'CS1-2': [{ bookId: 'LIVE', canceledAt: null }] }
    const r = await createDelivery(params)
    expect(r.bookId).toBe('LIVE')
    expect(posts()).toHaveLength(0)
  })

  it('DC-5: 메모는 100자로 자르고 공백뿐이면 보내지 않는다', async () => {
    const { createDelivery, clipDheroMemo } = await import('../../lib/server/dhero')
    await createDelivery({ ...params, memoFromCustomer: `  ${'가'.repeat(150)}  ` })
    expect(String(posts()[0].body?.memoFromCustomer)).toHaveLength(100)

    calls = []; history = {}
    await createDelivery({ ...params, memoFromCustomer: '   ' })
    expect(posts()[0].body).not.toHaveProperty('memoFromCustomer')
    expect(clipDheroMemo('공동현관 1234*')).toBe('공동현관 1234*')
    expect(clipDheroMemo(null)).toBeUndefined()
  })

  it('DC-6: 모든 호출에 응답 대기 상한(signal)이 붙는다', async () => {
    const { createDelivery } = await import('../../lib/server/dhero')
    await createDelivery(params)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const c of calls) expect(c.signal).toBeTruthy()
  })

  it('DC-7: 조회 응답이 배열 모양이어도 읽는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ bookId: 'ARR', canceledAt: null }]), { status: 200 })))
    const { findDeliveriesByOrderId } = await import('../../lib/server/dhero')
    expect(await findDeliveriesByOrderId('X')).toEqual([{ bookId: 'ARR', canceledAt: null }])
  })

  it('DC-8: 접수·취소가 10번 반복되면 취소된 번호로 접수하지 않고 오류로 멈춘다', async () => {
    history.CS1 = [{ bookId: 'a', canceledAt: 'x' }]
    for (let n = 2; n <= 10; n++) history[`CS1-${n}`] = [{ bookId: `a${n}`, canceledAt: 'x' }]
    const { createDelivery } = await import('../../lib/server/dhero')
    await expect(createDelivery(params)).rejects.toThrow('10번 반복')
    expect(posts()).toHaveLength(0)
  })

  it('DC-9: 이력 조회가 404 면 이력 없음으로 보고 접수한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), path: url.replace('https://partner-api.dev.dhero.kr', ''), body: init.body ? JSON.parse(String(init.body)) : undefined, signal: init.signal })
      if (init.method === 'GET') return new Response(JSON.stringify({ statusCode: 404, message: '배송정보를 찾을 수 없습니다.' }), { status: 404 })
      return new Response(JSON.stringify({ bookId: 'NEW', orderIdFromCorp: 'CS1', dongGroup: 'G', addressNotSupported: false }), { status: 201 })
    }))
    const { createDelivery } = await import('../../lib/server/dhero')
    const r = await createDelivery(params)
    expect(r.bookId).toBe('NEW')
    expect(posts()[0].body?.orderIdFromCorp).toBe('CS1')
  })

  it('DC-10: 이력 조회가 500 이면 접수하지 않고 오류로 멈춘다(fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), path: url, signal: init.signal })
      return new Response(JSON.stringify({ message: 'server error' }), { status: 500 })
    }))
    const { createDelivery } = await import('../../lib/server/dhero')
    await expect(createDelivery(params)).rejects.toThrow()
    expect(posts()).toHaveLength(0)
  })

  it('DC-11: 메모 절단은 글자(코드포인트) 기준 — 이모지가 쪼개지지 않는다', async () => {
    const { clipDheroMemo } = await import('../../lib/server/dhero')
    const clipped = clipDheroMemo('😀'.repeat(150)) as string
    expect(Array.from(clipped)).toHaveLength(100)
    expect(clipped).toBe('😀'.repeat(100))
    expect(clipped.endsWith('\uD83D')).toBe(false)
  })

  it('DC-12: 공동현관 출입번호는 frontdoorPassword(50자)로 따로 보내고, 비면 보내지 않는다 — 메모와 섞이지 않는다', async () => {
    const { createDelivery, clipDheroFrontdoor } = await import('../../lib/server/dhero')
    await createDelivery({ ...params, memoFromCustomer: '경비실', frontdoorPassword: `  #${'1'.repeat(60)}  ` })
    const body = posts()[0].body as Record<string, unknown>
    expect(String(body.frontdoorPassword)).toHaveLength(50)
    expect(body.memoFromCustomer).toBe('경비실')
    expect(String(body.memoFromCustomer)).not.toContain('#')

    calls = []; history = {}
    await createDelivery({ ...params, frontdoorPassword: '   ' })
    expect(posts()[0].body).not.toHaveProperty('frontdoorPassword')
    expect(clipDheroFrontdoor(null)).toBeUndefined()
    expect(clipDheroFrontdoor(' 1234* ')).toBe('1234*')
  })
})
