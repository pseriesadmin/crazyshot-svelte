import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  cronSecret: 'secret' as string | undefined,
  enabled: undefined as string | undefined,
  cmsRole: 'manager' as string | null,
  menuDenied: false,
  pdf: null as null | { finalDocumentId: string; contractId: string; source: 'original'; bytes: Uint8Array },
  audits: [] as Record<string, unknown>[],
  loadArgs: [] as string[][],
  tables: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock('$env/dynamic/private', () => ({ env: { get CRON_SECRET() { return state.cronSecret }, get CONTRACT_ARCHIVE_ENABLED() { return state.enabled }, SUPABASE_SERVICE_ROLE_KEY: 'k', CONTRACT_ARCHIVE_BACKFILL: undefined } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://proj.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: vi.fn(async () => (state.menuDenied ? new Response(JSON.stringify({ error: 'menu' }), { status: 403 }) : null)),
}))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => state.cmsRole) }))
vi.mock('$lib/contract-signature/auditLog', () => ({ recordAuditLog: vi.fn(async (_a: unknown, p: Record<string, unknown>) => { state.audits.push(p) }) }))
vi.mock('$lib/server/contractArchive/loadArchivedPdf', async (orig) => {
  const real = await orig<typeof import('$lib/server/contractArchive/loadArchivedPdf')>()
  return { ...real, loadLatestArchivedPdf: vi.fn(async (_a: unknown, ids: string[]) => { state.loadArgs.push(ids); return state.pdf }) }
})
const archive = vi.hoisted(() => ({
  items: [] as { id: string; contract_id: string }[],
  results: [] as { ok: boolean; reason?: string; permanent?: boolean; alreadyArchived?: boolean; source?: string }[],
  attempted: [] as string[],
  failures: [] as { id: string; reason: string; permanent: boolean }[],
  retryFlag: undefined as boolean | undefined,
  waiting: 0,
  stalled: 0,
}))
vi.mock('$lib/server/contractArchive/generateArchive', () => ({
  archiveEvidence: vi.fn(async (_a: unknown, ev: { id: string }) => { archive.attempted.push(ev.id); return archive.results.shift() ?? { ok: true, source: 'original', alreadyArchived: false } }),
  createLegacyEvidence: vi.fn(), listLegacySignings: vi.fn(async () => []),
  listPendingEvidence: vi.fn(async (_a: unknown, _l: number, o?: { ignoreBackoff?: boolean }) => { archive.retryFlag = o?.ignoreBackoff; return { items: archive.items, waiting: archive.waiting, stalled: archive.stalled } }),
  recordArchiveFailure: vi.fn(async (_a: unknown, ev: { id: string }, reason: string, permanent: boolean) => { archive.failures.push({ id: ev.id, reason, permanent }); return true }),
}))
vi.mock('@supabase/supabase-js', () => {
  function query(table: string) {
    const filters: [string, unknown][] = []
    const inF: [string, unknown[]][] = []
    const run = () => (state.tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v) && inF.every(([k, vs]) => vs.includes(r[k])))
    const api: Record<string, unknown> = {
      select: () => api, not: () => api, limit: () => api,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return api },
      in: (k: string, vs: unknown[]) => { inF.push([k, vs]); return api },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { createClient: () => ({ from: (t: string) => query(t) }) }
})

import { GET as cronGet } from '../../routes/api/cron/contract-archive/+server'
import { GET as cmsGet } from '../../routes/api/cms/contracts/[id]/final-pdf/+server'
import { GET as customerGet } from '../../routes/api/account/rental/[id]/contract-pdf/+server'

const PDF = { finalDocumentId: 'fd-1', contractId: 'c-1', source: 'original' as const, bytes: new Uint8Array([37, 80, 68, 70, 45]) }

beforeEach(() => {
  state.cronSecret = 'secret'; state.enabled = undefined; state.cmsRole = 'manager'; state.menuDenied = false
  state.pdf = null; state.audits = []; state.loadArgs = []; state.tables = {}
  Object.assign(archive, { items: [], results: [], attempted: [], failures: [], retryFlag: undefined, waiting: 0, stalled: 0 })
})

