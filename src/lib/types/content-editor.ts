// content-editor.ts — CmsContentEditor 블록 타입 정의
// CMS 상품 설명 + crazylog 재활용 공통

export type ImageLayout = 'individual' | 'collage' | 'slide'

export interface TextBlock {
  type: 'text'
  html: string
}

export interface ImageItem {
  url: string
  alt: string
  isHead?: boolean
}

export type ImageAlign = 'left' | 'center' | 'right'

export interface ImageBlock {
  type: 'image'
  layout: ImageLayout
  images: ImageItem[]
  /** 묶음 폭(%, 20~100). 생략=100(전체 폭). 새 에디터(RichContentEditor)가 기록 */
  width?: number
  /** 묶음 정렬. 생략=center. 폭이 100% 미만일 때만 눈에 띈다 */
  align?: ImageAlign
}

export const IMAGE_WIDTH_MIN = 20
export const IMAGE_WIDTH_MAX = 100

/** 화면 스타일(width:%)로 쓰이므로 DB 값이 무엇이든 20~100 정수로 한정한다(비정상 값은 100). */
export function normalizeImageWidth(v: unknown): number {
  // 빈 문자열은 Number('')=0 이라 20%로 올라가므로 값 없음으로 취급한다
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return IMAGE_WIDTH_MAX
  return Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, Math.round(n)))
}

export function normalizeImageAlign(v: unknown): ImageAlign {
  return v === 'left' || v === 'right' ? v : 'center'
}

/** 폭·정렬이 기본값(100%·가운데)이면 빈 문자열, 아니면 flex 컬럼 안에서 쓰는 인라인 스타일 */
export function imageBlockStyle(width: unknown, align: unknown): string {
  const w = normalizeImageWidth(width)
  const a = normalizeImageAlign(align)
  if (w >= IMAGE_WIDTH_MAX && a === 'center') return ''
  const self = a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center'
  return `width: ${w}%; align-self: ${self}`
}

export interface YoutubeBlock {
  type: 'youtube'
  videoId: string
  url: string
}

export interface HtmlBlock {
  type: 'html'
  content: string
}

export interface DividerBlock {
  type: 'divider'
}

export interface LinkEntryBlock {
  type: 'link-entry'
  url: string
  text: string
}

export type ContentBlock = TextBlock | ImageBlock | YoutubeBlock | HtmlBlock | DividerBlock | LinkEntryBlock

export function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#\s]{11})/,
    /youtube\.com\/shorts\/([^&?#\s]{11})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

export function makeEmptyTextBlock(): TextBlock {
  return { type: 'text', html: '' }
}

export function makeEmptyImageBlock(): ImageBlock {
  return { type: 'image', layout: 'individual', images: [] }
}

export function makeEmptyYoutubeBlock(): YoutubeBlock {
  return { type: 'youtube', videoId: '', url: '' }
}

export function makeEmptyHtmlBlock(): HtmlBlock {
  return { type: 'html', content: '' }
}

export function makeEmptyDividerBlock(): DividerBlock {
  return { type: 'divider' }
}

export function makeEmptyLinkEntryBlock(): LinkEntryBlock {
  return { type: 'link-entry', url: '', text: '' }
}
