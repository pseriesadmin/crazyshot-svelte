// build-semantic-model.ts — 의미 벡터 모델 수동 빌드(크론 /api/cron/nlsearch-vectors 와 같은 함수)
// 사용: PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/nlsearch/build-semantic-model.ts [--force]
//   · 환경변수가 가리키는 DB에 쓴다(로컬 .env.local = Stage). Production은 Stephen 승인 후 별도 실행.
//   · 출력은 숫자·상태만(말뭉치 문구 없음).
import { createClient } from '@supabase/supabase-js'
import { buildAndStoreSemanticModel, loadLatestSemanticModel } from '../../src/lib/server/searchEngine/adapters/semanticModelStore'

async function main(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다')
  const admin = createClient(url, key)
  const t0 = Date.now()
  const outcome = await buildAndStoreSemanticModel(admin, { force: process.argv.includes('--force') })
  console.log(JSON.stringify(outcome))
  const loaded = await loadLatestSemanticModel(admin)
  console.log(JSON.stringify({ loadOk: loaded !== null, vocab: loaded?.vocab.length ?? 0, dim: loaded?.dim ?? 0, totalMs: Date.now() - t0 }))
  if (outcome.status === 'failed') process.exit(1)
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
