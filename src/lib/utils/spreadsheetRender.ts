/**
 * spreadsheetRender.ts — SpreadsheetDocument → HTML 변환 유틸
 *
 * - renderTiptapDocToHtml()과 동일 원칙: DOM 미사용 순수 문자열 함수
 * - SSR·Node.js 환경에서도 동작
 * - 셀 텍스트는 반드시 HTML 이스케이프 후 렌더링(XSS 방지)
 * - 멀티 시트: 시트별 <div class="ss-sheet-page">로 래핑, 2번째 시트부터 page-break-before
 * - 병합: computeMergeLayout()으로 rowspan·colspan 계산
 * - 컬럼 너비: fitColumnWidthsToTarget()으로 A4 폭 축소 후 <colgroup>으로 지정
 * - 배경색·테두리색: CSS 색상 검증(#RRGGBB) 후 인라인 스타일로 삽입
 *
 * 사용처:
 *   - /contract/[token]/+page.svelte (고객 서명화면 — spreadsheet 모드)
 *   - ContractTemplatePreviewModal.svelte (발송 전 미리보기 — spreadsheet 모드)
 */

import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { XlsxCellFormatting } from '$lib/types/sheet-format'
import { hasImageOverlay, splitCellImageOverlay } from '$lib/types/sheet-format'
import { computeMergeLayout } from '$lib/utils/docImport/xlsxImport'
import { fitColumnWidthsToTarget } from '$lib/utils/docImport/fitColumnWidths'

/** 이미지 셀 URL로 허용하는 형식 — http(s) 절대 URL만 (javascript: 등 스킴 인젝션 방지) */
const SAFE_IMAGE_URL = /^https?:\/\//i

// ─────────────────────────────────────────────────────────────────────────────
// XSS 방지 HTML 이스케이프
// ─────────────────────────────────────────────────────────────────────────────

/** 셀 텍스트를 HTML에 안전하게 삽입하기 위한 이스케이프 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS 색상 검증
// ─────────────────────────────────────────────────────────────────────────────

/** #RRGGBB 형식의 CSS 색상만 허용 (인라인 스타일 삽입 전 XSS 방지) */
const CSS_HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