const asCron = (auth?: string, qs = '') => ({ request: new Request('https://x/api/cron/contract-archive', { headers: auth ? { authorization: auth } : {} }), url: new URL(`https://x/api/cron/contract-archive${qs}`) }) as never

describe('/api/cron/contract-archive — 인증·스위치', () => {
  it('CRON_SECRET 미설정·인증 실패는 401, 올바른 키면 통과한다', async () => {
    state.cronSecret = undefined
    expect((await cronGet(asCron('Bearer secret'))).status).toBe(401)
    state.cronSecret = 'secret'
    expect((await cronGet(asCron())).status).toBe(401)
    expect((await cronGet(asCron('Bearer wrong'))).status).toBe(401)
    const ok = await cronGet(asCron('Bearer secret'))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, created: 0 })
  })

  it('CONTRACT_ARCHIVE_ENABLED=false면 생성을 건너뛴다', async () => {
    state.enabled = 'false'
    expect(await (await cronGet(asCron('Bearer secret'))).json()).toEqual({ ok: true, skipped: 'disabled' })
  })
})

describe('/api/cron/contract-archive — 처리 루프(실패 기록·연속 실패 중단·재시도·모니터링)', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, contract_id: `c${i + 1}` }))

  it('실패한 건은 사유와 함께 기록하고, 영구 실패 여부를 구분해 기록한다', async () => {
    archive.items = items(2)
    archive.results = [{ ok: false, reason: 'invalid_pdf_output', permanent: false }, { ok: false, reason: 'unsupported_authoring_mode', permanent: true }]
    const body = await (await cronGet(asCron('Bearer secret'))).json()
    expect(archive.failures).toEqual([
      { id: 'e1', reason: 'invalid_pdf_output', permanent: false },
      { id: 'e2', reason: 'unsupported_authoring_mode', permanent: true },
    ])
    expect(body).toMatchObject({ ok: true, created: 0, failed: 2, stoppedEarly: false })
  })

  it('일시 오류가 연속 3건이면 시스템 장애로 보고 이번 실행을 멈춘다(영구 실패는 연속 횟수에 넣지 않는다)', async () => {
    archive.items = items(6)
    archive.results = Array.from({ length: 6 }, () => ({ ok: false, reason: 'storage_upload_failed', permanent: false }))
    const body = await (await cronGet(asCron('Bearer secret'))).json()
    expect(archive.attempted).toEqual(['e1', 'e2', 'e3'])
    expect(body.stoppedEarly).toBe(true)

    archive.attempted = []; archive.failures = []
    archive.items = items(5)
    archive.results = Array.from({ length: 5 }, () => ({ ok: false, reason: 'unsupported_authoring_mode', permanent: true }))
    const perm = await (await cronGet(asCron('Bearer secret'))).json()
    expect(archive.attempted).toHaveLength(5)
    expect(perm.stoppedEarly).toBe(false)
  })

  it('성공이 끼면 연속 실패 횟수가 초기화되고, 한 번에 만드는 PDF는 3건으로 제한된다', async () => {
    archive.items = items(8)
    archive.results = [
      { ok: false, reason: 'x', permanent: false }, { ok: false, reason: 'x', permanent: false }, { ok: true, source: 'original' },
      { ok: false, reason: 'x', permanent: false }, { ok: true, source: 'original' }, { ok: true, source: 'original' },
    ]
    const body = await (await cronGet(asCron('Bearer secret'))).json()
    expect(body.created).toBe(3)
    expect(archive.attempted).toHaveLength(6) // 3건을 만들면 거기서 멈춤
  })

  it('?retry=1은 재시도 대기를 무시하고, 응답에 대기·막힌 건수를 싣는다', async () => {
    archive.waiting = 4; archive.stalled = 2
    const body = await (await cronGet(asCron('Bearer secret', '?retry=1'))).json()
    expect(archive.retryFlag).toBe(true)
    expect(body).toMatchObject({ waiting: 4, stalled: 2 })
    await cronGet(asCron('Bearer secret'))
    expect(archive.retryFlag).toBe(false)
  })
})

