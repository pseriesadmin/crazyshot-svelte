// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { flowDocToExportHtml } from '$lib/utils/docExport/exportHtml'

// TipTap의 HTML 직렬화(generateHTML)는 브라우저 DOM(window)이 필요하다 — 파일 저장도 브라우저에서 실행된다
describe('flowDocToExportHtml — 문서형 양식 → 내보내기용 HTML', () => {
  const doc: JSONContent = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '임차인 ' }, { type: 'mergeField', attrs: { variable: '고객이름', label: '고객이름' } }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', attrs: { repeatRegion: true }, content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'mergeField', attrs: { variable: '상품명', label: '상품명' } }] }] }] },
        ],
      },
    ],
  }

  it('변수칩은 {{변수명}} 글자로 남고 값으로 치환되지 않는다', () => {
    const html = flowDocToExportHtml(doc)
    expect(html).toContain('{{고객이름}}')
    expect(html).toContain('{{상품명}}')
  })
  it('화면용 표 래퍼와 반복 영역 표식은 파일에 남기지 않는다', () => {
    const html = flowDocToExportHtml(doc)
    expect(html).not.toContain('tt-table-scroll')
    expect(html).not.toContain('data-repeat-region')
    expect(html).toContain('<table')
  })
})

