// cannedBlocks.test.ts — 빠른답변 서식 본문 변환(채팅은 텍스트만, 이미지·영상은 썸네일 목록으로 분리)
import { describe, it, expect } from 'vitest'
import type { ContentBlock } from '$lib/types/content-editor'
import {
  blocksToPlainText, extractCannedMedia, textToBlocks, hasBlocksContent, htmlToPlainText, mediaThumbUrl, CANNED_MEDIA_MAX,
} from '$lib/utils/cannedBlocks'

describe('htmlToPlainText', () => {
  it('문단·줄바꿈·목록을 줄바꿈으로 바꾸고 태그와 엔티티를 정리한다', () => {
    expect(htmlToPlainText('<p>안녕 <strong>하세요</strong></p><p>A &amp; B</p>')).toBe('안녕 하세요\nA & B')
    expect(htmlToPlainText('첫줄<br>둘째줄')).toBe('첫줄\n둘째줄')
    expect(htmlToPlainText('<ul><li>하나</li><li>둘</li></ul>')).toBe('• 하나\n• 둘')
  })
  it('빈 값은 빈 문자열', () => {
    expect(htmlToPlainText('')).toBe('')
  })
  it('스크립트 태그 문자열은 글자로만 남지 않고 태그가 제거된다', () => {
    expect(htmlToPlainText('<p>x</p><script>alert(1)</script>')).not.toContain('<')
  })
})

describe('blocksToPlainText', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', html: '<p>환불 안내입니다.</p>' },
    { type: 'image', layout: 'individual', images: [{ url: 'https://x/a.png', alt: '' }] },
    { type: 'youtube', videoId: 'abcdefghijk', url: '' },
    { type: 'divider' },
    { type: 'text', html: '<p>문의는 채팅으로 주세요.</p>' },
    { type: 'link-entry', url: 'https://x', text: '자세히 보기' },
  ]
  it('글자만 이어 붙이고 이미지·영상·구분선은 제외한다', () => {
    expect(blocksToPlainText(blocks)).toBe('환불 안내입니다.\n\n문의는 채팅으로 주세요.\n\n자세히 보기')
  })
  it('배열이 아니면 빈 문자열', () => {
    expect(blocksToPlainText(null)).toBe('')
    expect(blocksToPlainText(undefined)).toBe('')
  })
})

describe('extractCannedMedia', () => {
  it('이미지 묶음과 영상을 순서대로 뽑는다', () => {
    const m = extractCannedMedia([
      { type: 'text', html: '<p>a</p>' },
      { type: 'image', layout: 'collage', images: [{ url: 'https://x/1.png', alt: '하나' }, { url: 'https://x/2.png', alt: '' }] },
      { type: 'youtube', videoId: 'abcdefghijk', url: '' },
    ])
    expect(m).toEqual([
      { type: 'image', url: 'https://x/1.png', alt: '하나' },
      { type: 'image', url: 'https://x/2.png', alt: '' },
      { type: 'youtube', videoId: 'abcdefghijk' },
    ])
  })
  it(`최대 ${CANNED_MEDIA_MAX}개까지만`, () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ url: `https://x/${i}.png`, alt: '' }))
    expect(extractCannedMedia([{ type: 'image', layout: 'slide', images }])).toHaveLength(CANNED_MEDIA_MAX)
  })
  it('썸네일 주소: 이미지는 원본, 영상은 유튜브 대표 이미지', () => {
    expect(mediaThumbUrl({ type: 'image', url: 'https://x/1.png', alt: '' })).toBe('https://x/1.png')
    expect(mediaThumbUrl({ type: 'youtube', videoId: 'abcdefghijk' })).toBe('https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg')
  })
})

describe('textToBlocks / hasBlocksContent', () => {
  it('기존 순수 텍스트를 줄 단위 문단으로 바꾸고 HTML 특수문자를 이스케이프한다', () => {
    const b = textToBlocks('첫줄 <b>\n둘째줄')
    expect(b).toEqual([{ type: 'text', html: '<p>첫줄 &lt;b&gt;</p><p>둘째줄</p>' }])
    expect(blocksToPlainText(b)).toBe('첫줄 <b>\n둘째줄')
  })
  it('빈 텍스트는 빈 배열', () => {
    expect(textToBlocks('  ')).toEqual([])
    expect(textToBlocks(null)).toEqual([])
  })
  it('글자도 미디어도 없으면 내용 없음', () => {
    expect(hasBlocksContent([{ type: 'text', html: '<p></p>' }])).toBe(false)
    expect(hasBlocksContent([{ type: 'image', layout: 'individual', images: [{ url: 'https://x/1.png', alt: '' }] }])).toBe(true)
    expect(hasBlocksContent([{ type: 'text', html: '<p>안녕</p>' }])).toBe(true)
  })
})
