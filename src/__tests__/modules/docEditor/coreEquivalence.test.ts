// @vitest-environment jsdom
// generateHTML(@tiptap/core)은 DOMSerializer(window)가 필요해 jsdom 환경에서 실행한다(기존 contractTiptapRender.test.ts와 동일).
/**
 * coreEquivalence.test.ts — doc-editor core ↔ 기존 계약서 구현 동등성 (P1 골든 테스트)
 *
 * 신규 모듈(core)이 기존 구현(tiptapExtensions·tiptapRender·tableColwidthFill)과
 * 같은 HTML·같은 치환 결과·같은 스키마를 내는지 비교한다. 기존 파일은 수정하지 않았고 이 테스트가 보호 장치다.
 */
import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { getSchema } from '@tiptap/core'

import { DOC_EDITOR_EXTENSIONS, renderDocToHtml, substituteDoc, findUnresolvedInDoc, fillMissingTableColwidths, MergeFieldNode } from '$lib/modules/doc-editor'
import { TIPTAP_CONTRACT_EXTENSIONS } from '$lib/components/cms/contract-editor/tiptapExtensions'
import { renderTiptapDocToHtml, substituteTiptapDoc } from '$lib/utils/tiptapRender'
import { fillMissingTableColwidths as oldFill } from '$lib/utils/docImport/tableColwidthFill'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

const cellAttrs = { align: null, colspan: 1, rowspan: 1, colwidth: [100], textAlign: null, borderColor: null, backgroundColor: null }
const p = (text?: string): JSONContent => ({ type: 'paragraph', attrs: { textAlign: null }, content: text ? [{ type: 'text', text }] : undefined })
const chip = (variable: string, label = variable): JSONContent => ({ type: 'mergeField', attrs: { variable, label } })

// Stage 실양식 "QA 검증용 임시양식"(표 3x3, 헤더행 포함)의 구조 그대로
const qaTable: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [0, 1, 2].map(() => ({ type: 'tableHeader', attrs: { ...cellAttrs }, content: [p()] })) },
        { type: 'tableRow', content: [0, 1, 2].map(() => ({ type: 'tableCell', attrs: { ...cellAttrs }, content: [p()] })) },
        { type: 'tableRow', content: [0, 1, 2].map(() => ({ type: 'tableCell', attrs: { ...cellAttrs }, content: [p()] })) },
      ],
    },
    p(),
  ],
}

// 서식·변수·이미지(너비·정렬·겹치기)·링크·색·글꼴·정렬·셀 배경/테두리·반복행을 모두 쓰는 문서
const rich: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: '대여 계약서' }] },
    {
      type: 'paragraph',
      attrs: { textAlign: 'right' },
      content: [
        { type: 'text', text: '고객: ' },
        chip('고객이름'),
        { type: 'hardBreak' },
        { type: 'text', marks: [{ type: 'bold' }], text: '굵게' },
        { type: 'text', marks: [{ type: 'italic' }, { type: 'underline' }, { type: 'strike' }], text: '기울임밑줄취소' },
        { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontFamily: 'Noto Sans KR' } }], text: '색·글꼴' },
        { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }], text: '링크' },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('항목1')] }, { type: 'listItem', content: [p('항목2')] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('번호1')] }] },
    { type: 'image', attrs: { src: 'https://example.com/a.png', width: 200, align: 'left' } },
    { type: 'image', attrs: { src: 'https://example.com/seal.png', width: 120, overlay: true, x: 30, y: 40 } },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { ...cellAttrs, backgroundColor: '#eeeeee', borderColor: '#333333' }, content: [p('NO.')] },
            { type: 'tableHeader', attrs: { ...cellAttrs, colwidth: [200] }, content: [p('상품명')] },
            { type: 'tableHeader', attrs: { ...cellAttrs, colwidth: [80] }, content: [p('수량')] },
          ],
        },
        {
          type: 'tableRow',
          attrs: { repeatRegion: true },
          content: [
            { type: 'tableCell', attrs: { ...cellAttrs, textAlign: 'center' }, content: [{ type: 'paragraph', content: [chip('NO.')] }] },
            { type: 'tableCell', attrs: { ...cellAttrs, colwidth: [200] }, content: [{ type: 'paragraph', content: [chip('상품명'), { type: 'text', text: ' / ' }, chip('고객이름')] }] },
            { type: 'tableCell', attrs: { ...cellAttrs, colwidth: [80] }, content: [{ type: 'paragraph', content: [chip('수량')] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', attrs: { ...cellAttrs, colspan: 2, colwidth: [100, 200] }, content: [{ type: 'paragraph', content: [chip('최종합계')] }] },
            { type: 'tableCell', attrs: { ...cellAttrs, colwidth: [80] }, content: [p('합계')] },
          ],
        },
      ],
    },
    { type: 'paragraph', content: [chip('없는변수'), chip('상품목록')] },
  ],
}