function isValidCssColor(color: string): boolean {
  return CSS_HEX_COLOR.test(color)
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 인라인 스타일 생성
// ─────────────────────────────────────────────────────────────────────────────

/** XlsxCellFormatting → 검증된 inline style 문자열 (빈 서식이면 '') */
function cellFormattingToStyle(fmt: XlsxCellFormatting): string {
  const parts: string[] = []
  if (fmt.backgroundColor && isValidCssColor(fmt.backgroundColor)) {
    parts.push(`background-color:${fmt.backgroundColor}`)
  }
  if (fmt.borderColor && isValidCssColor(fmt.borderColor)) {
    parts.push(`border:1px solid ${fmt.borderColor}`)
  }
  return parts.join(';')
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 시트 → HTML <table>
// ─────────────────────────────────────────────────────────────────────────────

function renderSheetToTable(sheet: SpreadsheetSheet): string {
  const { rows, merges, colWidths, cellFormatting } = sheet

  if (rows.length === 0) return '<table class="ss-table"><tbody></tbody></table>'

  const { coveredCells, anchorSpan } = computeMergeLayout(merges)
  const fittedWidths = fitColumnWidthsToTarget(colWidths)
  const colCount = rows[0]?.length ?? 0

  // <colgroup> — 컬럼 너비 지정
  const colgroupParts: string[] = ['<colgroup>']
  for (let c = 0; c < colCount; c++) {
    const w = fittedWidths[c]
    if (typeof w === 'number' && w > 0) {
      colgroupParts.push(`<col style="width:${w}px">`)
    } else {
      colgroupParts.push('<col>')
    }
  }
  colgroupParts.push('</colgroup>')

  // <tbody> — 각 행·셀 렌더링
  const tbodyParts: string[] = ['<tbody>']
  rows.forEach((row, rowIdx) => {
    tbodyParts.push('<tr>')
    row.forEach((cellText, colIdx) => {
      const key = `${rowIdx}:${colIdx}`
      if (coveredCells.has(key)) return // 병합에 덮인 셀: 스킵

      const span = anchorSpan.get(key)
      const attrs: string[] = []
      if (span && span.rowspan > 1) attrs.push(`rowspan="${span.rowspan}"`)
      if (span && span.colspan > 1) attrs.push(`colspan="${span.colspan}"`)

      // 이미지 오버레이(서명/직인) — 원본 텍스트는 유지하고 그 위에 <img>를 절대위치로
      // 겹쳐 그린다(도장을 인쇄된 텍스트 위에 찍는 개념). 절대위치의 기준(containing block)
      // 이 되려면 <td> 자체가 position:relative여야 하므로, 오버레이가 있을 때만 스타일에
      // 추가한다. offsetX/offsetY는 CMS 에디터에서 드래그로 옮긴 위치(셀 중앙 기준 px) —
      // 고객 화면도 그 최종 위치 그대로 반영해야 하므로 transform에 함께 반영한다
      // (CSS 클래스 .ss-cell-image의 기본 translate(-50%,-50%)를 인라인으로 덮어씀).
      let displayText = cellText
      let overlayHtml = ''
      if (hasImageOverlay(cellText)) {
        const { text, imageUrl, width, offsetX, offsetY } = splitCellImageOverlay(cellText)
        displayText = text
        // 방어적 검증 — http(s) 절대 URL이 아니면(예: 손상된 값) 이미지로 그리지 않고
        // 마커 원문을 그대로 이스케이프해 표시(마커 문자열이 그대로 보여도 안전이 우선).
        if (imageUrl && SAFE_IMAGE_URL.test(imageUrl)) {
          // ContractDocumentEditor.svelte 너비 입력(min 20 / max 1200)과 동일 범위로 clamp
          const safeWidth = Math.min(1200, Math.max(20, width))
          const transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`
          overlayHtml = `<img src="${escapeHtml(imageUrl)}" alt="서명/직인" class="ss-cell-image" style="width:${safeWidth}px;transform:${transform}" />`
        } else {
          displayText = cellText
        }
      }

      // 인라인 스타일 (배경색·테두리색 + 오버레이 있을 때 position:relative)
      const fmt = cellFormatting[rowIdx]?.[colIdx] ?? {}
      const styleParts = [cellFormattingToStyle(fmt)].filter(Boolean)
      if (overlayHtml) styleParts.push('position:relative')
      const styleStr = styleParts.join(';')
      if (styleStr) attrs.push(`style="${styleStr}"`)

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
      const cellHtml = escapeHtml(displayText) + overlayHtml
      tbodyParts.push(`<td${attrStr}>${cellHtml}</td>`)
    })
    tbodyParts.push('</tr>')
  })
  tbodyParts.push('</tbody>')

  return `<table class="ss-table">${colgroupParts.join('')}${tbodyParts.join('')}</table>`
}

// ─────────────────────────────────────────────────────────────────────────────
// SpreadsheetDocument → HTML (공개 API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SpreadsheetDocument를 계약서 렌더링용 HTML 문자열로 변환한다.
 *
 * 멀티 시트는 각 시트를 `<div class="ss-sheet-page">` 로 래핑하고,
 * 2번째 시트부터 `page-break-before:always` 스타일을 추가한다.
 * 각 시트 앞에는 시트 이름 `<h4 class="ss-sheet-name">` 제목이 붙는다.
 *
 * 셀 텍스트는 모두 HTML 이스케이프 처리됨 (XSS 안전).
 * 배경색·테두리색은 #RRGGBB 형식만 인라인 스타일로 허용 (그 외 값은 무시).
 */
export function renderSpreadsheetToHtml(doc: SpreadsheetDocument): string {
  if (doc.sheets.length === 0) return ''

  const sheetParts: string[] = []

  doc.sheets.forEach((sheet, idx) => {
    const pageBreak = idx > 0 ? ' style="page-break-before:always"' : ''
    const safeName = escapeHtml(sheet.name)
    const tableHtml = renderSheetToTable(sheet)
    sheetParts.push(
      `<div class="ss-sheet-page"${pageBreak}>` +
        `<h4 class="ss-sheet-name">${safeName}</h4>` +
        tableHtml +
        `</div>`,
    )
  })

  return sheetParts.join('')
}
