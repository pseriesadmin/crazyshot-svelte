import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  result: { status: 'not_found', archiveIntact: null, info: null, contractId: null, finalDocumentId: null } as Record<string, unknown>,
  outcomes: [] as Record<string, unknown>[],
  verifyCalls: [] as string[],
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('$lib/server/contractArchive/verifyArchive', async (orig) => {
  const real = await orig<typeof import('$lib/server/contractArchive/verifyArchive')>()
  return {
    ...real,
    verifyPublicHash: vi.fn(async (_a: unknown, sha: string) => { state.verifyCalls.push(sha); return state.result }),
    recordVerifyOutcome: vi.fn(async (_a: unknown, args: Record<string, unknown>) => { state.outcomes.push(args) }),
  }
})

import { POST } from '../../routes/api/contracts/verify-file/+server'

const H = 'a'.repeat(64)
let ipCounter = 0
const call = (body: unknown, ip?: string) =>
  POST({ request: new Request('https://x/api/contracts/verify-file', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), getClientAddress: () => ip ?? `10.0.0.${++ipCounter}` } as never)

beforeEach(() => {
  state.result = { status: 'not_found', archiveIntact: null, info: null, contractId: null, finalDocumentId: null }
  state.outcomes = []
  state.verifyCalls = []
})

describe('POST /api/contracts/verify-file — 공개 진위 확인', () => {
  it('형식이 틀린 지문·잘못된 JSON·과대 본문은 400이며 서버 조회를 하지 않는다', async () => {
    for (const body of [{ sha256: 'abc' }, { sha256: 'G'.repeat(64) }, { nope: 1 }, '{bad', { sha256: H + H + H + 'x'.repeat(1100) }]) {
      expect((await call(body)).status).toBe(400)
    }
    expect(state.verifyCalls).toHaveLength(0)
  })

  it('Content-Length가 1KB를 넘는 요청은 본문을 읽기 전에 400이다', async () => {
    const res = await POST({ request: new Request('https://x/api/contracts/verify-file', { method: 'POST', body: JSON.stringify({ sha256: H }), headers: { 'content-length': '99999' } }), getClientAddress: () => '10.9.9.9' } as never)
    expect(res.status).toBe(400)
    expect(state.verifyCalls).toHaveLength(0)
  })

  it('대문자·공백이 섞여도 정규화해 조회한다', async () => {
    const res = await call({ sha256: `  ${H.toUpperCase()} ` })
    expect(res.status).toBe(200)
    expect(state.verifyCalls).toEqual([H])
  })

  it('일치 기록이 있으면 최소 정보만 돌려주고(내부 보관 상태·계약 ID 비노출) 확인 결과를 감사로 남긴다', async () => {
    state.result = { status: 'authentic', archiveIntact: false, contractId: 'c-1', finalDocumentId: 'fd-1', info: { signedAtKst: '2026.10.07 13:20', source: 'original', reservationCode: 'CSRS*******52' } }
    const res = await call({ sha256: H })
    const body = await res.json()
    expect(body).toMatchObject({ status: 'authentic', info: { signedAtKst: '2026.10.07 13:20', reservationCode: 'CSRS*******52' }, sha256: H })
    expect(body).not.toHaveProperty('archiveIntact')
    expect(JSON.stringify(body)).not.toContain('c-1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.outcomes[0]).toMatchObject({ contractId: 'c-1', finalDocumentId: 'fd-1', via: 'public', actorId: null })
  })

  it('수정·재생성된 파일(기록 없음)은 not_found로 응답하고 정보를 주지 않는다', async () => {
    const body = await (await call({ sha256: H })).json()
    expect(body).toMatchObject({ status: 'not_found', info: null })
  })

  it('같은 IP의 반복 요청은 분당 20회를 넘으면 429다', async () => {
    const results: number[] = []
    for (let i = 0; i < 22; i++) results.push((await call({ sha256: H }, '203.0.113.50')).status)
    expect(results.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(results.slice(20)).toEqual([429, 429])
  })
})
