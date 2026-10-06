/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로·상수 패턴, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 1단계 1c — 예약대여현황(rental.reservation)·이력관리(rental.history) 메뉴 권한 서버 집행 (2026-10-03)
 *  A. api/cms/reservations/** 전부 + rental-qr-transition + dashboard/gantt-window → rental.reservation 단독 (Stephen 확정: 공유 패널 API는 단독)
 *  B. api/cms/product-history → rental.history 또는 rental.reservation (모바일 QR 이력 기록·이력관리 화면 공용)
 *  C. /cms/reservation·/cms/rentals 서버 액션 → rental.reservation
 * 파일을 디렉터리에서 자동 수집하므로 reservations/** 아래 새 엔드포인트가 게이트 없이 추가되면 이 테스트가 실패한다(누락 감지).
 */

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k', TOSS_SECRET_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', TOSS_SECRET_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(), sendPushToAdmins: vi.fn(), sendReservationLifecyclePush: vi.fn() }))

const createClientSpy = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientSpy(...a) }))

const apiGuard = vi.fn()
const anyGuard = vi.fn()
const actionGuard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: (...a: unknown[]) => apiGuard(...a),
  requireAnyMenuAccessApi: (...a: unknown[]) => anyGuard(...a),
  requireMenuAccessAction: (...a: unknown[]) => actionGuard(...a),
}))

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

function serverFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...serverFiles(rel))
    else if (name === '+server.ts') out.push(rel)
  }
  return out.sort()
}
const methodsOf = (src: string): Method[] =>
  [...src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1] as Method)

const RESERVATION_FILES = [
  ...serverFiles('src/routes/api/cms/reservations'),
  'src/routes/api/cms/rental-qr-transition/+server.ts',
  'src/routes/api/cms/dashboard/gantt-window/+server.ts',
  // 1c 후속(Stephen 확정 2026-10-04): 예약 상세 패널 계약서 탭 API — 계약 ID만 알면 호출되던 우회로 차단(고객 경로 호출 없음 확인)
  ...serverFiles('src/routes/api/cms/contracts'),
]
const HISTORY_FILES = ['src/routes/api/cms/product-history/+server.ts']
const KEYS_ANY = ['rental.history', 'rental.reservation']
const STMT_STRICT = "const denied = await requireMenuAccessApi(locals, 'rental.reservation')"
const STMT_ANY = `const denied = await requireAnyMenuAccessApi(locals, [${KEYS_ANY.map((k) => `'${k}'`).join(', ')}])`
const handlerRe = (m: Method) => new RegExp(`export const ${m}\\b[^\\n]*=>\\s*\\{\\n`)

function firstStatement(src: string, re: RegExp): { found: boolean; first?: string } {
  const m = src.match(re)
  if (!m) return { found: false }
  return { found: true, first: src.slice(m.index! + m[0].length).split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim() }
}

describe('소스 스캔 — 진입부 첫 문장이 게이트', () => {
  it('수집된 대상 규모(reservations 하위 + qr + gantt-window)', () => {
    expect(RESERVATION_FILES.length).toBeGreaterThanOrEqual(25) // reservations 19 + qr 1 + gantt-window 1 + contracts 4
  })

  for (const f of RESERVATION_FILES) {
    it(`A rental.reservation 단독: ${f.replace('src/routes/api/cms/', '')}`, () => {
      const src = read(f)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      const ms = methodsOf(src)
      expect(ms.length).toBeGreaterThan(0)
      for (const m of ms) {
        const r = firstStatement(src, handlerRe(m))
        expect(r.found, `${f} ${m} 선언 없음`).toBe(true)
        expect(r.first, `${f} ${m}`).toBe(STMT_STRICT)
      }
    })
  }

  for (const f of HISTORY_FILES) {
    it(`B 이력(rental.history 또는 rental.reservation): ${f.replace('src/routes/api/cms/', '')}`, () => {
      const src = read(f)
      expect(src).toContain("import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'")
      for (const m of methodsOf(src)) expect(firstStatement(src, handlerRe(m)).first, `${f} ${m}`).toBe(STMT_ANY)
    })
  }

  const ACTION_PAGES: [string, string[]][] = [
    ['src/routes/cms/reservation/+page.server.ts', ['approveReservation', 'changeReservation', 'updateStatus', 'clearIssuedContract', 'discardSentContract', 'cancelIssuedContract']],
    ['src/routes/cms/rentals/+page.server.ts', ['sendChatNotify', 'clearIssuedContract']],
  ]
  for (const [page, actions] of ACTION_PAGES) {
    it(`C 서버 액션 ${actions.length}개: ${page.replace('src/routes/cms/', '')}`, () => {
      const src = read(page)
      expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
      for (const a of actions) {
        const r = firstStatement(src, new RegExp(`^  ${a}: async \\([^)]*\\) => \\{\\n`, 'm'))
        expect(r.found, `${a} 선언 없음`).toBe(true)
        expect(r.first, a).toBe("const denied = await requireMenuAccessAction(locals, 'rental.reservation')")
      }
    })
  }
})

