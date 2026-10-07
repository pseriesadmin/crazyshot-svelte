// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ContentBlock } from '$lib/types/content-editor'
import {
  blocksToDoc,
  docToBlocks,
  classifyBlockFidelity,
  normalizeLegacyHtml,
  textFingerprint,
  verifySerialization,
  previewConversion,
  blocksTextEqual,
} from '$lib/utils/contentBlocksTiptap'
import { createRichExtensions } from '$lib/components/editor/extensions'

/**
 * 콘텐츠 에디터 전면 개편 1단계 — 저장 형식(ContentBlock[]) 호환 + 무손실 보장.
 * 핵심: "변환 가능"으로 판정된 블록은 글자가 동일해야 하고, 판정 못 한 블록은 원본 그대로 보존 노드에 담긴다.
 */

// 기존 에디터(contenteditable) 산출물 — 중첩 div/span, NBSP 연속, 빈 줄, <br>
const NIKON_LIKE =
  '<div style="text-align: center;"><span style="font-size: 17px;">니콘 Z5IIC 공개</span></div>' +
  '<div><br></div>' +
  '<div>첫째&nbsp;&nbsp;&nbsp;줄입니다.<br>둘째 줄입니다.</div>' +
  '<div style="text-align: right;"><b>굵은 오른쪽</b> 일반</div>'

// Gemini 출처 칩(Angular 커스텀 요소)
const GEMINI_CHIP =
  '<p><span>본문 앞</span><sources-carousel-inline><source-inline-chip ng-version="19">출처 A</source-inline-chip></sources-carousel-inline> 뒤</p>'

// imweb font 태그 / h4 / sup
const IMWEB_FONT = '<p><font color="#ff0000" face="Gulim">빨간 글씨</font></p>'
const H4_SUP = '<h4>소제목</h4><p>m<sup>2</sup></p>'
const TW_VARS = '<p style="--tw-ring-offset-width: 0px; margin: 0px;">텍스트</p>'

describe('normalizeLegacyHtml — 레거시 정규화', () => {
  it('div(정렬)를 p로 바꿔 text-align을 보존', () => {
    const out = normalizeLegacyHtml('<div style="text-align: center;">가운데</div>')
    expect(out).toContain('<p')
    expect(out).toContain('text-align: center')
    expect(out).not.toContain('<div')
  })
  it('span의 text-align을 상위 블록으로 승격', () => {
    const out = normalizeLegacyHtml('<div><span style="text-align:right;font-size:17px">우</span></div>')
    expect(out).toMatch(/<p style="text-align: right;">/)
    expect(out).toContain('font-size: 17px')
  })
  it('<p><br></p> 는 빈 문단으로', () => {
    expect(normalizeLegacyHtml('<div><br></div>')).toBe('<p></p>')
  })
})

describe('classifyBlockFidelity — 충실도 관문', () => {
  it('단순 구조(div·span·br·text-align·font-size)는 변환 가능', () => {
    expect(classifyBlockFidelity(NIKON_LIKE)).toEqual({ convertible: true })
  })
  it('Gemini 출처 칩(하이픈 커스텀 요소)은 변환 불가 → 보존', () => {
    const r = classifyBlockFidelity(GEMINI_CHIP)
    expect(r.convertible).toBe(false)
    expect(r.reason).toMatch(/^tag:/)
  })
  it('font 태그·h4·sup·CSS 변수 스타일은 변환 불가', () => {
    expect(classifyBlockFidelity(IMWEB_FONT).convertible).toBe(false)
    expect(classifyBlockFidelity(H4_SUP).convertible).toBe(false)
    expect(classifyBlockFidelity(TW_VARS).convertible).toBe(false)
  })
  it('빈 문자열은 변환 가능(문서에 올리지 않음)', () => {
    expect(classifyBlockFidelity('').convertible).toBe(true)
  })
})

