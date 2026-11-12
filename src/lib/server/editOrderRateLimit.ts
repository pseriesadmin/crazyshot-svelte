// 예약정보 수정 저장 API(edit-order) 전용 속도 제한 — DB 원자 함수 security_rate_take(Migration #809)를 호출한다.
// 이 파일은 src/lib/server/guard/rateLimit.ts(관제 모듈, 다른 세션 작업 중이라 아직 저장소에 없음)와 같은 방식을 최소로 복사한 것이다 —
// guard 모듈이 커밋되면 그쪽 takeRate 로 합칠 수 있다. 그때까지 edit-order 가 아직 커밋되지 않은 폴더에 의존해 배포 빌드가 깨지지 않게 한다.
// 원칙: 제한 조회가 실패하면 허용(fail-open) — 이 장치의 고장이 정상 고객을 막지 않게 한다(실패는 로그로 남김). 키는 해시로만 보낸다.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RateRule {
  /** 제한 종류 이름(40자 이하) */
  bucket: string
  /** 대상(사용자 id 등 원문) — 전송 전에 해시한다 */
  key: string
  windowSeconds: number
  max: number
}

function hashRateKey(raw: string): string {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex').slice(0, 40)
}

/** 한 번 세고 허용 여부를 돌려준다. 오류는 허용(true) */
export async function takeRate(admin: SupabaseClient, rule: RateRule): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('security_rate_take', {
      p_bucket: rule.bucket,
      p_key_hash: hashRateKey(rule.key || 'unknown'),
      p_window_seconds: rule.windowSeconds,
      p_max: rule.max,
    })
    if (error) {
      console.error(`[rate-limit] ${rule.bucket} 조회 실패(허용 처리):`, error.message)
      return true
    }
    return data !== false
  } catch (err) {
    console.error(`[rate-limit] ${rule.bucket} 오류(허용 처리):`, err instanceof Error ? err.message : 'unknown')
    return true
  }
}