describe('동작 — 게이트 거부 시 즉시 거부, DB 조회 없음', () => {
  const denied403 = () => new Response(JSON.stringify({ error: 'denied' }), { status: 403 })
  beforeEach(() => {
    apiGuard.mockReset().mockResolvedValue(denied403())
    anyGuard.mockReset().mockResolvedValue(denied403())
    actionGuard.mockReset()
    createClientSpy.mockReset()
  })

  const run = async (file: string, m: Method) => {
    const mod = (await import(/* @vite-ignore */ `../../../${file}`)) as Record<string, (e: unknown) => Promise<Response>>
    const safeGetSession = vi.fn()
    const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
    const event = {
      locals,
      params: { id: '1', token: 't' },
      url: new URL('http://x/api?start=2026-01-01&end=2026-01-31'),
      request: new Request('http://x/api', { method: m === 'GET' ? 'GET' : 'POST', body: m === 'GET' ? undefined : '{}' }),
    }
    const res = await mod[m](event)
    return { res, safeGetSession, locals }
  }

  for (const f of RESERVATION_FILES) {
    for (const m of methodsOf(read(f))) {
      it(`A ${f.replace('src/routes/api/cms/', '')} ${m}: 거부 → 403`, async () => {
        const { res, safeGetSession } = await run(f, m)
        expect(res.status).toBe(403)
        expect(apiGuard).toHaveBeenCalledWith(expect.anything(), 'rental.reservation')
        expect(safeGetSession).not.toHaveBeenCalled()
        expect(createClientSpy).not.toHaveBeenCalled()
      })
    }
  }

  for (const f of HISTORY_FILES) {
    for (const m of methodsOf(read(f))) {
      it(`B ${f.replace('src/routes/api/cms/', '')} ${m}: 거부 → 403`, async () => {
        const { res, safeGetSession } = await run(f, m)
        expect(res.status).toBe(403)
        expect(anyGuard).toHaveBeenCalledWith(expect.anything(), KEYS_ANY)
        expect(safeGetSession).not.toHaveBeenCalled()
        expect(createClientSpy).not.toHaveBeenCalled()
      })
    }
  }

  it('C 서버 액션 8개: 거부 시 fail 403 그대로 반환, 세션·DB 조회 없음', async () => {
    const { fail } = await import('@sveltejs/kit')
    const targets: [string, string[]][] = [
      ['../../routes/cms/reservation/+page.server', ['approveReservation', 'changeReservation', 'updateStatus', 'clearIssuedContract', 'discardSentContract', 'cancelIssuedContract']],
      ['../../routes/cms/rentals/+page.server', ['sendChatNotify', 'clearIssuedContract']],
    ]
    for (const [path, names] of targets) {
      const mod = (await import(/* @vite-ignore */ path)) as { actions: Record<string, (e: unknown) => Promise<unknown>> }
      for (const a of names) {
        actionGuard.mockReset().mockResolvedValue(fail(403, { error: 'denied' }))
        createClientSpy.mockClear()
        const safeGetSession = vi.fn()
        const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
        const res = (await mod.actions[a]({ locals, request: new Request('http://x', { method: 'POST', body: new FormData() }) })) as { status: number }
        expect(res.status, `${path} ${a}`).toBe(403)
        expect(actionGuard).toHaveBeenCalledWith(locals, 'rental.reservation')
        expect(safeGetSession, a).not.toHaveBeenCalled()
        expect(createClientSpy, a).not.toHaveBeenCalled()
      }
    }
  })
})
