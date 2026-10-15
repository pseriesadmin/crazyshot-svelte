// 본인증명 등록 요청 호출 (2026-10-15) — 상품상세 장바구니 담기·예약신청, 장바구니 예약신청 공용(브라우저 전용).
// 예전에는 서류 미등록·승인 대기 고객에게 차단 토스트(showDocGateToast)를 띄워 예약을 막았다. 지금은 예약을 막지 않고,
// 서류가 미등록(none)이면 서버가 기존 "본인증명 등록요청" 대화카드 + 푸시 + SMS로 등록을 요청한다(서버가 24시간 중복 방지).
// 응답을 기다리지 않고(fire-and-forget) 실패해도 화면에 아무것도 띄우지 않는다 — 예약 흐름에 영향이 없어야 한다.
// 승인 대기(pending)·승인 완료는 요청할 필요가 없어 호출하지 않는다(서버도 같은 판정을 다시 한다).
import type { DocGateStatus } from '$lib/utils/docApproval'

// 같은 화면(페이지 수명) 안에서는 한 번만 호출한다 — 담기→예약신청 연속 클릭·더블클릭으로 서버에 동시 요청이 겹치는 것을 줄인다(서버도 24시간 중복 방지).
let requestedOnce = false

export function requestDocRegistrationIfNeeded(gate: DocGateStatus): void {
  if (gate !== 'none' || requestedOnce) return
  requestedOnce = true
  try {
    void fetch('/api/profile/doc-request', { method: 'POST' }).catch(() => undefined)
  } catch {
    // 요청 실패는 예약 흐름과 무관 — 무시
  }
}
