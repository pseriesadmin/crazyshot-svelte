/**
 * archiveNow.ts — 서명·결제 직후 최종본 PDF를 "바로" 만들도록 보관 크론 엔드포인트를 즉시 호출한다 (2026-10-08, Stephen 지시)
 *
 * 배경: 최종본 PDF는 10분마다 도는 크론(/api/cron/contract-archive)이 만들어 서명 후 최대 10분(평균 5분) 기다려야 했다(실제 생성은 약 13초).
 * 방식: 서명 API(sign)와 "서명+결제 완료" 지점(sendApprovalNotifications — 승인 알림 5개 발신지점 공용)이 응답을 돌려준 뒤 백그라운드에서
 *   같은 크론 엔드포인트를 `?reservationId=` 대상 지정으로 호출한다. 무거운 작업(Chromium)은 이미 전용 함수(maxDuration 300초)로 분리된 크론 함수가 하므로
 *   서명·결제 함수에는 PDF 엔진이 들어가지 않고, 고객 응답도 지연되지 않는다.
 * 안전장치: ① 이 호출이 실패·누락돼도 10분 크론이 그대로 처리한다(fallback) ② 이미 보관된 증적은 멱등(alreadyArchived)이라 서명 직후·결제 직후 두 번 불러도 한 번만 만든다
 *   ③ 호출 실패는 절대 throw하지 않는다(서명·결제 흐름 보호) ④ CRON_SECRET이 없으면 호출하지 않는다.
 * 백그라운드 실행: Vercel은 응답 뒤 함수가 멈추므로 요청 컨텍스트의 waitUntil로 작업이 끝날 때까지 살려 둔다(@vercel/functions와 같은 공개 심볼 — 의존성 추가 없음).
 *   Vercel인데 waitUntil을 찾지 못하면 호출하지 않고 크론에 맡긴다(응답 뒤 멈춰 중간에 끊기는 것보다 안전).
 */
import { env } from '$env/dynamic/private'

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
const CALL_TIMEOUT_MS = 120_000

type WaitUntil = (promise: Promise<unknown>) => void

function getWaitUntil(): WaitUntil | null {
  const holder = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: WaitUntil } | undefined } | undefined>)[REQUEST_CONTEXT]
  const ctx = holder?.get?.()
  return typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null
}

/**
 * 응답 뒤에도 작업이 끝날 때까지 실행을 보장하며 백그라운드로 돌린다. 시작했으면 true, 보장할 수 없어 시작하지 않았으면 false.
 * 작업 실패는 삼켜 로그만 남긴다.
 */
export function runInBackground(task: () => Promise<unknown>): boolean {
  const run = (): Promise<unknown> => task().catch((e) => console.error('[archiveNow] 백그라운드 작업 실패(크론이 이어서 처리):', e instanceof Error ? e.message : e))
  const waitUntil = getWaitUntil()
  if (waitUntil) { waitUntil(run()); return true }
  if (process.env.VERCEL) return false // 서버리스에서 응답 뒤 멈출 수 있는 방식은 쓰지 않는다
  void run() // 로컬·장기 실행 서버는 그냥 돌려도 된다
  return true
}

/** 현재 배포 호스트(운영은 대표 도메인) — 플랫폼이 정하는 환경변수에서만 만든다. 로컬은 null(호출하지 않음, 크론을 직접 호출) */
function defaultOrigin(): string | null {
  if (env.VERCEL_ENV === 'production') return env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://crazyshot.kr' // 시스템 환경변수 노출이 꺼져 있어도 운영은 대표 도메인
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`
  return null
}

export function buildArchiveNowUrl(origin: string, reservationId: number | string): string {
  return `${origin.replace(/\/+$/, '')}/api/cron/contract-archive?reservationId=${encodeURIComponent(String(reservationId))}`
}

/**
 * 이 예약(같은 주문의 형제 포함)의 서명 증적 중 보관본이 없는 건을 지금 만들도록 크론 엔드포인트를 호출한다. 절대 throw하지 않는다.
 * 대상 지정 호출의 실패는 evidence_failed 기록·백오프에 반영되지 않는다(크론 대상 지정 모드가 기록을 생략 — 즉시 호출 실패가 10분 크론 재시도를 늦추지 않게).
 * @returns 호출을 시작했으면 true(결과는 기다리지 않음), 아니면 false(크론이 처리)
 */
export function scheduleArchiveNow(reservationId: number | string | null | undefined): boolean {
  try {
    if (reservationId == null || env.CRON_SECRET == null || env.CRON_SECRET === '') return false
    if (env.CONTRACT_ARCHIVE_ENABLED === 'false') return false
    // ⛔ 호출 주소는 서버가 정한 값(환경변수)만 쓴다 — 요청의 Host 헤더에서 만든 origin으로 CRON_SECRET을 보내면 비밀키 유출 경로가 된다(sp3 MAJOR-1).
    const base = defaultOrigin()
    if (!base) return false
    const url = buildArchiveNowUrl(base, reservationId)
    const secret = env.CRON_SECRET
    return runInBackground(async () => {
      const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
      if (!res.ok) console.error('[archiveNow] 즉시 생성 호출 응답 오류:', res.status)
    })
  } catch (e) {
    console.error('[archiveNow] 즉시 생성 예약 실패(크론이 이어서 처리):', e instanceof Error ? e.message : e)
    return false
  }
}
