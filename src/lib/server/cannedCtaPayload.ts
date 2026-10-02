// cannedCtaPayload.ts — 빠른답변의 CTA(이미지·버튼·링크) → 'canned_cta' 액션카드 payload 변환 (서버 전용 순수함수)
// 고객 자동매칭(api/chat/message)과 관리자 수동 전송(api/chat/admin-reply) 두 경로가 반드시 이 함수 하나를
// 공유한다 — 과거엔 자동매칭만 카드를 만들고 관리자 전송은 텍스트만 보내 CTA·링크가 빠졌다(2026-10-02).
import { isValidCtaUrl } from '$lib/utils/ctaUrl'

export interface CannedCtaSource {
  id: string
  image_url?: string | null
  cta_label?: string | null
  cta_url?: string | null
}

// interface가 아니라 type — Record<string, unknown>(action_payload)에 바로 대입 가능해야 한다
export type CannedCtaPayload = {
  type: 'canned_cta'
  button_label: string
  action_url: string | null
  product_image: string | null
  canned_response_id: string
}

/**
 * 이미지·버튼 텍스트·링크 중 하나라도 있으면 카드로 만든다(링크만 있어도 카드 — 버튼 텍스트 기본값 '확인하기').
 * 유효하지 않은 링크(http(s)/내부경로 외)는 action_url=null로 버린다. 카드 요소가 전혀 없으면 null(일반 텍스트).
 */
export function buildCannedCtaPayload(c: CannedCtaSource): CannedCtaPayload | null {
  const image = c.image_url?.trim() || null
  const label = c.cta_label?.trim() || null
  const rawUrl = c.cta_url?.trim() || null
  if (!image && !label && !rawUrl) return null
  return {
    type: 'canned_cta',
    button_label: label ?? '확인하기',
    action_url: isValidCtaUrl(rawUrl) ? rawUrl : null,
    product_image: image,
    canned_response_id: c.id,
  }
}
