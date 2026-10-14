// cannedContentBlocks.test.ts — 빠른답변 서식 본문 저장 검증(정화 + 텍스트 파생값을 서버가 직접 만든다)
import { describe, it, expect } from 'vitest'
import { resolveCannedBlocks } from '$lib/server/cannedContentBlocks'

describe('resolveCannedBlocks', () => {
  it('undefined면 변경 없음', () => {
    expect(resolveCannedBlocks(undefined)).toEqual({ ok: true, unchanged: true })
  })
  it('null·빈 배열이면 서식 해제', () => {
    expect(resolveCannedBlocks(null)).toEqual({ ok: true, blocks: null, content: null })
    expect(resolveCannedBlocks([])).toEqual({ ok: true, blocks: null, content: null })
  })
  it('배열이 아니면 거절', () => {
    expect(resolveCannedBlocks('x').ok).toBe(false)
    expect(resolveCannedBlocks({}).ok).toBe(false)
  })
  it('글자 본문에서 서버가 content를 만들고 위험 요소는 제거한다', () => {
    const r = resolveCannedBlocks([{ type: 'text', html: '<p onclick="x()">안녕<script>alert(1)</script></p>' }])
    expect(r.ok).toBe(true)
    if (r.ok && 'blocks' in r) {
      expect(JSON.stringify(r.blocks)).not.toContain('script')
      expect(JSON.stringify(r.blocks)).not.toContain('onclick')
      expect(r.content).toContain('안녕')
      expect(r.content).not.toContain('<')
    }
  })
  it('이미지·동영상만 있고 글자가 없으면 거절(채팅 답변 글자 필요)', () => {
    const r = resolveCannedBlocks([{ type: 'image', layout: 'individual', images: [{ url: 'https://x/a.png', alt: '' }] }])
    expect(r.ok).toBe(false)
  })
  it('javascript: 이미지 주소·잘못된 영상 ID는 걸러진다', () => {
    const r = resolveCannedBlocks([
      { type: 'text', html: '<p>본문</p>' },
      { type: 'image', layout: 'individual', images: [{ url: 'javascript:alert(1)', alt: '' }] },
      { type: 'youtube', videoId: '../../evil', url: '' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok && 'blocks' in r && r.blocks) {
      const media = JSON.stringify(r.blocks)
      expect(media).not.toContain('javascript:')
      expect(media).not.toContain('evil')
    }
  })
})

describe('채팅 글자 상한(chat_messages.content 1000자)', () => {
  it('서식 본문의 글자가 1000자를 넘으면 거절한다', () => {
    const r = resolveCannedBlocks([{ type: 'text', html: `<p>${'가'.repeat(1001)}</p>` }])
    expect(r.ok).toBe(false)
  })
  it('1000자까지는 허용한다', () => {
    const r = resolveCannedBlocks([{ type: 'text', html: `<p>${'가'.repeat(1000)}</p>` }])
    expect(r.ok).toBe(true)
  })
})
