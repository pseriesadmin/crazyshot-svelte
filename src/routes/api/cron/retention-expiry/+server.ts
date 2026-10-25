import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { sendPushToManagers } from '$lib/server/push'
import type { RequestHandler } from './$types'

// GET /api/cron/retention-expiry — Vercel Cron 전용(1일 1회, vercel.json crons 참고).
// 익명 전환된 계정의 법정 보존 기간(거래 5년·상담 3년)이 새로 만료된 건을 찾아 매니저 이상 관리자에게 알린다 (Migration #764).
// ⛔ 자동 삭제는 하지 않는다(2026-10-24 Stephen 확정) — 알림 + CMS 설정 '보존리포트' 화면 표시만. 같은 (계정, 종류)는 한 번만 알린다.
export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed)
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  try {
    const { data, error } = await admin.rpc('cms_retention_new_due')
    if (error) {
      console.error('[retention-expiry]', error.message)
      return json({ error: error.message }, { status: 500 })
    }
    const due = (data ?? []) as { user_id: string; kind: string }[]

    // 익명 전환 실패 알림(최근 26시간 — 매일 실행이라 같은 실패는 다음 날도 다시 알린다: 해결될 때까지 눈에 띄게)
    const { data: failed, error: failedErr } = await admin
      .from('account_deletion_events')
      .select('user_id')
      .eq('event', 'anonymize_failed')
      .gte('created_at', new Date(Date.now() - 26 * 3600 * 1000).toISOString())
    if (failedErr) console.error('[retention-expiry] 실패 이력 조회 오류:', failedErr.message)
    const failedCount = new Set((failed ?? []).map((f: { user_id: string }) => f.user_id)).size
    if (failedCount > 0) {
      await sendPushToManagers('retention_expiry', {
        title: '익명 전환에 실패한 계정이 있어요',
        body: `삭제 유예가 끝난 계정 ${failedCount}건의 익명 전환이 실패했어요. 설정 > 보존리포트에서 확인해 주세요.`,
        link: '/cms/set/retention',
      })
    }

    if (due.length === 0) return json({ ok: true, newDue: 0, anonymizeFailures: failedCount })

    // 먼저 알림 기록(같은 건을 다음 실행에서 다시 알리지 않는다) — 푸시가 실패해도 리포트 화면에는 계속 표시된다
    const { error: markErr } = await admin
      .from('retention_expiry_alerts')
      .upsert(due.map((d) => ({ user_id: d.user_id, kind: d.kind })), { onConflict: 'user_id,kind', ignoreDuplicates: true })
    if (markErr) {
      console.error('[retention-expiry] 알림 기록 실패:', markErr.message)
      return json({ error: markErr.message }, { status: 500 })
    }

    const tx = due.filter((d) => d.kind === 'transaction').length
    const chat = due.filter((d) => d.kind === 'chat').length
    const parts = [tx > 0 ? `거래 기록 ${tx}건` : '', chat > 0 ? `상담 기록 ${chat}건` : ''].filter(Boolean)
    await sendPushToManagers('retention_expiry', {
      title: '법정 보존 기간이 만료된 기록이 있어요',
      body: `${parts.join(', ')}의 보존 기간이 만료됐어요. 설정 > 보존리포트에서 확인해 주세요(자동 삭제되지 않아요).`,
      link: '/cms/set/retention',
    })
    return json({ ok: true, newDue: due.length, transaction: tx, chat, anonymizeFailures: failedCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[retention-expiry]', message)
    return json({ error: message }, { status: 500 })
  }
}