describe('blocksToDoc / docToBlocks — 왕복', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', html: NIKON_LIKE },
    { type: 'image', layout: 'collage', images: [{ url: 'https://x/a.webp', alt: 'a', isHead: true }, { url: 'https://x/b.webp', alt: 'b' }] },
    { type: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' },
    { type: 'divider' },
    { type: 'text', html: GEMINI_CHIP },
    { type: 'html', content: '<div class="x">원본 html</div>' },
  ]

  it('미디어 블록은 같은 값으로 되돌아온다', () => {
    const out = docToBlocks(blocksToDoc(blocks))
    expect(out.filter((b) => b.type === 'image')).toEqual([blocks[1]])
    expect(out.filter((b) => b.type === 'youtube')).toEqual([blocks[2]])
    expect(out.filter((b) => b.type === 'divider')).toHaveLength(1)
  })

  it('변환 불가 text/html 블록은 원본 문자열 그대로 되돌아온다(바이트 동일)', () => {
    const out = docToBlocks(blocksToDoc(blocks))
    expect(out).toContainEqual({ type: 'text', html: GEMINI_CHIP })
    expect(out).toContainEqual({ type: 'html', content: '<div class="x">원본 html</div>' })
  })

  it('전체 글자가 보존된다', () => {
    const out = docToBlocks(blocksToDoc(blocks))
    expect(blocksTextEqual(blocks, out)).toBe(true)
  })

  it('정렬·글자크기 서식이 왕복 후에도 남는다', () => {
    const out = docToBlocks(blocksToDoc([{ type: 'text', html: NIKON_LIKE }]))
    const html = (out[0] as { html: string }).html
    expect(html).toContain('text-align: center')
    expect(html).toContain('font-size: 17px')
    expect(html).toContain('text-align: right')
    expect(html).toContain('<strong>굵은 오른쪽</strong>')
  })

  it('빈 줄은 <br>이 채워진 문단으로 유지된다(상세 화면에서 접히지 않음)', () => {
    const out = docToBlocks(blocksToDoc([{ type: 'text', html: NIKON_LIKE }]))
    expect((out[0] as { html: string }).html).toContain('<p><br></p>')
  })

  it('link-entry와 빈 text 블록은 문서에 올리지 않는다', () => {
    const doc = blocksToDoc([{ type: 'link-entry', url: '', text: '' }, { type: 'text', html: '' }])
    expect(doc.content).toEqual([{ type: 'paragraph' }])
    expect(docToBlocks(doc)).toEqual([{ type: 'text', html: '' }])
  })
})

describe('글자 보존 속성 — 판정이 곧 보장', () => {
  const FIXTURES = [NIKON_LIKE, GEMINI_CHIP, IMWEB_FONT, H4_SUP, TW_VARS,
    '<p>일반 문단</p>', '<p>a&nbsp;&nbsp;b</p><p><br></p><p>c</p>', '<ul><li>하나</li><li>둘</li></ul>',
    '<blockquote>인용</blockquote>', '<h2>제목</h2><p>본문 <a href="https://x.com" target="_blank" rel="noopener">링크</a></p>',
    '텍스트만<br>두 줄', '<table><tbody><tr><td>가</td><td>나</td></tr></tbody></table>']

  for (const html of FIXTURES) {
    it(`변환 가능이면 글자 동일, 아니면 보존 노드: ${html.slice(0, 40)}`, () => {
      const r = classifyBlockFidelity(html)
      const doc = blocksToDoc([{ type: 'text', html }])
      const out = docToBlocks(doc)
      if (r.convertible) {
        expect(blocksTextEqual([{ type: 'text', html }], out)).toBe(true)
      } else {
        expect(doc.content?.[0]?.type).toBe('legacyHtml')
        expect(out).toEqual([{ type: 'text', html }])
      }
    })
  }
})

describe('previewConversion / verifySerialization', () => {
  it('강제 변환 미리보기는 글자 일치 여부를 알려준다', () => {
    expect(previewConversion('<p>가나다</p>').textMatches).toBe(true)
    expect(previewConversion('<p>본문<style>.a{color:red}</style></p>').textMatches).toBe(false)
  })
  it('저장 직전 점검은 정상 문서에서 통과한다', () => {
    const doc = blocksToDoc([{ type: 'text', html: NIKON_LIKE }, { type: 'text', html: GEMINI_CHIP }])
    expect(verifySerialization(doc).ok).toBe(true)
  })
  it('textFingerprint는 NBSP·연속 공백을 정규화한다', () => {
    expect(textFingerprint('<p>a&nbsp;&nbsp; b</p>')).toBe('a b')
  })
})

describe('에디터 핵심 회귀 — 선택 후 서식 적용 시 선택이 유지된다', () => {
  function makeEditor(html: string) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return new Editor({ element: el, extensions: createRichExtensions(), content: html })
  }
  it('선택 → 굵게 → 크기 → 색 → 정렬을 연속 적용해도 선택 범위가 그대로다', () => {
    const editor = makeEditor('<p>안녕하세요 반갑습니다</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.chain().focus().toggleBold().run()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
    editor.chain().focus().setFontSize('24px').run()
    editor.chain().focus().setColor('#ff0000').run()
    editor.chain().focus().setTextAlign('center').run()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
    const html = editor.getHTML()
    expect(html).toContain('font-size: 24px')
    expect(html).toContain('<strong>')
    expect(html).toContain('text-align: center')
    editor.destroy()
  })
  it('본문/제목2/제목3 전환이 동작한다', () => {
    const editor = makeEditor('<p>제목 후보</p>')
    editor.commands.setTextSelection({ from: 1, to: 3 })
    editor.chain().focus().toggleHeading({ level: 2 }).run()
    expect(editor.getHTML()).toContain('<h2')
    editor.chain().focus().setParagraph().run()
    expect(editor.getHTML()).toContain('<p')
    editor.chain().focus().toggleHeading({ level: 3 }).run()
    expect(editor.getHTML()).toContain('<h3')
    editor.destroy()
  })
  it('들여쓰기·내어쓰기가 padding-left로 기록된다', () => {
    const editor = makeEditor('<p>들여쓰기</p>')
    editor.commands.indentBlock()
    expect(editor.getHTML()).toContain('padding-left: 2em')
    editor.commands.outdentBlock()
    expect(editor.getHTML()).not.toContain('padding-left')
    editor.destroy()
  })
})

