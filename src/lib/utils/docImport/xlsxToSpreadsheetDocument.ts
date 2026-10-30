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
import { cellAddress } from '$lib/types/sheet-format'
import { extractWorkbookExtras, applyWorkbookExtras } from '$lib/utils/docImport/xlsxExtras'
import { computeWorkbook } from '$lib/utils/sheetFormula'
import { readBiffWorkbookCached } from './xlsBiff'
import { placeTextBoxes } from './xlsTextBoxes'

/**
 * File 객체(.xlsx)의 모든 시트를 파싱해 SpreadsheetDocument로 반환한다.
 *
 * @param file .xlsx 파일 (클라이언트 File 객체)
 * @returns SpreadsheetDocument (activeSheetIndex=0)
 * @throws 시트 조회 또는 파싱 실패 시 Error
 */
export async function importWorkbookAsSpreadsheetDocument(file: File): Promise<SpreadsheetDocument> {
  return (await importWorkbookWithStats(file)).doc
}

/** importWorkbookAsSpreadsheetDocument + 수식 연결 결과(몇 개를 연결했고 몇 개를 값만 남겼는지) */
export async function importWorkbookWithStats(file: File): Promise<{ doc: SpreadsheetDocument; stats: FormulaLinkStats }> {
  const sheetInfos = await getSheetNames(file)

  if (sheetInfos.length === 0) {
    throw new Error('파싱 가능한 시트가 없습니다.')
  }

  const sheets: SpreadsheetSheet[] = []
  for (const { name } of sheetInfos) {
    // preserveLayout — 원본의 열 너비·행 높이·빈 행·테두리를 그대로 가져온다(A4 폭 맞춤은 편집기의 'A4 폭 맞춤' 버튼으로)
    const data = await parseSheet(file, { sheetName: name, preserveLayout: true })
    sheets.push({
      name,
      rows: data.rows,
      merges: data.merges,
      colWidths: data.colWidths,
      ...(data.rowHeights.some((h) => h !== null) ? { rowHeights: data.rowHeights } : {}),
      ...(data.formulas ? { formulas: data.formulas } : {}),
      ...(data.numFmts ? { numFmts: data.numFmts } : {}),
      cellFormatting: data.cellFormatting,
    })
  }

  // 숨김 시트·틀 고정·하이퍼링크·선(테두리) — 가져오지 못해도 값·서식 가져오기에는 영향 없음
  const extras = await extractWorkbookExtras(await file.arrayBuffer())
  // 구형 엑셀(.xls)의 글상자 글자 — 칸 위에 떠 있어 격자에 값이 없으므로 가까운 빈 칸의 값으로 옮긴다
  const biff = readBiffWorkbookCached(await file.arrayBuffer())
  if (biff) {
    sheets.forEach((sh, i) => {
      const boxes = biff.textBoxesBySheet.get(sh.name)
      if (boxes?.length) sheets[i] = placeTextBoxes(sh, boxes).sheet
    })
  }
  const withExtras = applyWorkbookExtras({ sheets, activeSheetIndex: 0 }, extras)
  return linkFormulas(withExtras)
}

export interface FormulaLinkStats {
  /** 시트 간 연결까지 계속 계산되도록 가져온 수식 칸 수 */
  linked: number
  /** 이 엔진의 계산 결과가 엑셀이 계산해 둔 값과 달라 값만 남긴 수식 칸 수 */
  valueOnly: number
}

/** 칸 원문(수식은 "=…")으로 만든 입력 */
function toEngineInput(doc: SpreadsheetDocument): Parameters<typeof computeWorkbook>[0] {
  return doc.sheets.map((s) => ({
    name: s.name,
    raw: s.rows.map((row, r) => row.map((v, c) => s.formulas?.[cellAddress(r, c)] ?? v)),
    numFmts: s.numFmts,
  }))
}

const NORMALIZE = (t: string): string => t.replace(/\s+/g, '').toLowerCase()

/**
 * 수식 칸을 검증하고 계산된 값으로 채운다. 이 엔진의 결과가 엑셀이 계산해 둔 값(가져온 직후 rows 에 들어 있는 글자)과 같은 수식만
 * 연결 상태로 두고, 다른 수식은 값만 남긴다(엔진이 엑셀과 다르게 계산하는 수식으로 계약서 값이 바뀌는 일을 막기 위함).
 * 단, 내장 날짜 서식 27~33번 칸은 라이브러리가 미국식으로 잘못 풀어 둔 글자라 비교하지 않고 엔진의 한국어 서식 결과를 쓴다.
 */
export function linkFormulas(doc: SpreadsheetDocument): { doc: SpreadsheetDocument; stats: FormulaLinkStats } {
  const stats: FormulaLinkStats = { linked: 0, valueOnly: 0 }
  if (!doc.sheets.some((s) => s.formulas)) return { doc, stats }
  const computed = computeWorkbook(toEngineInput(doc))
  const sheets = doc.sheets.map((sheet, si) => {
    if (!sheet.formulas) return sheet
    const rows = sheet.rows.map((r) => [...r])
    const formulas: Record<string, string> = {}
    for (const [addr, formula] of Object.entries(sheet.formulas)) {
      const { r, c } = decodeAddress(addr)
      const cached = rows[r]?.[c] ?? ''
      const result = computed[si].get(addr) ?? ''
      const koreanBuiltin = sheet.numFmts?.[addr]?.includes('"년"') || sheet.numFmts?.[addr]?.includes('"월"') || sheet.numFmts?.[addr]?.includes('"시"')
      if (koreanBuiltin || NORMALIZE(result) === NORMALIZE(cached)) {
        formulas[addr] = formula
        if (rows[r]) rows[r][c] = result
        stats.linked++
      } else {
        stats.valueOnly++
      }
    }
    const numFmts = sheet.numFmts ? Object.fromEntries(Object.entries(sheet.numFmts).filter(([a]) => a in formulas)) : undefined
    const { formulas: _f, numFmts: _n, ...rest } = sheet
    void _f
    void _n
    return {
      ...rest,
      rows,
      ...(Object.keys(formulas).length ? { formulas } : {}),
      ...(numFmts && Object.keys(numFmts).length ? { numFmts } : {}),
    }
  })
  return { doc: { ...doc, sheets }, stats }
}

/** "C3" → {r:2,c:2} */
function decodeAddress(addr: string): { r: number; c: number } {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(addr)
  if (!m) return { r: -1, c: -1 }
  return { r: parseInt(m[2], 10) - 1, c: [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 }
}

/**
 * SpreadsheetDocument의 전체 행 수를 계산한다 (시트 합산).
 * 5,000행 초과 경고 판단에 사용.
 */
export function countTotalRows(doc: SpreadsheetDocument): number {
  return doc.sheets.reduce((sum, s) => sum + s.rows.length, 0)
}
