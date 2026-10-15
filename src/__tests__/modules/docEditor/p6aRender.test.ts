// @vitest-environment jsdom
/**
 * P6-a — 새로 노출한 서식(양쪽 정렬·구분선·인용·서체·글자색)이
 * 기존 계약서 렌더 경로(renderTiptapDocToHtml, 고객 서명 화면)에서도 신/구 동일하게 그려지는지 고정한다.
 * 렌더 확장 집합은 건드리지 않았다는 보증이기도 하다.
 */
import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { renderDocToHtml } from '$lib/modules/doc-editor'
import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: '양쪽 맞춤' }] },
    { type: 'horizontalRule' },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '인용' }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목2' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '서체색', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia, serif', color: '#CF0000' } }] },
      ],
    },
  ],
}

describe('P6-a 서식 렌더 동등성', () => {
  it('신/구 렌더 HTML이 같고 서식이 살아 있다', () => {
    const next = renderDocToHtml(doc)
    const old = renderTiptapDocToHtml(doc)
    expect(next).toBe(old)
    expect(next).toContain('text-align: justify')
    expect(next).toContain('<hr')
    expect(next).toContain('<blockquote')
    expect(next).toContain('font-family: Georgia')
    expect(next).toMatch(/color: (#CF0000|rgb\(207, 0, 0\))/i)
  })
})
