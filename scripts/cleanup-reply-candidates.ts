// cleanup-reply-candidates.ts — 빠른답변 후보 중 재사용 가치 없는 쌍을 찾아 보고하고(기본: 보기만), 승인 후 삭제한다.
//
// 사용(보기만):  PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/cleanup-reply-candidates.ts
// 삭제 실행:     … npx tsx scripts/cleanup-reply-candidates.ts --delete   (Stephen 승인 후에만)
//   · 대상: status='pending' 후보만. 승인(approved)·수동 거부(rejected) 건은 건드리지 않는다.
//   · 판정 기준: src/lib/server/crazychat/replyCandidateFilter.ts (등록 시점 판정과 동일)
//   · 개인정보 보호: 사유별 건수만 출력, 샘플은 --samples N 으로 요청할 때만 앞 40자까지 출력.
import { createClient } from '@supabase/supabase-js'
import { judgeReplyCandidate, EXCLUSION_LABEL } from '../src/lib/server/crazychat/replyCandidateFilter'

function flag(name: string): boolean {
  return process.argv.includes(name)
}
function num(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) || fallback : fallback
}

async function main(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await db
    .from('chat_reply_candidates')
    .select('id, customer_message, admin_reply')
    .eq('status', 'pending')
    .limit(5000)
  if (error) throw new Error(error.message)
  const rows = data ?? []

  const byReason = new Map<string, string[]>()
  const keepIds: string[] = []
  const dropIds: string[] = []
  const samples: string[] = []
  const sampleLimit = num('--samples', 0)
  for (const r of rows) {
    const v = judgeReplyCandidate(r.customer_message, r.admin_reply)
    if (v.keep) {
      keepIds.push(r.id)
      continue
    }
    dropIds.push(r.id)
    const reason = v.reason ?? 'low_value'
    byReason.set(reason, [...(byReason.get(reason) ?? []), r.id])
    if (samples.length < sampleLimit) samples.push(`[${EXCLUSION_LABEL[reason as keyof typeof EXCLUSION_LABEL]}] ${r.customer_message.slice(0, 40)} → ${r.admin_reply.slice(0, 40)}`)
  }

  console.log(`대기 후보 ${rows.length}건 → 유지 ${keepIds.length}건 / 제거 대상 ${dropIds.length}건`)
  for (const [reason, ids] of byReason) console.log(`  · ${EXCLUSION_LABEL[reason as keyof typeof EXCLUSION_LABEL]}: ${ids.length}건`)
  for (const s of samples) console.log(s)

  if (!flag('--delete')) {
    console.log('보기만 했습니다. 삭제하려면 --delete 를 붙이세요.')
    return
  }
  for (let i = 0; i < dropIds.length; i += 100) {
    const { error: delErr } = await db.from('chat_reply_candidates').delete().in('id', dropIds.slice(i, i + 100)).eq('status', 'pending')
    if (delErr) throw new Error(delErr.message)
  }
  console.log(`삭제 완료: ${dropIds.length}건`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
