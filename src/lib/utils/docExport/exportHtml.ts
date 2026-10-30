/**
 * exportHtml.ts — 계약서 양식 "파일 저장"용 HTML 만들기 (순수 함수 — DOM 불필요)
 *
 * 문서형(flow) 양식: TipTap 문서(JSON) → HTML. 변수칩은 `{{변수명}}` 글자로 풀어(substituteTiptapDoc에 빈 데이터)
 *   양식 사본에 변수 표기가 그대로 남게 한다. 표 반복 영역은 지정된 행을 1회만 출력하고 표식은 지운다.
 * HTML형(html) 양식: 고정 서식 HTML을 그대로 쓴다(스타일 포함).
 * 완성 문서(wrapHtmlDocument): 내려받는 .html 과 서버 PDF 변환의 입력으로 쓰는 독립 HTML 문서.
 */
import type { JSONContent } from '@tiptap/core'
import { renderTiptapDocToHtml, substituteTiptapDoc } from '$lib/utils/tiptapRender'
import type { SpreadsheetDocument } from '$lib/types/contract-document'
import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
import { hasImageOverlay, splitCellImageOverlay, plainCellText } from '$lib/types/sheet-format'

/** 문서형 양식의 TipTap 문서 → 내보내기용 본문 HTML(변수는 {{변수명}} 그대로) */
export function flowDocToExportHtml(doc: JSONContent): string {
  const plain = substituteTiptapDoc(doc, {})
  return renderTiptapDocToHtml(plain)
    // 화면용 표 가로 스크롤 래퍼는 파일에 필요 없다
    .replace(/<div class="tt-table-scroll">(<table[\s\S]*?<\/table>)<\/div>/g, '$1')
    // 반복 영역 표식(data-repeat-region)은 편집기 전용
    .replace(/\sdata-repeat-region="true"/g, '')
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 스프레드시트형 양식 표(.ss-table)의 기본 모양 — 고객 계약서 화면(/contract/[token])의 스타일과 같은 값 */
const SPREADSHEET_CSS = `
  .ss-sheet-page { margin-bottom: 24px; }
  .ss-sheet-name { font-size: 13px; font-weight: 700; margin: 0 0 8px; }
  .ss-table { border-collapse: collapse; font-size: 12px; }
  .ss-table td { border: 1px solid #ccc; padding: 4px 6px; white-space: pre-wrap; vertical-align: top; word-break: break-all; }
`

export interface SpreadsheetExportHtml {
  /** 스타일을 포함한 본문 HTML(HTML형 양식과 같은 형태) */
  html: string
  /** 서명·직인 이미지 겹침이 있어 글자만 남겼는지 */
  droppedImages: boolean
  /** 모든 칸이 비어 있는지 */
  isEmpty: boolean
}

/**
 * 스프레드시트형 양식 → 내보내기용 HTML. 고객 화면과 같은 변환기(renderSpreadsheetToHtml)를 쓰되,
 * 서명·직인 이미지 겹침은 파일 형식마다 다루는 방식이 달라 글자만 남긴다. `{{변수}}`는 그대로 둔다.
 */
export function spreadsheetDocToExportHtml(doc: SpreadsheetDocument): SpreadsheetExportHtml {
  let droppedImages = false
  let isEmpty = true
  const stripped: SpreadsheetDocument = {
    ...doc,
    sheets: doc.sheets.filter((s) => !s.hidden).map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) =>
        row.map((cell) => {
          let text = typeof cell === 'string' ? cell : cell == null ? '' : String(cell)
          if (hasImageOverlay(text)) {
            droppedImages = true
            text = splitCellImageOverlay(text).text
          }
          if (plainCellText(text).trim() !== '') isEmpty = false
          return text
        }),
      ),
    })),
  }
  return { html: `<style>${SPREADSHEET_CSS}</style>${renderSpreadsheetToHtml(stripped)}`, droppedImages, isEmpty }
}

const BASE_CSS = `
  @page { size: A4; margin: 15mm; }
  body { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; font-size: 12px; color: #000; line-height: 1.6; }
  table { border-collapse: collapse; }
  img { max-width: 100%; }
`

/** 본문 HTML(조각 또는 <style> 포함)을 독립 HTML 문서로 감싼다. 제목은 문서 제목(<title>)에 쓰인다. */
export function wrapHtmlDocument(args: { title: string; bodyHtml: string }): string {
  const title = escapeHtmlText(args.title || '계약서 양식')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${args.bodyHtml}
</body>
</html>
`
}

/** 서버로 보내는 HTML 크기 상한(문자 수 기준 — data URL 이미지 포함). 서버도 같은 값으로 다시 검사한다. */
export const EXPORT_HTML_MAX_CHARS = 2_000_000