describe('표 — 셀 선택·병합·분할·머리글', () => {
  async function tableEditor() {
    const { CellSelection } = await import('@tiptap/pm/tables')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = new Editor({ element: el, extensions: createRichExtensions(), content: '<p>x</p>' })
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    return { editor, CellSelection }
  }
  function cellPositions(editor: Editor): number[] {
    const out: number[] = []
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') out.push(pos)
    })
    return out
  }

  it('여러 셀을 셀 선택으로 잡아 병합하고, 분할하면 원래대로 돌아온다', async () => {
    const { editor, CellSelection } = await tableEditor()
    const cells = cellPositions(editor)
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[3], cells[4])))
    expect(editor.state.selection instanceof CellSelection).toBe(true)
    expect(editor.can().mergeCells()).toBe(true)
    editor.chain().mergeCells().run()
    expect(editor.getHTML()).toContain('colspan="2"')
    expect(editor.can().splitCell()).toBe(true)
    editor.chain().splitCell().run()
    expect(editor.getHTML()).not.toContain('colspan="2"')
    editor.destroy()
  })

  it('행·열 추가/삭제와 머리글 행 전환이 동작한다', async () => {
    const { editor } = await tableEditor()
    const count = (tag: string) => (editor.getHTML().match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length
    expect(count('tr')).toBe(3)
    editor.chain().addRowBefore().addRowAfter().run()
    expect(count('tr')).toBe(5)
    editor.chain().deleteRow().run()
    expect(count('tr')).toBe(4)
    const cols = count('th') + count('td')
    editor.chain().addColumnBefore().run()
    expect(count('th') + count('td')).toBeGreaterThan(cols)
    const headersBefore = count('th')
    editor.chain().toggleHeaderRow().run()
    expect(count('th')).not.toBe(headersBefore)
    editor.destroy()
  })

  it('병합된 표가 저장 형식 왕복에서 colspan 그대로 유지된다', async () => {
    const html = '<table><tbody><tr><td colspan="2" rowspan="1"><p>합침</p></td><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>'
    expect(classifyBlockFidelity(html).convertible).toBe(true)
    const out = docToBlocks(blocksToDoc([{ type: 'text', html }]))
    expect((out[0] as { html: string }).html).toContain('colspan="2"')
  })
})

describe('이미지 묶음 폭·정렬', () => {
  const imgs = [{ url: 'https://x/a.webp', alt: 'a' }]
  it('폭·정렬이 저장 형식 왕복에서 유지되고, 기본값이면 필드를 쓰지 않는다', () => {
    const custom = docToBlocks(blocksToDoc([{ type: 'image', layout: 'individual', images: imgs, width: 50, align: 'right' }]))
    expect(custom[0]).toMatchObject({ type: 'image', width: 50, align: 'right' })
    const plain = docToBlocks(blocksToDoc([{ type: 'image', layout: 'individual', images: imgs }]))
    expect(plain[0]).toEqual({ type: 'image', layout: 'individual', images: imgs }) // 기존 형식과 동일(필드 없음)
  })
  it('비정상 값(범위 밖·문자열·잘못된 정렬)은 허용 범위로 정규화된다', () => {
    const out = docToBlocks(blocksToDoc([{ type: 'image', layout: 'individual', images: imgs, width: 9999, align: 'diagonal' as never }]))
    expect(out[0]).toEqual({ type: 'image', layout: 'individual', images: imgs }) // 9999→100, diagonal→center → 기본값이라 생략
    const small = docToBlocks(blocksToDoc([{ type: 'image', layout: 'individual', images: imgs, width: 3 }]))
    expect((small[0] as { width: number }).width).toBe(20)
  })
  it('편집 화면 DOM에 폭·정렬 스타일이 반영된다', async () => {
    const { ImageGroup } = await import('$lib/components/editor/nodes/ImageGroup')
    expect(ImageGroup).toBeTruthy()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = new Editor({
      element: el,
      extensions: createRichExtensions(),
      content: { type: 'doc', content: [{ type: 'imageGroup', attrs: { layout: 'individual', images: imgs, width: 50, align: 'right' } }, { type: 'paragraph' }] },
    })
    const group = el.querySelector<HTMLElement>('.rc-images')!
    expect(group.style.width).toBe('50%')
    expect(group.style.alignSelf).toBe('flex-end')
    expect(group.getAttribute('layout')).toBeNull() // 불필요한 잡속성이 붙지 않음
    editor.destroy()
  })
})

describe('원본 그대로 불러온 본문의 위험 링크', () => {
  it('변환 가능 블록의 javascript: 링크는 문서로 불러올 때 제거된다(링크 마크로 남지 않음)', () => {
    const out = docToBlocks(blocksToDoc([{ type: 'text', html: '<p><a href="javascript:alert(1)">클릭</a> 글</p>' }]))
    const html = (out[0] as { html: string }).html
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('클릭')
  })
})