// 열 너비가 일부 비어 있는 표(colwidth 보정 대상)
const partialColwidth: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { ...cellAttrs, colwidth: [150] }, content: [p('a')] }, { type: 'tableCell', attrs: { ...cellAttrs, colwidth: null }, content: [p('b')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { ...cellAttrs, colwidth: null }, content: [p('c')] }, { type: 'tableCell', attrs: { ...cellAttrs, colwidth: null }, content: [p('d')] }] },
      ],
    },
  ],
}

// 블록 노드(인용·코드·구분선)·병합 셀(rowspan)·헤더열·취소선을 쓰는 문서
const blocksAndMerge: JSONContent = {
  type: 'doc',
  content: [
    { type: 'blockquote', content: [p('인용문')] },
    { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'const a = 1' }] },
    { type: 'horizontalRule' },
    { type: 'heading', attrs: { level: 3, textAlign: 'left' }, content: [{ type: 'text', text: '소제목' }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { ...cellAttrs, rowspan: 2 }, content: [p('헤더열')] },
            { type: 'tableCell', attrs: { ...cellAttrs, colspan: 2, colwidth: [100, 100] }, content: [p('가로 병합')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', attrs: { ...cellAttrs }, content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'strike' }], text: '취소' }] }] },
            { type: 'tableCell', attrs: { ...cellAttrs }, content: [p('끝')] },
          ],
        },
      ],
    },
  ],
}

const FIXTURES: Record<string, JSONContent> = { qaTable, rich, partialColwidth, blocksAndMerge }

const data: ContractSubstitutionData = {
  고객이름: '홍길동', 연락처: '010-1111-2222', 이메일: 'a@b.c', 주소: '서울', 예약코드: 'CS1', 상품코드: '', 상품명: '카메라',
  수량: '2', 수령형태: '방문', 수령일시: '10:00', 반납형태: '방문', 반납일시: '18:00', 기본대여요금: '1,000원', 할인금액: '-',
  배송비: '-', 부가세: '(0원)', 최종합계: '1,000원', 요금유형: '24시간',
  상품목록: [
    { 상품명: '카메라 A', 수량: '1', 금액: 'Day 60,000', 비고: '-', 상품코드: '' },
    { 상품명: '┖[옵션] 배터리', 수량: '2', 금액: '3,000원', 비고: '-', 상품코드: '' },
    { 상품명: '삼각대', 수량: '1', 금액: '-', 비고: '-', 상품코드: '' },
  ],
} as unknown as ContractSubstitutionData

