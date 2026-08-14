// @vitest-environment jsdom

/**
 * docxTableFormatting.test.ts
 *
 * .docx OOXML에서 표 셀 배경색·테두리색 추출 및 HTML 주입 검증.
 * jszip으로 합성 .docx 버퍼를 생성해 실제 파일 없이 검증.
 */

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  extractTableFormatting,
  injectTableFormattingIntoHtml,
  parseTableFormattingFromXml,
  type CellFormatting,
} from '$lib/utils/docImport/docxTableFormatting'

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const W_NS_DECL = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** Word 최소 XML 문서 생성 */
function makeWordXml(bodyContent: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document ${W_NS_DECL}><w:body>${bodyContent}</w:body></w:document>`
  )
}

/** 합성 .docx ArrayBuffer 생성 (word/document.xml만 포함한 최소 ZIP) */
async function makeSyntheticDocx(bodyContent: string): Promise<ArrayBuffer> {
  const xml = makeWordXml(bodyContent)
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'arraybuffer' })
}

interface CellSpec {
  fill?: string        // w:fill 값 (e.g. 'FF0000' or 'auto')
  borderColor?: string // w:color 값 (e.g. '0000FF' or 'auto')
}

/** 단순 표 OOXML 생성 */
function makeTableXml(rows: CellSpec[][]): string {
  const rowsXml = rows
    .map((row) => {
      const cellsXml = row
        .map((cell) => {
          let tcPrContent = ''
          if (cell.fill !== undefined) {
            tcPrContent += `<w:shd w:val="clear" w:fill="${cell.fill}"/>`
          }
          if (cell.borderColor !== undefined) {
            tcPrContent += `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="${cell.borderColor}"/></w:tcBorders>`
          }
          const tcPr = tcPrContent ? `<w:tcPr>${tcPrContent}</w:tcPr>` : ''
          return `<w:tc>${tcPr}<w:p/></w:tc>`
        })
        .join('')
      return `<w:tr>${cellsXml}</w:tr>`
    })
    .join('')
  return `<w:tbl>${rowsXml}</w:tbl>`
}

// ─────────────────────────────────────────────────────────────────────────────
// extractTableFormatting — 배경색 추출
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTableFormatting — 배경색 추출', () => {
  it('셀 배경색 #FF0000 정확히 추출', async () => {
    const buf = await makeSyntheticDocx(makeTableXml([[{ fill: 'FF0000' }]]))
    const result = await extractTableFormatting(buf)
    expect(result).toHaveLength(1)         // 표 1개
    expect(result[0]).toHaveLength(1)      // 행 1개
    expect(result[0][0]).toHaveLength(1)   // 셀 1개
    expect(result[0][0][0].backgroundColor).toBe('#FF0000')
  })

  it('w:fill="auto" → backgroundColor 없음', async () => {
    const buf = await makeSyntheticDocx(makeTableXml([[{ fill: 'auto' }]]))
    const result = await extractTableFormatting(buf)
    expect(result[0][0][0].backgroundColor).toBeUndefined()
  })

  it('서식 없는 셀 → 빈 CellFormatting 객체 반환', async () => {
    const buf = await makeSyntheticDocx(makeTableXml([[{}]]))
    const result = await extractTableFormatting(buf)
    expect(result[0][0][0]).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractTableFormatting — 테두리색 추출
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTableFormatting — 테두리색 추출', () => {
  it('셀 테두리색 #0000FF 정확히 추출', async () => {
    const buf = await makeSyntheticDocx(makeTableXml([[{ borderColor: '0000FF' }]]))
    const result = await extractTableFormatting(buf)
    expect(result[0][0][0].borderColor).toBe('#0000FF')
  })

  it('w:color="auto" → borderColor 없음', () => {
    // parseTableFormattingFromXml을 직접 사용 (jszip 불필요)
    const xml = makeWordXml(
      `<w:tbl><w:tr><w:tc>` +
      `<w:tcPr><w:tcBorders><w:top w:val="single" w:color="auto"/></w:tcBorders></w:tcPr>` +
      `<w:p/></w:tc></w:tr></w:tbl>`,
    )
    const result = parseTableFormattingFromXml(xml)
    expect(result[0][0][0].borderColor).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractTableFormatting — 위치 정확성 (2×2 표, 복수 표)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractTableFormatting — 위치 정확성', () => {
  it('2×2 표에서 대각선 셀의 서식 위치 구분', async () => {
    const buf = await makeSyntheticDocx(
      makeTableXml([
        [{ fill: 'FF0000' }, {}],
        [{}, { fill: '00FF00' }],
      ]),
    )
    const result = await extractTableFormatting(buf)
    expect(result[0][0][0].backgroundColor).toBe('#FF0000')   // (행0, 셀0)
    expect(result[0][0][1].backgroundColor).toBeUndefined()    // (행0, 셀1)
    expect(result[0][1][0].backgroundColor).toBeUndefined()    // (행1, 셀0)
    expect(result[0][1][1].backgroundColor).toBe('#00FF00')   // (행1, 셀1)
  })

  it('복수 표의 서식이 서로 다른 테이블 인덱스에 저장', async () => {
    const twoTables = makeTableXml([[{ fill: 'FF0000' }]]) + makeTableXml([[{ fill: '00FF00' }]])
    const buf = await makeSyntheticDocx(twoTables)
    const result = await extractTableFormatting(buf)
    expect(result).toHaveLength(2)
    expect(result[0][0][0].backgroundColor).toBe('#FF0000')
    expect(result[1][0][0].backgroundColor).toBe('#00FF00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// injectTableFormattingIntoHtml — 정상 주입
// ─────────────────────────────────────────────────────────────────────────────

describe('injectTableFormattingIntoHtml — 정상 주입', () => {
  it('배경색이 td style에 주입됨', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [[[{ backgroundColor: '#FF0000' }]]]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).toContain('background-color:#FF0000')
  })

  it('테두리색이 td style에 주입됨', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [[[{ borderColor: '#0000FF' }]]]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).toContain('border-color:#0000FF')
  })

  it('배경색과 테두리색 동시 주입', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [[[{ backgroundColor: '#FF0000', borderColor: '#0000FF' }]]]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).toContain('background-color:#FF0000')
    expect(result).toContain('border-color:#0000FF')
  })

  it('기존 style 속성 보존 후 배경색 추가 — text-align 유지', () => {
    const html = '<table><tr><td style="text-align:center">내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [[[{ backgroundColor: '#FF0000' }]]]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).toContain('text-align:center')
    expect(result).toContain('background-color:#FF0000')
  })

  it('서식 없는 셀(빈 객체)은 style 속성 추가 안 함', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [[[{}]]]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).not.toContain('style=')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// injectTableFormattingIntoHtml — 안전장치: 개수 불일치 시 스킵
// ─────────────────────────────────────────────────────────────────────────────

describe('injectTableFormattingIntoHtml — 안전장치', () => {
  it('XML 셀 2개 vs HTML 셀 1개 → 해당 표 서식 주입 안 함', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    // XML에서는 셀 2개로 추출됐다고 가정
    const fmt: CellFormatting[][][] = [
      [[{ backgroundColor: '#FF0000' }, { backgroundColor: '#00FF00' }]],
    ]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).not.toContain('background-color')
  })

  it('XML 행 2개 vs HTML 행 1개 → 해당 표 서식 주입 안 함', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const fmt: CellFormatting[][][] = [
      [[{ backgroundColor: '#FF0000' }], [{ backgroundColor: '#00FF00' }]],
    ]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).not.toContain('background-color')
  })

  it('formatting이 빈 배열이면 HTML 그대로 반환', () => {
    const html = '<table><tr><td>내용</td></tr></table>'
    const result = injectTableFormattingIntoHtml(html, [])
    expect(result).toBe(html)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 통합 — 정렬 서식과 배경색·테두리색 동시 반영
// ─────────────────────────────────────────────────────────────────────────────

describe('통합 — 정렬 서식과 표 색상 동시 반영', () => {
  it('text-align:center 셀에 background-color 추가해도 정렬 유지', () => {
    const html =
      '<table><tr>' +
      '<td style="text-align:center">정렬+배경</td>' +
      '<td>일반</td>' +
      '</tr></table>'
    const fmt: CellFormatting[][][] = [
      [[{ backgroundColor: '#AABBCC' }, {}]],
    ]
    const result = injectTableFormattingIntoHtml(html, fmt)
    expect(result).toContain('text-align:center')
    expect(result).toContain('background-color:#AABBCC')
    // 두 번째 셀은 서식 없음
    const secondTd = result.match(/<td[^>]*>일반<\/td>/)?.[0] ?? ''
    expect(secondTd).not.toContain('background-color')
  })
})