describe('/api/cms/contracts/[id]/final-pdf — CMS 열람', () => {
  const call = (id = 'c-1', qs = '') => cmsGet({ params: { id }, locals: { safeGetSession: async () => ({ session: { user: { id: 'admin-1' } } }) }, url: new URL(`https://x/?${qs}`) } as never)

  it('메뉴 권한 없음·CMS 직원 아님은 403이고 PDF를 읽지 않는다', async () => {
    state.menuDenied = true
    expect((await call()).status).toBe(403)
    state.menuDenied = false; state.cmsRole = null
    expect((await call()).status).toBe(403)
    expect(state.loadArgs).toHaveLength(0)
  })

  it('보관본이 없으면 404, 있으면 inline PDF를 내려주고 열람을 감사로그에 남긴다(download=1이면 attachment)', async () => {
    expect((await call()).status).toBe(404)
    state.pdf = PDF
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(state.audits[0]).toMatchObject({ contractId: 'c-1', eventType: 'viewed', actorType: 'admin', actorId: 'admin-1', metadata: { kind: 'final_pdf' } })
    expect((await call('c-1', 'download=1')).headers.get('content-disposition')).toMatch(/^attachment/)
  })
})

describe('/api/account/rental/[id]/contract-pdf — 고객 사본 받기', () => {
  function locals(userId: string | null, ownedReservation: boolean) {
    return {
      safeGetSession: async () => ({ session: userId ? { user: { id: userId } } : null }),
      supabase: { from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: ownedReservation ? { id: 7 } : null, error: null }) }; return q } },
    }
  }
  const call = (l: ReturnType<typeof locals>, id = '7') => customerGet({ params: { id }, locals: l, getClientAddress: () => '9.9.9.9' } as never)

  beforeEach(() => {
    state.tables = {
      order_items: [{ reservation_id: 7, order_id: 'o-1' }, { reservation_id: 8, order_id: 'o-1' }],
      contracts: [{ id: 'c-1', reservation_id: 8 }],
      contract_signings: [{ contract_id: 'c-1', user_id: 'u-1', signed_at: '2026-10-06' }],
      contract_audit_log: [],
    }
  })

  it('비로그인 401, 잘못된 ID 400, 내 예약이 아니면 404', async () => {
    expect((await call(locals(null, true))).status).toBe(401)
    expect((await call(locals('u-1', true), 'abc')).status).toBe(400)
    expect((await call(locals('u-2', false))).status).toBe(404)
  })

  it('같은 주문 형제 예약의 계약 중 "내가 서명한 계약"의 PDF만 대상으로 찾고, 서명자가 아니면 PDF를 읽지 않는다', async () => {
    state.pdf = PDF
    const res = await call(locals('u-1', true))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(state.loadArgs[0]).toEqual(['c-1'])

    state.loadArgs = []
    await call(locals('u-9', true)) // 예약 소유는 통과했지만 서명자가 아닌 경우
    expect(state.loadArgs[0]).toEqual([])
  })

  it('준비 전이면 404 안내, 최초 다운로드만 copy_downloaded를 시각·IP와 함께 기록한다', async () => {
    expect((await call(locals('u-1', true))).status).toBe(404)
    state.pdf = PDF
    await call(locals('u-1', true))
    expect(state.audits.filter((a) => a.eventType === 'copy_downloaded')).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({ contractId: 'c-1', actorType: 'customer', actorId: 'u-1', ipAddress: '9.9.9.9' })
    state.tables.contract_audit_log = [{ id: 'a-1', contract_id: 'c-1', event_type: 'copy_downloaded', metadata: { final_document_id: 'fd-1' } }]
    state.audits = []
    await call(locals('u-1', true))
    expect(state.audits).toHaveLength(0)
    // 새 보관본(재서명·재생성)은 그 최초 다운로드가 다시 기록된다
    state.pdf = { ...PDF, finalDocumentId: 'fd-2' }
    await call(locals('u-1', true))
    expect(state.audits.filter((a) => a.eventType === 'copy_downloaded')).toHaveLength(1)
  })
})
