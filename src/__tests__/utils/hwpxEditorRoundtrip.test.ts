// @vitest-environment jsdom
/** 한글 변환 HTML이 통합 편집기 스키마로 들어갈 때 정렬·글꼴·글자 크기·열 폭·셀 색이 살아남는지 (setContent 왕복) */
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { DOC_EDITOR_EXTENSIONS } from '$lib/modules/doc-editor'

describe('한글 변환 HTML → 편집기 문서', () => {
  it('정렬·글꼴·글자 크기·열 폭·셀 배경/테두리색 보존', () => {
    const html =
      `<p style="text-align:center"><span style="font-family:'맑은 고딕', sans-serif"><span style="font-size:13pt">제목</span></span></p>` +
      `<table><tbody><tr><td colspan="2" colwidth="120,120" style="text-align:right;background-color:#FFFF00;border-color:#FF0000"><span style="font-family:'바탕', serif">셀</span></td></tr></tbody></table>`
    const editor = new Editor({ extensions: DOC_EDITOR_EXTENSIONS, content: html })
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"textAlign":"center"')
    expect(json).toContain('맑은 고딕')
    expect(json).toContain('13pt')
    expect(json).toContain('"colwidth":[120,120]')
    expect(json).toMatch(/"backgroundColor":"(#FFFF00|rgb\(255, 255, 0\))"/i)
    expect(json).toMatch(/"borderColor":"(#FF0000|rgb\(255, 0, 0\))"/i)
    expect(json).toContain('"textAlign":"right"')
    editor.destroy()
  })
})
