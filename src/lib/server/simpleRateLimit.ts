/**
 * simpleRateLimit.ts — 인스턴스 메모리 기반 슬라이딩 윈도우 요청 제한 (최선 노력)
 *
 * 서버리스는 인스턴스가 여러 개라 전역 한도는 아니다 — 한 인스턴스에 몰리는 반복 요청(가장 흔한 남용)을 줄이는 용도다.
 * 진짜 전역 제한이 필요하면 Vercel Firewall 규칙으로 올린다.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  return {
    /** true = 허용, false = 한도 초과 */
    allow(key: string): boolean {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k) // 메모리 보호
      return true
    },
  }
}
