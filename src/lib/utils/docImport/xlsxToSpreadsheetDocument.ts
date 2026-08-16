/**
 * xlsxToSpreadsheetDocument.ts — .xlsx 파일 전체를 SpreadsheetDocument로 변환
 *
 * 클라이언트 전용 (xlsxImport.ts의 parseSheet/getSheetNames가 DOMParser를 사용하므로).
 * ContractImportModal.svelte의 xlsx 분기에서 호출된다.
 *
 * SheetJS 기반 파싱(xlsxImport.ts)을 재사용 — OOXML 파싱 중복 없음.
 * range 옵션 없이 전체 시트를 파싱하며, 5,000행 합산 초과 시 호출부에서 경고.
 */

import { getSheetNames, parseSheet } from '$lib/utils/docImport/xlsxImport'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'

/**
 * File 객체(.xlsx)의 모든 시트를 파싱해 SpreadsheetDocument로 반환한다.
 *
 * @param file .xlsx 파일 (클라이언트 File 객체)
 * @returns SpreadsheetDocument (activeSheetIndex=0)
 * @throws 시트 조회 또는 파싱 실패 시 Error
 */
export async function importWorkbookAsSpreadsheetDocument(file: File): Promise<SpreadsheetDocument> {
  const sheetInfos = await getSheetNames(file)

  if (sheetInfos.length === 0) {
    throw new Error('파싱 가능한 시트가 없습니다.')
  }

  const sheets: SpreadsheetSheet[] = []
  for (const { name } of sheetInfos) {
    const data = await parseSheet(file, { sheetName: name })
    sheets.push({
      name,
      rows: data.rows,
      merges: data.merges,
      colWidths: data.colWidths,
      cellFormatting: data.cellFormatting,
    })
  }

  return { sheets, activeSheetIndex: 0 }
}

/**
 * SpreadsheetDocument의 전체 행 수를 계산한다 (시트 합산).
 * 5,000행 초과 경고 판단에 사용.
 */
export function countTotalRows(doc: SpreadsheetDocument): number {
  return doc.sheets.reduce((sum, s) => sum + s.rows.length, 0)
}
