import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  role: 'manager' as string | null,
  key: { keyId: 'k1' } as { keyId: string } | null,
  current: { id: 'fd1' } as { id: string } | null,
  doc: { id: 'fd1', contract_id: 'c1', signing_id: 's1', evidence_id: 'ev1', pdf_path: 'p', pdf_sha256: 'h', source: 'original' } as Record<string, unknown> | null,
  check: 'unsealed' as string,
  bytesSha: 'h',
  sealCalls: 0,
  sealResult: { ok: true, alreadySealed: false, markerRecorded: true } as Record<string, unknown>,
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => state.denied) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => state.role) }))
vi.mock('$lib/contract-signature/auditLog', () => ({ recordAuditLog: vi.fn(async () => {}) }))
vi.mock('$lib/server/contractArchive/generateArchive', () => ({ ARCHIVE_BUCKET: 'b' }))
vi.mock('$lib/server/contractArchive/sealEnv', () => ({ getSealKey: () => state.key, getSealPublicKeys: () => [] }))
vi.mock('$lib/server/contractArchive/loadArchivedPdf', () => ({
  findCurrentFinalDocument: vi.fn(async () => state.current),
  sha256OfBytes: vi.fn(async () => state.bytesSha),
}))
vi.mock('$lib/server/contractArchive/sealArchive', () => ({
  checkSeal: vi.fn(async () => ({ status: state.check })),
  sealFinalDocument: vi.fn(async () => { state.sealCalls++; return state.sealResult }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'contract_final_documents' ? state.doc : { signed_at: '2026-10-08T00:00:00Z' } }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['x']), error: null }) }) },
  }),
}))

import { POST } from '../../routes/api/cms/contracts/[id]/seal/+server'

const call = () => POST({ params: { id: 'c1' }, locals: { safeGetSession: async () => ({ session: { user: { id: 'u1' } } }) }, getClientAddress: () => '1.1.1.1' } as never)

beforeEach(() => {
  state.denied = null; state.role = 'manager'; state.key = { keyId: 'k1' }; state.current = { id: 'fd1' }
  state.check = 'unsealed'; state.bytesSha = 'h'; state.sealCalls = 0
  state.sealResult = { ok: true, alreadySealed: false, markerRecorded: true }
  state.doc = { id: 'fd1', contract_id: 'c1', signing_id: 's1', evidence_id: 'ev1', pdf_path: 'p', pdf_sha256: 'h', source: 'original' }
})

describe('POST /api/cms/contracts/[id]/seal — 관리자 수동 봉인', () => {
  it('메뉴 권한이 없으면 그대로 거부한다', async () => {
    state.denied = new Response('no', { status: 403 })
    expect((await call()).status).toBe(403)
    expect(state.sealCalls).toBe(0)
  })

  it('매니저 미만(파트너)·역할 없음은 403이다', async () => {
    for (const role of ['partner', null]) {
      state.role = role
      expect((await call()).status).toBe(403)
    }
    expect(state.sealCalls).toBe(0)
  })

  it('키가 없으면 503이다', async () => {
    state.key = null
    expect((await call()).status).toBe(503)
  })

  it('최종본이 없으면 404다', async () => {
    state.current = null
    expect((await call()).status).toBe(404)
  })

  it('이미 봉인됨·invalid·unknown은 409로 거부하고 새 서명을 만들지 않는다', async () => {
    for (const status of ['valid', 'invalid', 'unknown', 'no_key']) {
      state.check = status
      expect((await call()).status).toBe(409)
    }
    expect(state.sealCalls).toBe(0)
  })

  it('unknown은 일시 오류 안내와 status 필드를 함께 돌려준다', async () => {
    state.check = 'unknown'
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.status).toBe('unknown')
    expect(body.error).toContain('다시 시도')
  })

  it('invalid는 개발자 확인 안내를 돌려준다', async () => {
    state.check = 'invalid'
    expect((await (await call()).json()).error).toContain('개발자 확인')
  })

  it('보관 파일 지문이 기록과 다르면 409로 거부한다', async () => {
    state.bytesSha = 'different'
    const res = await call()
    expect(res.status).toBe(409)
    expect(state.sealCalls).toBe(0)
  })

  it('미봉인이고 지문이 일치하면 봉인하고 markerRecorded=true를 알린다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(state.sealCalls).toBe(1)
    expect((await res.json()).markerRecorded).toBe(true)
  })

  it('봉인은 만들었으나 표식 기록이 실패하면 markerRecorded=false로 알린다', async () => {
    state.sealResult = { ok: true, alreadySealed: false, markerRecorded: false }
    expect((await (await call()).json()).markerRecorded).toBe(false)
  })

  it('동시에 이미 봉인된 경우(alreadySealed)에는 markerRecorded 필드를 내지 않는다', async () => {
    state.sealResult = { ok: true, alreadySealed: true }
    const body = await (await call()).json()
    expect(body.ok).toBe(true)
    expect('markerRecorded' in body).toBe(false)
  })

  it('봉인 실패는 500이다', async () => {
    state.sealResult = { ok: false, reason: 'x' }
    expect((await call()).status).toBe(500)
  })
})
