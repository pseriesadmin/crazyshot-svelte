// cannedCtaPayload.ts — 빠른답변의 CTA(이미지·버튼·링크) → 'canned_cta' 액션카드 payload 변환 (서버 전용 순수함수)
// 고객 자동매칭(api/chat/message)과 관리자 수동 전송(api/chat/admin-reply) 두 경로가 반드시 이 함수 하나를
// 공유한다 — 과거엔 자동매칭만 카드를 만들고 관리자 전송은 텍스트만 보내 CTA·링크가 빠졌다(2026-10-02).
import { isValidCtaUrl } from '$lib/utils/ctaUrl'
import { extractCannedMedia, type CannedMediaItem } from '$lib/utils/cannedBlocks'
import type { ContentBlock } from '$lib/types/content-editor'

export interface CannedCtaSource {
  id: string
  image_url?: string | null
  cta_label?: string | null
  cta_url?: string | null
  /** 서식 본문 — 이미지·동영상만 썸네일로 카드에 싣는다(글자는 채팅 본문 텍스트가 따로 전달) */
  content_blocks?: unknown
}

// interface가 아니라 type — Record<string, unknown>(action_payload)에 바로 대입 가능해야 한다
export type CannedCtaPayload = {
  type: 'canned_cta'
  button_label: string
  action_url: string | null
  product_image: string | null
  canned_response_id: string
  /** 서식 본문의 이미지·동영상 썸네일(최대 6개) — 없으면 키 자체를 생략 */
  media?: CannedMediaItem[]
}

/**
 * 이미지·버튼 텍스트·링크 중 하나라도 있으면 카드로 만든다(링크만 있어도 카드 — 버튼 텍스트 기본값 '확인하기').
 * 유효하지 않은 링크(http(s)/내부경로 외)는 action_url=null로 버린다. 카드 요소가 전혀 없으면 null(일반 텍스트).
 */
export function buildCannedCtaPayload(c: CannedCtaSource): CannedCtaPayload | null {
  const image = c.image_url?.trim() || null
  const label = c.cta_label?.trim() || null
  const rawUrl = c.cta_url?.trim() || null
  const media = extractCannedMedia(Array.isArray(c.content_blocks) ? (c.content_blocks as ContentBlock[]) : null)
  if (!image && !label && !rawUrl && media.length === 0) return null
  // 썸네일만 있는 카드(버튼·링크·대표 이미지 없음)는 눌러서 갈 곳이 없으므로 버튼 문구를 비워 화면이 버튼을 숨기게 한다
  const mediaOnly = !image && !label && !rawUrl
  return {
    type: 'canned_cta',
    button_label: mediaOnly ? '' : (label ?? '확인하기'),
    action_url: isValidCtaUrl(rawUrl) ? rawUrl : null,
    product_image: image,
    canned_response_id: c.id,
    ...(media.length > 0 ? { media } : {}),
  }
}
