// @vitest-environment jsdom
/**
 * P6-b — 글자 크기·글자 배경색·들여쓰기를 렌더 확장 집합에 가산 등록한 뒤의 골든 비교.
 *  ① 새 서식이 없는 기존 문서는 HTML이 한 글자도 달라지지 않는다(고정 문자열 대조 — 신/구 같은 집합이라 서로 비교만으로는 못 잡는 회귀를 막는다).
 *  ② 새 서식은 기존 계약서 렌더 경로(renderTiptapDocToHtml, 고객 서명 화면)와 모듈 렌더가 동일하게 그린다.
 *  ③ 신/구 편집 스키마가 동일하다.
 */
import { describe, it, expect } from 'vitest'
import { getSchema, type JSONContent } from '@tiptap/core'
import { DOC_EDITOR_EXTENSIONS, renderDocToHtml } from '$lib/modules/doc-editor'
import { TIPTAP_CONTRACT_EXTENSIONS } from '$lib/components/cms/contract-editor/tiptapExtensions'
import { renderTiptapDocToHtml } from '$lib/utils/tiptapRender'

const plainDoc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '제목' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '일반 ' }, { type: 'text', text: '굵게', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '가운데' }] },
  ],
}

const richDoc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { indent: 2 }, content: [{ type: 'text', text: '들여쓰기' }] },
    { type: 'heading', attrs: { level: 2, indent: 1 }, content: [{ type: 'text', text: '제목' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '큰글씨', marks: [{ type: 'textStyle', attrs: { fontSize: '24px' } }] },
        { type: 'text', text: '배경', marks: [{ type: 'textStyle', attrs: { backgroundColor: '#FFF3B0' } }] },
      ],
    },
  ],
}

describe('P6-b 렌더 확장 가산 등록', () => {
  it('① 새 서식이 없는 문서의 HTML은 변하지 않는다(고정 문자열)', () => {
    const expected =
      '<h1>제목</h1><p>일반 <strong>굵게</strong></p><p style="text-align: center;">가운데</p>'
    expect(renderTiptapDocToHtml(plainDoc)).toBe(expected)
    expect(renderDocToHtml(plainDoc)).toBe(expected)
  })

  it('② 글자 크기·배경색·들여쓰기가 고객 서명 화면 렌더와 모듈 렌더에서 동일하게 그려진다', () => {
    const a = renderTiptapDocToHtml(richDoc)
    expect(a).toBe(renderDocToHtml(richDoc))
    expect(a).toContain('padding-left: 4em')
    expect(a).toContain('padding-left: 2em')
    expect(a).toContain('font-size: 24px')
    expect(a).toMatch(/background-color: (#FFF3B0|rgb\(255, 243, 176\))/i)
  })

  it('③ 신/구 편집 스키마(노드·마크·속성)가 동일하다', () => {
    const s1 = getSchema(DOC_EDITOR_EXTENSIONS)
    const s2 = getSchema(TIPTAP_CONTRACT_EXTENSIONS)
    expect(Object.keys(s1.nodes).sort()).toEqual(Object.keys(s2.nodes).sort())
    expect(Object.keys(s1.marks).sort()).toEqual(Object.keys(s2.marks).sort())
    expect(Object.keys(s1.nodes['paragraph']!.spec.attrs ?? {}).sort()).toEqual(['indent', 'textAlign'])
  })
})
