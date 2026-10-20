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

// 여는 <a …> 태그만 선형으로 찾고(속 글자에 '<'가 없어야 함) 닫는 </a>는 indexOf로 찾는다 — 닫는 태그가 없는 악성 입력에도 시간이 늘어나지 않게(ReDoS 방지)
const ANCHOR_OPEN = /<a\s[^<>]*>/gi
const HREF_ATTR = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

function replaceAnchors(html: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let last = 0
  for (const m of html.matchAll(ANCHOR_OPEN)) {
    const start = m.index ?? 0
    if (start < last) continue
    const openEnd = start + m[0].length
    const close = lower.indexOf('</a>', openEnd)
    if (close < 0) break
    const h = HREF_ATTR.exec(m[0])
    if (!h) continue
    out += html.slice(last, start) + linkToPlainText(html.slice(openEnd, close), h[1] ?? h[2] ?? h[3] ?? '')
    last = close + 4
  }
  return out + html.slice(last)
}

/** 링크 문구와 주소를 채팅 글에 함께 남긴다 — "문구 주소"(문구가 주소와 같으면 주소만). http(s)가 아닌 주소는 문구만 남긴다. */
export function linkToPlainText(label: string, url: string): string {
  const u = decodeEntities(url).trim()
  const l = decodeEntities(label.replace(ANY_TAG, '')).trim()
  if (!/^https?:\/\//i.test(u)) return l
  if (!l || l === u || l === u.replace(/^https?:\/\//i, '')) return u
  return `${l} ${u}`
}

/** HTML 조각 → 줄바꿈이 보존된 순수 텍스트 (링크는 "문구 주소"로 주소를 보존) */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  const text = replaceAnchors(html)
    .replace(BR_TAG, '\n')
    .replace(LI_OPEN, '• ')
    .replace(BLOCK_END_TAGS, '\n')
    .replace(ANY_TAG, '')
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 서식 본문 → 채팅·검색용 순수 텍스트. 이미지·동영상·구분선은 제외, 링크는 "문구 주소"로 주소까지 남긴다(고객 화면에서 눌러 열 수 있게). */
export function blocksToPlainText(blocks: readonly ContentBlock[] | null | undefined): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') parts.push(htmlToPlainText(b.html))
    else if (b.type === 'html') parts.push(htmlToPlainText(b.content))
    else if (b.type === 'link-entry') parts.push(linkToPlainText(b.text ?? '', b.url ?? ''))
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
