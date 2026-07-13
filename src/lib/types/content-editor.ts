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
}

export interface ImageBlock {
  type: 'image'
  layout: ImageLayout
  images: ImageItem[]
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

export type ContentBlock = TextBlock | ImageBlock | YoutubeBlock | HtmlBlock | DividerBlock

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
