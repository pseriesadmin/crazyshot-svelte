import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import {
  archiveEvidence,
  createLegacyEvidence,
  listLegacySignings,
  listPendingEvidence,
  listPendingEvidenceForReservation,
  recordArchiveFailure,
  type EvidenceRecord,
} from '$lib/server/contractArchive/generateArchive'
import { getSealKey } from '$lib/server/contractArchive/sealEnv'
import { sealPendingDocuments } from '$lib/server/contractArchive/sealPending'
import type { RequestHandler } from './$types'

// Chromium 기동 + 렌더링 여유 — 전용 함수로 분리된다(adapter-vercel 라우트별 설정)
export const config = { maxDuration: 300 }

const MAX_CREATED_PER_RUN = 3 // 한 번에 만드는 PDF 수(브라우저는 순차 실행 — Lambda 메모리 보호)
const MAX_ATTEMPTS_PER_RUN = 8 // 실패 건이 앞줄을 막아도 뒤 건이 처리되도록 시도 상한을 따로 둔다
const TIME_BUDGET_MS = 240_000
const MAX_CONSECUTIVE_FAILURES = 3 // 연속 3건 실패하면 시스템 장애로 보고 이번 실행을 멈춘다(Lambda 시간·메모리 낭비 방지)

// GET /api/cron/contract-archive — Vercel Cron 전용(10분 간격, vercel.json).
// 서명 증적은 있는데 최종본 PDF가 없는 건을 오래된 순으로 만들어 보관한다(서명 응답은 PDF 생성에 막히지 않는다).
// 소급: 서명 증적 도입 전 서명 건은 CONTRACT_ARCHIVE_BACKFILL=1(또는 ?backfill=1)일 때 "소급 증적"을 만들어 재생성본으로 보관한다.
// 끄기: CONTRACT_ARCHIVE_ENABLED=false — PDF 생성만 멈춘다(서명·동의 기록은 계속 쌓인다).
export const GET: RequestHandler = async ({ request, url }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed)
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  if (env.CONTRACT_ARCHIVE_ENABLED === 'false') return json({ ok: true, skipped: 'disabled' })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const started = Date.now()
  const sealKey = getSealKey() // 없으면 봉인 기능 꺼짐(보관은 계속)
  const results: { evidenceId: string; contractId: string; ok: boolean; source?: string; reason?: string }[] = []
  let created = 0
  let attempts = 0
  let consecutiveFailures = 0
  let waiting = 0
  let stalled = 0
  let sealSummary: Awaited<ReturnType<typeof sealPendingDocuments>> | null = null

  const processOne = async (ev: EvidenceRecord, opts: { recordFailure?: boolean } = {}): Promise<void> => {
    attempts++
    const r = await archiveEvidence(admin, ev, { sealKey })
    if (r.ok) {
      consecutiveFailures = 0
      if (!r.alreadyArchived) created++
      results.push({ evidenceId: ev.id, contractId: ev.contract_id, ok: true, source: r.source })
    } else {
      console.error('[cron/contract-archive] 보관 실패:', ev.id, r.reason)
      if (!r.permanent) consecutiveFailures++
      // 대상 지정(즉시 생성) 호출의 실패는 기록하지 않는다 — 기록하면 10분 크론의 재시도 백오프가 길어진다(sp3 MINOR). 실패는 응답·서버 로그에만 남는다.
      if (opts.recordFailure !== false) await recordArchiveFailure(admin, ev, r.reason, !!r.permanent)
      results.push({ evidenceId: ev.id, contractId: ev.contract_id, ok: false, reason: r.reason })
    }
  }
  // 대상 지정 모드(`?reservationId=`): 서명·결제 직후 즉시 생성 호출(archiveNow.ts) — 그 예약(같은 주문 형제 포함)의 대기 증적만 만든다.
  // 소급·봉인 보강·다른 대기 건은 건드리지 않는다(빨리 끝나야 하고, 다른 건 처리는 10분 크론 몫). 인증은 위 Bearer 검사를 그대로 거친다.
  const reservationParam = url.searchParams.get('reservationId')
  if (reservationParam !== null) {
    if (!/^\d{1,15}$/.test(reservationParam)) return json({ error: 'reservationId가 올바르지 않습니다.' }, { status: 400 })
    try {
      const items = await listPendingEvidenceForReservation(admin, reservationParam)
      for (const ev of items) {
        if (Date.now() - started >= TIME_BUDGET_MS) break
        await processOne(ev, { recordFailure: false })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[cron/contract-archive] 대상 지정 처리 중단:', message)
      return json({ ok: false, error: message, targeted: reservationParam, created, attempts, results }, { status: 500 })
    }
    return json({ ok: true, targeted: reservationParam, created, attempts, failed: results.filter((r) => !r.ok).length, results })
  }

  const budgetLeft = (): boolean =>
    created < MAX_CREATED_PER_RUN && attempts < MAX_ATTEMPTS_PER_RUN && consecutiveFailures < MAX_CONSECUTIVE_FAILURES && Date.now() - started < TIME_BUDGET_MS

  try {
    const pending = await listPendingEvidence(admin, MAX_ATTEMPTS_PER_RUN, { ignoreBackoff: url.searchParams.get('retry') === '1' })
    waiting = pending.waiting
    stalled = pending.stalled
    if (stalled > 0) console.error(`[cron/contract-archive] 오래 막힌 건 ${stalled}건(실패 5회 이상) — 원인 확인 필요`)
    for (const ev of pending.items) {
      if (!budgetLeft()) break
      await processOne(ev)
    }

    const backfill = env.CONTRACT_ARCHIVE_BACKFILL === '1' || url.searchParams.get('backfill') === '1'
    if (backfill && budgetLeft()) {
      for (const s of await listLegacySignings(admin, MAX_ATTEMPTS_PER_RUN)) {
        if (!budgetLeft()) break
        const ev = await createLegacyEvidence(admin, s)
        if (ev) await processOne(ev)
      }
    }

    // 봉인이 아직 없는 보관본(키 설정 전 생성분·봉인 실패분) 보강 — 실패해도 보관 크론 결과에는 영향 없다
    if (sealKey && Date.now() - started < TIME_BUDGET_MS) {
      try { sealSummary = await sealPendingDocuments(admin, sealKey, 20, { deadlineMs: started + TIME_BUDGET_MS }) } catch (e) { console.error('[cron/contract-archive] 봉인 보강 실패:', e instanceof Error ? e.message : e) }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[cron/contract-archive] 처리 중단:', message)
    return json({ ok: false, error: message, created, attempts, results }, { status: 500 })
  }

  return json({ ok: true, created, attempts, failed: results.filter((r) => !r.ok).length, waiting, stalled, seal: sealKey ? sealSummary : 'disabled', stoppedEarly: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES, results })
}
