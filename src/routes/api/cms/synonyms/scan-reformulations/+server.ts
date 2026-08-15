// POST /api/cms/synonyms/scan-reformulations — 재검색 패턴 동의어 후보 스캔 (§G-3)
// manager 이상 전용. search_logs에서 "원 검색 0건 → 재검색 성공" 쌍을 추출하고
// synonym_group_members에 query_reformulation 출처로 등록합니다.
// 새 테이블·새 컬럼 없음 (search_logs를 SELECT 전용 재활용).

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { scanReformulationCandidates } from '$lib/server/searchReformulationScan'

export const POST: RequestHandler = async ({ locals }) => {
  // manager 이상 게이트 (§D-1 backfill-cross-lingual과 동일 패턴)
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })
  if (!hasSettingsAccess(cmsRole)) {
    return json({ error: '매니저 이상만 실행할 수 있습니다.' }, { status: 403 })
  }

  try {
    const startedAt = Date.now()
    const result = await scanReformulationCandidates()
    const elapsed = Math.round((Date.now() - startedAt) / 1000)

    return json({
      ok: true,
      totalPairs: result.totalPairs,
      registeredPairs: result.registeredPairs,
      skippedPairs: result.skippedPairs,
      elapsed_s: elapsed,
      message: `완료(${elapsed}초). 추출된 재검색 페어 ${result.totalPairs}건, 후보 등록/갱신 ${result.registeredPairs}건, 건너뜀 ${result.skippedPairs}건.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: msg }, { status: 500 })
  }
}
