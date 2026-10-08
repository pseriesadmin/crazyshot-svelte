/**
 * GET /api/contracts/seal-public-key — 서명 봉인 공개키 목록(공개)
 * 공개키는 비밀이 아니다. 누구나 이 키로 봉인 증명서(원문+서명)를 서버 DB 없이 검증할 수 있다.
 */
import { json } from '@sveltejs/kit'
import { getSealPublicKeys } from '$lib/server/contractArchive/sealEnv'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
  return json(
    { algorithm: 'ed25519', keys: getSealPublicKeys().map((k) => ({ keyId: k.keyId, publicKeyPem: k.publicKeyPem })) },
    { headers: { 'cache-control': 'public, max-age=300' } },
  )
}
