// 실패해도 본 흐름(결제·재고 확정 등)을 막지 않는 fire-and-forget 요청 헬퍼 (2026-10-03).
// 기존 `.catch(() => {})`는 네트워크 오류만 잡고 HTTP 4xx/5xx(res.ok=false)는 조용히 지나쳤다 — 둘 다 경고 로그로 남긴다.
// 사용자에게 토스트는 띄우지 않는다(이미 성공한 예약에 불필요한 불안을 주지 않기 위함).
export function fireAndLog(label: string, url: string, body: unknown): void {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) console.warn(`[${label}] HTTP ${res.status}`)
    })
    .catch((e) => {
      console.warn(`[${label}] 요청 실패:`, e instanceof Error ? e.message : e)
    })
}
