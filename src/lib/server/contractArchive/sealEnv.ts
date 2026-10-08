/**
 * sealEnv.ts — 봉인 키를 환경변수에서 읽는 얇은 어댑터(서버 전용)
 * 키 값 자체는 어디에도 기록·로그하지 않는다.
 */
import { env } from '$env/dynamic/private'
import { loadSealKey, loadSealPublicKeys, type SealKey, type SealPublicKey } from './seal'

/** 봉인을 만들 수 있는 키(없으면 null — 봉인 기능 꺼짐, 보관은 계속) */
export function getSealKey(): SealKey | null {
  return loadSealKey(env.ARCHIVE_SEAL_KEY)
}

/** 검증에 쓸 공개키들(현재 키 + 이전 키) */
export function getSealPublicKeys(): SealPublicKey[] {
  return loadSealPublicKeys(getSealKey(), env.ARCHIVE_SEAL_PUBLIC_KEYS)
}
