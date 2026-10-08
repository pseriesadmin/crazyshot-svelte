import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 서명·결제 직후 최종본 PDF 즉시 생성(archiveNow) — 호출·fallback·대상 지정 크론·배선 테스트 (2026-10-08)
 */

const envState = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }))
vi.mock('$env/dynamic/private', () => ({ get env() { return envState.env } }))

import { buildArchiveNowUrl, runInBackground, scheduleArchiveNow } from '$lib/server/contractArchive/archiveNow'

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
const g = globalThis as unknown as Record<symbol, unknown>
const origVercel = process.env.VERCEL

function installContext(waitUntil: (p: Promise<unknown>) => void) {
  g[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) }
}

beforeEach(() => {
  envState.env = { CRON_SECRET: 'sek', VERCEL_URL: 'crazyshot-abc.vercel.app' }
  delete g[REQUEST_CONTEXT]
  delete process.env.VERCEL
  vi.restoreAllMocks()
})
afterEach(() => {
  delete g[REQUEST_CONTEXT]
  if (origVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = origVercel
})

describe('runInBackground — 응답 뒤에도 작업을 살려 둔다', () => {
  it('Vercel 요청 컨텍스트가 있으면 waitUntil에 맡긴다', async () => {
    const kept: Promise<unknown>[] = []
    installContext((p) => { kept.push(p) })
    const task = vi.fn(async () => 'done')
    expect(runInBackground(task)).toBe(true)
    expect(kept).toHaveLength(1)
    await kept[0]
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('작업이 실패해도 throw하지 않고 로그만 남긴다(waitUntil Promise도 reject되지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kept: Promise<unknown>[] = []
    installContext((p) => { kept.push(p) })
    runInBackground(async () => { throw new Error('boom') })
    await expect(kept[0]).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })

  it('Vercel인데 waitUntil을 찾지 못하면 시작하지 않는다(응답 뒤 멈춰 끊기는 것보다 크론에 맡김)', () => {
    process.env.VERCEL = '1'
    const task = vi.fn(async () => {})
    expect(runInBackground(task)).toBe(false)
    expect(task).not.toHaveBeenCalled()
  })

  it('로컬(Vercel 아님)에서는 그냥 실행한다', async () => {
    const task = vi.fn(async () => {})
    expect(runInBackground(task)).toBe(true)
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(1)
  })
})

describe('scheduleArchiveNow — 대상 지정 크론 호출', () => {
  it('Bearer 인증과 예약 지정 URL로 호출한다(서버가 정한 환경변수 origin만 사용)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const kept: Promise<unknown>[] = []
    installContext((p) => { kept.push(p) })
    envState.env = { CRON_SECRET: 'sek', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'crazyshot.kr' }
    expect(scheduleArchiveNow(501)).toBe(true)
    await kept[0]
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://crazyshot.kr/api/cron/contract-archive?reservationId=501')
    expect(init.headers.authorization).toBe('Bearer sek')
    vi.unstubAllGlobals()
  })

  it('현재 배포 호스트(VERCEL_URL)를 쓰고, 운영은 대표 도메인을 쓴다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const kept: Promise<unknown>[] = []
    installContext((p) => { kept.push(p) })
    scheduleArchiveNow(7)
    await kept[0]
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://crazyshot-abc.vercel.app/api/cron/contract-archive?reservationId=7')
    envState.env = { CRON_SECRET: 'sek', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'crazyshot.kr', VERCEL_URL: 'x.vercel.app' }
    scheduleArchiveNow(8)
    await kept[1]
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe('https://crazyshot.kr/api/cron/contract-archive?reservationId=8')
    // 운영인데 대표 도메인 시스템 변수가 없어도 대표 도메인으로 호출(배포 고유 주소는 쓰지 않음)
    envState.env = { CRON_SECRET: 'sek', VERCEL_ENV: 'production', VERCEL_URL: 'x.vercel.app' }
    scheduleArchiveNow(9)
    await kept[2]
    expect((fetchMock.mock.calls[2] as unknown as [string])[0]).toBe('https://crazyshot.kr/api/cron/contract-archive?reservationId=9')
    vi.unstubAllGlobals()
  })

  it('CRON_SECRET이 없거나 예약이 없거나 보관 기능이 꺼져 있으면 호출하지 않는다', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    installContext(() => {})
    envState.env = { VERCEL_URL: 'x.vercel.app' }
    expect(scheduleArchiveNow(1)).toBe(false)
    envState.env = { CRON_SECRET: 'sek', VERCEL_URL: 'x.vercel.app' }
    expect(scheduleArchiveNow(null)).toBe(false)
    expect(scheduleArchiveNow(undefined)).toBe(false)
    envState.env = { CRON_SECRET: 'sek', VERCEL_URL: 'x.vercel.app', CONTRACT_ARCHIVE_ENABLED: 'false' }
    expect(scheduleArchiveNow(1)).toBe(false)
    envState.env = { CRON_SECRET: 'sek' }
    expect(scheduleArchiveNow(1)).toBe(false) // origin을 알 수 없음
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('호출 응답이 오류여도·네트워크가 실패해도 throw하지 않는다(서명·결제 흐름 보호)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const kept: Promise<unknown>[] = []
    installContext((p) => { kept.push(p) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    envState.env = { CRON_SECRET: 'sek', VERCEL_URL: 'h.vercel.app' }
    expect(() => scheduleArchiveNow(1)).not.toThrow()
    await kept[0]
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(() => scheduleArchiveNow(2)).not.toThrow()
    await expect(kept[1]).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('URL은 예약 번호를 인코딩하고 끝 슬래시를 정리한다', () => {
    expect(buildArchiveNowUrl('https://h///', '12 3')).toBe('https://h/api/cron/contract-archive?reservationId=12%203')
  })
})

describe('배선(소스 점검)', () => {
  const read = (p: string) => readFileSync(p, 'utf8')

  it('서명 API는 증적 저장·승인 처리 뒤 응답 직전에 즉시 생성을 예약한다(응답을 기다리지 않음)', () => {
    const src = read('src/routes/api/contracts/[token]/sign/+server.ts')
    const evidence = src.indexOf(".from('contract_signature_evidence').insert(evidenceRow)")
    const schedule = src.indexOf('scheduleArchiveNow(signReservationId)')
    const ret = src.lastIndexOf('return json({ ok: true })')
    expect(evidence).toBeGreaterThan(-1)
    expect(schedule).toBeGreaterThan(evidence)
    expect(ret).toBeGreaterThan(schedule)
    expect(src).not.toMatch(/await\s+scheduleArchiveNow/)
  })

  it('⛔ 비밀키(CRON_SECRET)를 보내는 주소는 요청(Host 헤더)에서 만들지 않는다 — origin 인자 자체가 없고 호출부도 요청 URL을 쓰지 않는다', () => {
    const now = read('src/lib/server/contractArchive/archiveNow.ts')
    expect(now).toMatch(/export function scheduleArchiveNow\(reservationId: number \| string \| null \| undefined\): boolean/)
    expect(now).not.toMatch(/origin\?:/)
    for (const f of ['src/routes/api/contracts/[token]/sign/+server.ts', 'src/lib/server/sendApprovalNotifications.ts']) {
      const src = read(f)
      const call = src.match(/scheduleArchiveNow\([^)]*\)/g) ?? []
      expect(call.length, f).toBeGreaterThan(0)
      for (const c of call) expect(c, f).not.toMatch(/request|url|origin|host/i)
    }
  })

  it('서명+결제 완료 지점(승인 알림 헬퍼)에서도 호출하되 보류(hold)면 호출하지 않는다', () => {
    const src = read('src/lib/server/sendApprovalNotifications.ts')
    const hold = src.indexOf("if (notifyPlan.mode === 'hold') return")
    const sched = src.indexOf('scheduleArchiveNow(reservationId)')
    expect(hold).toBeGreaterThan(-1)
    expect(sched).toBeGreaterThan(hold)
    expect(src).not.toMatch(/await\s+scheduleArchiveNow/)
  })

  it('크론은 대상 지정 모드에서 Bearer 인증 뒤 숫자 예약 번호만 받고 소급·봉인 보강은 건너뛴다', () => {
    const src = read('src/routes/api/cron/contract-archive/+server.ts')
    const auth = src.indexOf("authorization') !== `Bearer ${cronSecret}`")
    const targeted = src.indexOf("searchParams.get('reservationId')")
    const backfill = src.indexOf('const backfill =')
    expect(auth).toBeGreaterThan(-1)
    expect(targeted).toBeGreaterThan(auth)
    expect(backfill).toBeGreaterThan(targeted)
    expect(src).toMatch(/\^\\d\{1,15\}\$/)
    // 즉시 생성 호출의 실패는 evidence_failed 기록(백오프 계산)에 반영하지 않는다
    expect(src).toContain('await processOne(ev, { recordFailure: false })')
    expect(src).toContain('if (opts.recordFailure !== false) await recordArchiveFailure(')
  })

  it('PDF 엔진은 서명·결제 함수에 들어가지 않는다(sign·승인 헬퍼가 renderPdf를 import하지 않음)', () => {
    for (const f of ['src/routes/api/contracts/[token]/sign/+server.ts', 'src/lib/server/sendApprovalNotifications.ts', 'src/lib/server/contractArchive/archiveNow.ts']) {
      expect(read(f), f).not.toMatch(/^\s*(import|export)[^\n]*(renderPdf|puppeteer|chromium|generateArchive)/im) // import 문만 점검(주석 설명 제외)
    }
  })

  it('안내 문구가 새 대기 시간(보통 1분)에 맞춰 바뀌었다', () => {
    expect(read('src/lib/components/cms/RentalContractViewer.svelte')).toContain('서명 완료 후 보통 1분 안에 표시됩니다.')
  })
})
