// @vitest-environment jsdom
/**
 * 변수 칩 → 값 치환 시 글꼴·크기·굵기 유지 (2026-10-14).
 * 모듈 substituteDoc 과 고객 서명 화면이 쓰는 기존 substituteTiptapDoc(tiptapRender.ts)을 같은 케이스로 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { DOC_EDITOR_EXTENSIONS, substituteDoc, renderDocToHtml } from '$lib/modules/doc-editor'
import { marksForChip } from '$lib/modules/doc-editor/core/chipMarks'
import { substituteTiptapDoc, renderTiptapDocToHtml } from '$lib/utils/tiptapRender'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

const STYLE = { type: 'textStyle', attrs: { fontFamily: "'휴먼명조', serif", fontSize: '13pt' } }
const chip = (variable: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'mergeField', attrs: { variable, label: variable }, ...(marks ? { marks } : {}) })
const para = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] })

const runs = [
  ['모듈 substituteDoc', (d: JSONContent) => substituteDoc(d, { values: { 고객이름: '홍길동', 연락처: '010' } }), renderDocToHtml],
  ['기존 substituteTiptapDoc', (d: JSONContent) => substituteTiptapDoc(d, { 고객이름: '홍길동', 연락처: '010' } as unknown as ContractSubstitutionData), renderTiptapDocToHtml],
] as const

describe.each(runs)('%s', (_name, sub, render) => {
  it('칩 자신의 서식(글꼴·크기·굵기)이 값에 그대로 붙는다', () => {
    const out = sub(para({ type: 'text', text: '고객: ' }, chip('고객이름', [STYLE, { type: 'bold' }])))
    const html = render(out)
    expect(html).toContain('font-size: 13pt')
    expect(html).toContain('홍길동')
    expect(html).toMatch(/<strong><span[^>]*font-size: 13pt[^>]*>홍길동<\/span><\/strong>|<span[^>]*font-size: 13pt[^>]*><strong>홍길동<\/strong><\/span>|<strong>.*홍길동/)
  })

  it('서식 없는 칩(옛 양식·한글 가져오기)은 앞 글자의 서식을 이어받는다', () => {
    const html = render(sub(para({ type: 'text', text: '고객: ', marks: [STYLE] }, chip('고객이름'))))
    // 같은 서식의 글자는 한 덩어리로 합쳐지므로 값이 라벨과 같은 <span> 안에 들어간다
    expect(html.match(/<span /g)?.length).toBe(1)
    expect(html).toMatch(/13pt[^>]*>[^<]*홍길동/)
  })

  it('문단 맨 앞 칩은 뒤 글자의 서식을 이어받는다', () => {
    const html = render(sub(para(chip('고객이름'), { type: 'text', text: ' 님', marks: [STYLE] })))
    expect(html).toMatch(/13pt[^>]*>[^<]*홍길동/)
  })

  it('링크 서식은 값으로 번지지 않는다', () => {
    const html = render(sub(para({ type: 'text', text: '홈페이지', marks: [{ type: 'link', attrs: { href: 'https://a.test' } }] }, chip('고객이름'))))
    expect(html).not.toMatch(/<a [^>]*>[^<]*홍길동/)
  })

  it('서식이 전혀 없는 문서는 기존과 같은 HTML(서식 추가 없음)', () => {
    expect(render(sub(para({ type: 'text', text: '고객: ' }, chip('고객이름'))))).toBe('<p>고객: 홍길동</p>')
  })

  it('표 셀 안의 칩도 같은 규칙', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '이름 ', marks: [STYLE] }, chip('고객이름')] }] }] }] }],
    }
    expect(render(sub(doc))).toMatch(/13pt[^>]*>[^<]*홍길동/)
  })
})

describe('marksForChip', () => {
  it('앞 글자가 서식 없는 글자면 서식 없음(주변 글자가 기준)', () => {
    expect(marksForChip([{ type: 'text', text: 'a' }, chip('x')], 1)).toBeUndefined()
  })
  it('칩 사이를 건너뛰고 가장 가까운 글자를 본다', () => {
    const m = marksForChip([{ type: 'text', text: 'a', marks: [STYLE] }, chip('x'), chip('y')], 2)
    expect(m?.[0]?.type).toBe('textStyle')
  })
})

describe('칩 삽입 시 서식 이어받기(편집기)', () => {
  it('커서 앞 글자가 13pt 휴먼명조면 칩에도 그 서식이 붙고, 치환하면 값이 같은 서식으로 나온다', () => {
    const e = new Editor({
      extensions: DOC_EDITOR_EXTENSIONS,
      content: `<p><span style="font-family:'휴먼명조', serif"><span style="font-size:13pt">고객: </span></span></p>`,
    })
    e.commands.focus('end')
    e.chain().insertMergeField({ variable: '고객이름', label: '고객이름' }).run()
    const json = e.getJSON()
    const node = json.content?.[0]?.content?.find((n) => n.type === 'mergeField')
    expect(JSON.stringify(node?.marks)).toContain('13pt')
    const html = renderDocToHtml(substituteDoc(json, { values: { 고객이름: '홍길동' } }))
    expect(html).toMatch(/13pt[^>]*>[^<]*홍길동/)
    e.destroy()
  })
})