describe('doc-editor core — 기존 계약서 구현과의 동등성', () => {
  it('확장 스키마: 노드·마크 이름 집합이 기존과 동일하다', () => {
    const names = (exts: Parameters<typeof getSchema>[0]) => ({
      nodes: Object.keys(getSchema(exts).nodes).sort(),
      marks: Object.keys(getSchema(exts).marks).sort(),
    })
    expect(names(DOC_EDITOR_EXTENSIONS)).toEqual(names(TIPTAP_CONTRACT_EXTENSIONS))
  })

  it('확장 스키마: 속성 기본값이 노드별로 동일하다(JSON 재저장 드리프트 방지)', () => {
    const defaults = (exts: Parameters<typeof getSchema>[0]) => {
      const s = getSchema(exts)
      const out: Record<string, Record<string, unknown>> = {}
      for (const [k, n] of Object.entries(s.nodes)) out[`node:${k}`] = Object.fromEntries(Object.entries(n.spec.attrs ?? {}).map(([a, v]) => [a, (v as { default?: unknown }).default]))
      for (const [k, m] of Object.entries(s.marks)) out[`mark:${k}`] = Object.fromEntries(Object.entries(m.spec.attrs ?? {}).map(([a, v]) => [a, (v as { default?: unknown }).default]))
      return out
    }
    expect(defaults(DOC_EDITOR_EXTENSIONS)).toEqual(defaults(TIPTAP_CONTRACT_EXTENSIONS))
  })

  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`렌더 HTML 동일: ${name}`, () => {
      expect(renderDocToHtml(doc)).toBe(renderTiptapDocToHtml(doc))
    })

    it(`치환 결과 JSON 동일(반복행 전개 포함): ${name}`, () => {
      const oldOut = substituteTiptapDoc(doc, data)
      const newOut = substituteDoc(doc, { values: data, repeatItems: data.상품목록 })
      expect(newOut).toEqual(oldOut)
      expect(renderDocToHtml(newOut)).toBe(renderTiptapDocToHtml(oldOut))
    })

    it(`반복 항목 미정의 시 스칼라 치환만(무회귀): ${name}`, () => {
      const noItems = { ...data, 상품목록: undefined } as unknown as ContractSubstitutionData
      expect(substituteDoc(doc, { values: noItems })).toEqual(substituteTiptapDoc(doc, noItems))
    })

    it(`반복 항목 0건이면 반복 행 제거(무회귀): ${name}`, () => {
      const empty = { ...data, 상품목록: [] } as unknown as ContractSubstitutionData
      expect(substituteDoc(doc, { values: empty, repeatItems: [] })).toEqual(substituteTiptapDoc(doc, empty))
    })

    it(`표 colwidth 보정 동일: ${name}`, () => {
      expect(fillMissingTableColwidths(doc)).toEqual(oldFill(doc))
    })

    it(`치환 입력 문서를 변형하지 않는다: ${name}`, () => {
      const before = JSON.stringify(doc)
      substituteDoc(doc, { values: data, repeatItems: data.상품목록 })
      expect(JSON.stringify(doc)).toBe(before)
    })
  }

  it('반복행 전개: 항목 수만큼 행이 늘고 data-repeat-region 표식이 남지 않는다', () => {
    const html = renderDocToHtml(substituteDoc(rich, { values: data, repeatItems: data.상품목록 }))
    expect(html).not.toContain('data-repeat-region')
    expect(html).toContain('카메라 A')
    expect(html).toContain('┖[옵션] 배터리')
    expect(html).toContain('삼각대')
  })

  it('변수 칩 직렬화(renderText)는 {{변수}} 원문이다', () => {
    const render = (MergeFieldNode.config as unknown as { renderText: (a: { node: { attrs: Record<string, unknown> } }) => string }).renderText
    expect(render({ node: { attrs: { variable: '고객이름' } } })).toBe('{{고객이름}}')
  })

  it('findUnresolvedInDoc: 치환 후 남은 변수만 보고한다', () => {
    const out = substituteDoc(rich, { values: data, repeatItems: data.상품목록 })
    // 'NO.'는 기존 문서형 치환 엔진도 해석하지 않는 변수(항목 필드에 없음) — 동작 동등성을 위해 그대로 보고된다
    expect(findUnresolvedInDoc(out).sort()).toEqual(['NO.', '상품목록', '없는변수'])
  })

  it('표는 tt-table-scroll 래퍼로 감싸진다', () => {
    expect(renderDocToHtml(qaTable)).toContain('<div class="tt-table-scroll"><table')
  })
})
