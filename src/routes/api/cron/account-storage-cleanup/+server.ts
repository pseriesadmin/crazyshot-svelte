import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'

// GET /api/cron/account-storage-cleanup — Vercel Cron 전용(1일 1회, vercel.json crons 참고).
// 익명 전환(Migration #763)된 계정의 서류·아바타 파일을 저장소 API로 삭제한다. 대기열: account_storage_cleanup.
// SQL로 storage.objects 행만 지우면 실제 파일이 남을 수 있어 서버가 API로 지운다. 실패하면 시도 횟수를 올리고 다음 실행에서 재시도한다(최대 5회).
const MAX_ATTEMPTS = 5
const BATCH = 20

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: jobs, error } = await admin
    .from('account_storage_cleanup')
    .select('id, user_id, bucket, prefix, attempts')
    .is('done_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('[account-storage-cleanup]', error.message)
    return json({ error: error.message }, { status: 500 })
  }

  let done = 0
  let failed = 0
  for (const job of (jobs ?? []) as { id: number; user_id: string; bucket: string; prefix: string; attempts: number }[]) {
    try {
      // 계정 폴더({uid}/) 바로 아래 파일을 모두 지운다(서류·아바타는 한 단계 폴더 구조)
      const folder = job.prefix.replace(/\/$/, '')
      const { data: files, error: listErr } = await admin.storage.from(job.bucket).list(folder, { limit: 1000 })
      if (listErr) throw new Error(listErr.message)
      const paths = (files ?? []).filter((f) => f.name).map((f) => `${folder}/${f.name}`)
      if (paths.length > 0) {
        const { error: rmErr } = await admin.storage.from(job.bucket).remove(paths)
        if (rmErr) throw new Error(rmErr.message)
      }
      await admin.from('account_storage_cleanup').update({ done_at: new Date().toISOString(), attempts: job.attempts + 1 }).eq('id', job.id)
      done++
    } catch (err) {
      failed++
      console.error('[account-storage-cleanup] 실패:', job.bucket, err instanceof Error ? err.message : err)
      await admin.from('account_storage_cleanup').update({ attempts: job.attempts + 1 }).eq('id', job.id)
    }
  }
  return json({ ok: true, processed: (jobs ?? []).length, done, failed })
}
