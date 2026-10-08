/**
 * POST /api/contracts/verify-file — 로그인 없이 "이 PDF가 서명 당시 보관된 원본과 같은가" 확인 (공개)
 *
 * 입력: { sha256: "<64자 소문자 hex>" } — 브라우저가 파일에서 계산한 지문. PDF 파일 자체(개인정보 포함)는 받지 않는다.
 * 판정은 서버 보관 기록과의 대조로만 한다(verifyArchive.ts). 일치할 때만 개인정보 없는 최소 정보
 * (서명 일시·보관본 구분·가린 예약코드)를 돌려준다. SHA-256은 추측·역산할 수 없어 존재 여부 탐색이 불가능하다.
 * 남용 방지: IP당 분당 20회(인스턴스 메모리, 최선 노력) + 요청 본문 1KB 제한.
 * 결과(일치 기록이 있는 경우)는 계약 감사로그에 남긴다(누가 언제 어떤 결과를 확인했는지).
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createRateLimiter } from '$lib/server/simpleRateLimit'
import { isSha256Hex, recordVerifyOutcome, verifyPublicHash } from '$lib/server/contractArchive/verifyArchive'
import { getSealPublicKeys } from '$lib/server/contractArchive/sealEnv'
import type { RequestHandler } from './$types'

const limiter = createRateLimiter(20, 60_000)
const HEADERS = { 'cache-control': 'no-store' }

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  let ip: string | null = null
  try { ip = getClientAddress() } catch { ip = null }
  if (!limiter.allow(ip ?? 'unknown')) {
    return json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429, headers: HEADERS })
  }

  // 큰 본문은 읽기 전에 거절한다(Content-Length가 있으면 우선 확인)
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return json({ error: '요청이 올바르지 않습니다.' }, { status: 400, headers: HEADERS })
  const raw = await request.text()
  if (raw.length > 1024) return json({ error: '요청이 올바르지 않습니다.' }, { status: 400, headers: HEADERS })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: '요청이 올바르지 않습니다.' }, { status: 400, headers: HEADERS }) }
  const sha256 = typeof (body as { sha256?: unknown })?.sha256 === 'string' ? (body as { sha256: string }).sha256.trim().toLowerCase() : null
  if (!isSha256Hex(sha256)) return json({ error: '파일 지문 형식이 올바르지 않습니다.' }, { status: 400, headers: HEADERS })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const result = await verifyPublicHash(admin, sha256, getSealPublicKeys())
  await recordVerifyOutcome(admin, { contractId: result.contractId, finalDocumentId: result.finalDocumentId, result, via: 'public', actorId: null, ip })

  // 서버 보관 파일 이상 여부(archiveIntact)는 운영 경보용이라 공개 응답에는 싣지 않는다
  // 봉인 경보(invalid)·보관 파일 이상은 운영용이라 숨기고, 봉인이 정상 확인된 경우만 알린다
  return json({ status: result.status, sealed: result.seal === 'valid', info: result.info, sha256, checkedAt: new Date().toISOString() }, { headers: HEADERS })
}
