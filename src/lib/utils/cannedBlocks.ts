// cannedBlocks.ts — 빠른답변(canned_responses) 서식 본문(content_blocks) 순수 변환 유틸 (서버·브라우저 공용)
// 정책(2026-10-14, Stephen 확정): 공통 문서 편집기(RichContentEditor)로 작성한 서식 본문은 content_blocks에 저장하고,
// content(순수 텍스트)는 항상 그 파생값으로 함께 저장한다 — 채팅·검색·자동답변·크레이지챗은 content만 읽으므로 서식이 새어 들어가지 않는다.
// 이미지·동영상은 텍스트에서 빠지고 채팅 카드의 썸네일(media)로 따로 전달된다. help 화면은 content_blocks를 서식 그대로 보여준다.
import type { ContentBlock } from '$lib/types/content-editor'

/** 채팅 카드에 싣는 썸네일 항목 */
export type CannedMediaItem =
  | { type: 'image'; url: string; alt: string }
  | { type: 'youtube'; videoId: string }

/** 채팅 카드 한 장에 싣는 최대 썸네일 수(카드가 길어지는 것 방지) */
export const CANNED_MEDIA_MAX = 6

const BLOCK_END_TAGS = /<\/(p|div|h[1-6]|li|blockquote|pre|tr|figure|ul|ol|table)>/gi
const BR_TAG = /<br\s*\/?>/gi
const LI_OPEN = /<li[^>]*>/gi
const ANY_TAG = /<[^>]*>/g

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
}

/** HTML 조각 → 줄바꿈이 보존된 순수 텍스트 */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  const text = html
    .replace(BR_TAG, '\n')
    .replace(LI_OPEN, '• ')
    .replace(BLOCK_END_TAGS, '\n')
    .replace(ANY_TAG, '')
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 서식 본문 → 채팅·검색용 순수 텍스트. 이미지·동영상·구분선은 제외, 링크 블록은 "문구" 로만 남긴다. */
export function blocksToPlainText(blocks: readonly ContentBlock[] | null | undefined): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push(htmlToPlainText(b.html))
    else if (b.type === 'html') parts.push(htmlToPlainText(b.content))
    else if (b.type === 'link-entry') parts.push(b.text?.trim() ?? '')
  }
  return parts.filter(Boolean).join('\n\n').trim()
}

/** 서식 본문의 이미지·동영상을 채팅 카드용 썸네일 목록으로 뽑는다(순서 유지, 최대 CANNED_MEDIA_MAX개). */
export function extractCannedMedia(blocks: readonly ContentBlock[] | null | undefined, max: number = CANNED_MEDIA_MAX): CannedMediaItem[] {
  if (!Array.isArray(blocks)) return []
  const out: CannedMediaItem[] = []
  for (const b of blocks) {
    if (out.length >= max) break
    if (b.type === 'image') {
      for (const img of b.images ?? []) {
        if (out.length >= max) break
        if (typeof img.url === 'string' && img.url) out.push({ type: 'image', url: img.url, alt: img.alt ?? '' })
      }
    } else if (b.type === 'youtube' && typeof b.videoId === 'string' && b.videoId) {
      out.push({ type: 'youtube', videoId: b.videoId })
    }
  }
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 서식 본문이 아직 없는 기존 빠른답변(순수 텍스트)을 편집기에 넣을 때: 줄바꿈 단위 문단으로 변환 */
export function textToBlocks(text: string | null | undefined): ContentBlock[] {
  const t = (text ?? '').replace(/\r\n/g, '\n').trim()
  if (!t) return []
  const html = t.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  return [{ type: 'text', html }]
}

/** 서식 본문에 글자·이미지·동영상 중 하나라도 있으면 true(빈 편집기 저장 방지용) */
export function hasBlocksContent(blocks: readonly ContentBlock[] | null | undefined): boolean {
  if (!Array.isArray(blocks)) return false
  if (blocksToPlainText(blocks)) return true
  return extractCannedMedia(blocks, 1).length > 0
}

/** 썸네일 주소(영상은 유튜브 대표 이미지) */
export function mediaThumbUrl(m: CannedMediaItem): string {
  return m.type === 'image' ? m.url : `https://img.youtube.com/vi/${m.videoId}/hqdefault.jpg`
}
