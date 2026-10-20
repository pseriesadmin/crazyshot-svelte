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
  it('글 속 링크(<a href>)는 "문구 주소"로 주소를 보존한다', () => {
    expect(htmlToPlainText('<p>자세히는 <a href="https://crazyshot.kr/a">여기</a>를 보세요</p>')).toBe('자세히는 여기 https://crazyshot.kr/a를 보세요')
    expect(htmlToPlainText('<p><a href="https://crazyshot.kr/a">https://crazyshot.kr/a</a></p>')).toBe('https://crazyshot.kr/a')
    expect(htmlToPlainText('<a href="https://x.kr/?a=1&amp;b=2">링크</a>')).toBe('링크 https://x.kr/?a=1&b=2')
  })
  it('따옴표 없는 href도 주소를 보존하고, 문구의 특수문자 표기는 풀어서 비교한다', () => {
    expect(htmlToPlainText('<a href=https://x.kr/a>보기</a>')).toBe('보기 https://x.kr/a')
    expect(htmlToPlainText('<a href="https://x.kr/?a=1&amp;b=2">https://x.kr/?a=1&amp;b=2</a>')).toBe('https://x.kr/?a=1&b=2')
  })
  it('닫는 태그 없는 악성 입력도 즉시 처리된다(ReDoS 방지)', () => {
    const t0 = Date.now()
    htmlToPlainText('<a href=x '.repeat(3000))
    htmlToPlainText('<a href="x">'.repeat(3000))
    expect(Date.now() - t0).toBeLessThan(500)
  })
  it('한 글에 링크가 여러 개여도 각각 변환한다', () => {
    expect(htmlToPlainText('<p><a href="https://a.kr">가</a> 그리고 <a href="https://b.kr">나</a></p>')).toBe('가 https://a.kr 그리고 나 https://b.kr')
  })
  it('http(s)가 아닌 링크(javascript:·mailto:·내부 경로)는 문구만 남긴다', () => {
    expect(htmlToPlainText('<a href="javascript:alert(1)">클릭</a>')).toBe('클릭')
    expect(htmlToPlainText('<a href="mailto:a@b.kr">메일</a>')).toBe('메일')
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
    // 링크 블록은 "문구 주소"로 주소까지 남긴다(2026-10-20 — 고객 화면에서 눌러 열 수 있게)
    expect(blocksToPlainText(blocks)).toBe('환불 안내입니다.\n\n문의는 채팅으로 주세요.\n\n자세히 보기 https://x')
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
