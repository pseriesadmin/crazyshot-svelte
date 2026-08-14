/**
 * docxTableFormatting.ts — .docx OOXML 원본에서 표 셀 서식 추출 및 HTML 주입
 *
 * mammoth 라이브러리는 w:shd(배경색)·w:tcBorders(테두리색)를 변환 AST에 담지 않는다
 * (의미론적 변환만 지원하는 설계). 이 모듈은 동일 ArrayBuffer를 jszip으로 직접 열어
 * word/document.xml을 DOMParser로 파싱한 뒤, mammoth 출력 HTML에 서식을 병합한다.
 *
 * 안전 원칙 — 정확성이 완결성보다 우선:
 *   XML과 HTML의 표/행/셀 개수가 불일치하는 표는 서식 주입을 스킵.
 *   틀린 셀에 잘못 색을 입히는 것이 색이 없는 것보다 나쁘다.
 */

import JSZip from 'jszip'

// ─────────────────────────────────────────────────────────────────────────────
// Word ProcessingML 네임스페이스 URI
// ─────────────────────────────────────────────────────────────────────────────
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// ─────────────────────────────────────────────────────────────────────────────
// 공개 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 단일 표 셀의 서식 정보 */
export interface CellFormatting {
  /** CSS 배경색 '#RRGGBB' (없으면 undefined) */
  backgroundColor?: string
  /** CSS 테두리 색 '#RRGGBB' (없으면 undefined) */
  borderColor?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OOXML 컬러 원시값 → CSS '#RRGGBB' 변환
 * 'auto' / 'none' / null / 빈 문자열 → undefined
 */
function toHexColor(raw: string | null | undefined): string | undefined {
  if (!raw || raw === 'auto' || raw === 'none') return undefined
  const digits = raw.replace(/[^0-9A-Fa-f]/g, '')
  if (!digits) return undefined
  return '#' + digits.padStart(6, '0').slice(0, 6).toUpperCase()
}

/**
 * 요소의 직계 자식 중 지정 네임스페이스·localName 요소를 반환.
 * getElementsByTagNameNS는 재귀 탐색이라 중첩 표에서 오집계 위험이 있으므로
 * 직계 자식만 필터링한다.
 */
function directChildrenOf(parent: Element, ns: string, localName: string): Element[] {
  return Array.from(parent.children).filter(
    (c) => c.namespaceURI === ns && c.localName === localName,
  )
}

/**
 * w:* 속성 값 반환.
 * namespace-aware getAttributeNS 우선, 없으면 prefix 방식 폴백.
 */
function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`)
}

/** <w:tc> 요소에서 배경색·테두리색 추출 */
function extractCellFmt(tcEl: Element): CellFormatting {
  const result: CellFormatting = {}

  // <w:tcPr>
  const tcPrs = directChildrenOf(tcEl, W_NS, 'tcPr')
  if (!tcPrs.length) return result
  const tcPr = tcPrs[0]

  // ① 배경색: <w:shd w:fill="RRGGBB" />
  const shds = directChildrenOf(tcPr, W_NS, 'shd')
  if (shds.length) {
    const color = toHexColor(getWAttr(shds[0], 'fill'))
    if (color) result.backgroundColor = color
  }

  // ② 테두리색: <w:tcBorders> → 방향별 첫 번째 비-auto 색 채택
  const tcBordersEls = directChildrenOf(tcPr, W_NS, 'tcBorders')
  if (tcBordersEls.length) {
    const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    for (const side of sides) {
      const sideEls = directChildrenOf(tcBordersEls[0], W_NS, side)
      if (sideEls.length) {
        const color = toHexColor(getWAttr(sideEls[0], 'color'))
        if (color) {
          result.borderColor = color
          break
        }
      }
    }
  }

  return result
}

/**
 * XML 문서 element에서 모든 <w:tbl> 요소를 깊이 우선 순서(=문서 순서)로 수집.
 * mammoth도 동일한 문서 순서로 <table>을 출력하므로 인덱스가 1:1 대응된다.
 */
function collectTables(el: Element, result: Element[]): void {
  for (const child of Array.from(el.children)) {
    if (child.namespaceURI === W_NS && child.localName === 'tbl') {
      result.push(child)
      // 중첩 표도 포함 (표 안에 표가 있는 경우)
      collectTables(child, result)
    } else {
      collectTables(child, result)
    }
  }
}

/** 파싱된 XML 루트 element에서 서식 배열 구성 */
function buildFormattingFromRoot(root: Element): CellFormatting[][][] {
  const tables: Element[] = []
  collectTables(root, tables)

  return tables.map((tbl) => {
    // <w:tr>: 이 표의 직계 행만
    const rows = directChildrenOf(tbl, W_NS, 'tr')
    return rows.map((tr) => {
      // <w:tc>: 이 행의 직계 셀만
      const cells = directChildrenOf(tr, W_NS, 'tc')
      return cells.map((tc) => extractCellFmt(tc))
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * <table> 요소의 직계 행 목록 반환 (tbody/thead/tfoot 한 단계 통과)
 */
function getTableDirectRows(table: Element): Element[] {
  const rows: Element[] = []
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toUpperCase()
    if (['TBODY', 'THEAD', 'TFOOT'].includes(tag)) {
      for (const grandchild of Array.from(child.children)) {
        if (grandchild.tagName.toUpperCase() === 'TR') rows.push(grandchild)
      }
    } else if (tag === 'TR') {
      rows.push(child)
    }
  }
  return rows
}

/** <tr> 요소의 직계 셀 목록 반환 */
function getRowDirectCells(row: Element): Element[] {
  return Array.from(row.children).filter((el) =>
    ['TD', 'TH'].includes(el.tagName.toUpperCase()),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * .docx ArrayBuffer에서 표 셀 서식 정보를 추출한다.
 *
 * jszip으로 word/document.xml을 꺼내고 DOMParser(application/xml)로 파싱.
 *
 * @returns [tableIndex][rowIndex][cellIndex] 형태의 서식 배열
 */
export async function extractTableFormatting(
  arrayBuffer: ArrayBuffer,
): Promise<CellFormatting[][][]> {
  // ① ZIP → word/document.xml
  const zip = await JSZip.loadAsync(arrayBuffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return []

  const xmlString = await docFile.async('string')
  return parseTableFormattingFromXml(xmlString)
}

/**
 * XML 문자열에서 직접 서식 추출 (테스트·디버깅 용도 내보내기).
 * extractTableFormatting 내부에서도 호출한다.
 */
export function parseTableFormattingFromXml(xmlString: string): CellFormatting[][][] {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml')

  // 파싱 에러 확인
  if (xmlDoc.getElementsByTagName('parsererror').length) return []

  return buildFormattingFromRoot(xmlDoc.documentElement)
}

/**
 * mammoth 출력 HTML에 표 셀 서식(배경색·테두리색)을 주입한다.
 *
 * XML과 HTML의 표/행/셀 개수가 불일치하는 표는 안전을 위해 주입을 건너뛴다.
 *
 * @param html       mammoth가 변환한 HTML 문자열
 * @param formatting extractTableFormatting()의 반환값
 * @returns 서식이 주입된 HTML 문자열
 */
export function injectTableFormattingIntoHtml(
  html: string,
  formatting: CellFormatting[][][],
): string {
  if (!formatting.length) return html

  // HTML 파싱 — 브라우저 document / jsdom 전역 사용
  const container = document.createElement('div')
  container.innerHTML = html

  // querySelectorAll은 문서 순서(깊이 우선)로 반환 → XML collectTables와 동일 순서
  const allHtmlTables = Array.from(container.querySelectorAll('table'))

  for (let ti = 0; ti < formatting.length; ti++) {
    const tableFmt = formatting[ti]
    const htmlTable = allHtmlTables[ti]
    if (!htmlTable) continue

    const htmlRows = getTableDirectRows(htmlTable)

    // 행 개수 불일치 → 이 표 전체 스킵
    if (htmlRows.length !== tableFmt.length) continue

    // 셀 개수 사전 검증 — 하나라도 불일치하면 표 전체 스킵
    let safe = true
    for (let ri = 0; ri < tableFmt.length; ri++) {
      const htmlCells = getRowDirectCells(htmlRows[ri])
      if (htmlCells.length !== tableFmt[ri].length) {
        safe = false
        break
      }
    }
    if (!safe) continue

    // 서식 주입
    for (let ri = 0; ri < tableFmt.length; ri++) {
      const rowFmt = tableFmt[ri]
      const htmlCells = getRowDirectCells(htmlRows[ri])
      for (let ci = 0; ci < rowFmt.length; ci++) {
        const cellFmt = rowFmt[ci]
        const td = htmlCells[ci]
        if (!td) continue

        const parts: string[] = []
        if (cellFmt.backgroundColor) parts.push(`background-color:${cellFmt.backgroundColor}`)
        if (cellFmt.borderColor) parts.push(`border-color:${cellFmt.borderColor}`)
        if (!parts.length) continue

        const existing = (td.getAttribute('style') ?? '').trimEnd()
        const separator = existing && !existing.endsWith(';') ? ';' : ''
        td.setAttribute('style', existing + separator + parts.join(';'))
      }
    }
  }

  return container.innerHTML
}
