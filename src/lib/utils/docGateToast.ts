// 예약신청 전 본인증명 게이트 안내 토스트 + [문의] 원클릭 (2026-10-05) — 상품상세·장바구니 공용(브라우저 전용).
//   none    : "본인증명정보를 등록해주세요." [확인] → 개인정보 서류 탭(고객 유형에 맞는 identity|foreign)
//   pending : "본인증명정보를 승인 중입니다. 조금만 기다려 주세요." [문의] → 서버가 문의·자동 안내를 상담 채팅에 남기고 상담톡을 연다
import { goto } from '$app/navigation'
import { csToast } from '$lib/utils/toast'
import { openChat } from '$lib/stores/chat.svelte'
import { DOC_GATE_MESSAGES, type DocGateStatus } from '$lib/utils/docApproval'

let inquiryInFlight = false

/** 승인 대기 문의: 서버가 문의 메시지·자동 안내·관리자 푸시를 처리한 뒤 상담톡을 연다(실패해도 상담톡은 열어 직접 문의할 수 있게 한다). */
export async function requestDocInquiry(): Promise<void> {
  if (inquiryInFlight) return
  inquiryInFlight = true
  try {
    const res = await fetch('/api/profile/doc-inquiry', { method: 'POST' })
    if (!res.ok) csToast.error('문의 접수에 실패했어요. 상담창에서 직접 문의해주세요.')
  } catch {
    csToast.error('네트워크 오류가 발생했어요. 상담창에서 직접 문의해주세요.')
  } finally {
    inquiryInFlight = false
    openChat()
  }
}

/** gate가 approved가 아니면 안내 토스트를 띄우고 true(=차단)를 반환한다. */
export function showDocGateToast(gate: DocGateStatus, kind: 'identity' | 'foreign' = 'identity'): boolean {
  if (gate === 'approved') return false
  if (gate === 'pending') {
    csToast.warning(DOC_GATE_MESSAGES.pending, {
      actionLabel: '문의',
      duration: 8000,
      onClick: () => { void requestDocInquiry() },
    })
    return true
  }
  csToast.warning(DOC_GATE_MESSAGES.none, {
    actionLabel: '확인',
    duration: 8000,
    onClick: () => {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      void goto(`/account/profile?tab=profile&doc=${kind}&returnTo=${returnTo}`)
    },
  })
  return true
}
