/**
 * xlsxImport.ts — SheetJS 기반 .xlsx 시트 파싱 + TipTap 표 노드 변환
 *
 * 클라이언트 전용 (브라우저에서 SheetJS 실행).
 */

import * as XLSX from 'xlsx'
import type { JSONContent } from '@tiptap/core'

export interface XlsxSheetInfo {
  name: string
}

export interface XlsxImportOptions {
  /** 파싱할 시트 이름 */
  sheetName: string
  /**
   * 범위 (e.g., 'A1:D10'). 미지정 시 시트 전체 범위.
   * 행수가 100을 넘으면 서버 응답 지연을 유발할 수 있으므로 UI에서 제한.
   */
  range?: string
}

/**
 * File 객체에서 XLSX Workbook을 로드하고 시트 목록을 반환한다.
 */
export async function getSheetNames(file: File): Promise<XlsxSheetInfo[]> {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  return wb.SheetNames.map((name) => ({ name }))
}

/**
 * 특정 시트를 파싱해 2D 문자열 배열을 반환한다.
 */
export async function parseSheet(
  file: File,
  options: XlsxImportOptions
): Promise<string[][]> {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })

  const ws = wb.Sheets[options.sheetName]
  if (!ws) throw new Error(`시트 "${options.sheetName}"를 찾을 수 없습니다.`)

  const opts: XLSX.Sheet2JSONOpts = {
    header: 1,       // 2D 배열 반환
    defval: '',      // 빈 셀 → 빈 문자열
    blankrows: false, // 완전 빈 행 제거
    ...(options.range ? { range: options.range } : {}),
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(ws, opts)

  // 모든 셀을 문자열로 변환 (숫자·날짜 등 포함)
  return rows.map((row) =>
    row.map((cell) => (cell == null ? '' : String(cell)))
  )
}

/**
 * 2D 문자열 배열을 TipTap 테이블 JSONContent 노드로 변환한다.
 * 첫 번째 행은 tableHeader 셀로, 나머지는 tableCell 로 처리한다.
 *
 * @param rows - 2D 문자열 배열 (첫 행 = 헤더 가정)
 */
export function rowsToTiptapTable(rows: string[][]): JSONContent {
  if (rows.length === 0) {
    throw new Error('변환할 데이터가 없습니다.')
  }

  const tiptapRows: JSONContent[] = rows.map((row, rowIdx) => {
    const isHeader = rowIdx === 0

    const cells: JSONContent[] = row.map((cellText) => ({
      type: isHeader ? 'tableHeader' : 'tableCell',
      attrs: {},
      content: [
        {
          type: 'paragraph',
          content: cellText
            ? [{ type: 'text', text: cellText }]
            : [],
        },
      ],
    }))

    return {
      type: 'tableRow',
      content: cells,
    }
  })

  return {
    type: 'table',
    content: tiptapRows,
  }
}
