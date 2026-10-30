/**
 * exportContract.ts — 계약서 양식 "파일 저장" 진행 (브라우저 전용)
 *
 * 편집 중인 문서를 .hwp / .hwpx / .docx / .pdf / .html 중 하나로 내 컴퓨터에 내려받는다. 양식 저장(DB)과는 별개이고
 * 저장하지 않은 편집 내용도 그대로 내려받는다. 변수는 `{{변수명}}`으로 남긴다(양식 사본).
 *
 *  .html  브라우저에서 바로
 *  .pdf   서버(기존 Chromium 엔진) — POST /api/cms/contract-templates/export-pdf
 *  .hwp / .hwpx  브라우저(한글 엔진 rhwp, 지연 로딩)
 *  .docx  브라우저(docx 라이브러리, 지연 로딩)
 *  .xlsx / .ods / .csv / .tsv  브라우저 — 스프레드시트형 양식 전용(구글 시트 다운로드 메뉴와 같은 구성)
 *  스프레드시트형은 한글·워드 형식을 제공하지 않는다(표 문서에 맞지 않음). pdf·html 은 표를 HTML 로 바꿔 저장한다.
 */
import type { JSONContent } from '@tiptap/core'
import type { SpreadsheetDocument } from '$lib/types/contract-document'
import { downloadBlob } from './download'
import { toSafeFileName } from './fileName'
import { EXPORT_HTML_MAX_CHARS, flowDocToExportHtml, spreadsheetDocToExportHtml, wrapHtmlDocument } from './exportHtml'

export type ExportFormat = 'hwp' | 'hwpx' | 'docx' | 'pdf' | 'html' | 'xlsx' | 'ods' | 'csv' | 'tsv'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['hwp', 'hwpx', 'docx', 'pdf', 'html', 'xlsx', 'ods', 'csv', 'tsv']
export type ExportMode = 'flow' | 'html' | 'spreadsheet'

/** 작성 모드별로 저장할 수 있는 형식(메뉴에 보이는 순서). 스프레드시트형은 구글 시트 다운로드 메뉴와 같은 구성 */
export const FORMATS_BY_MODE: Record<ExportMode, readonly ExportFormat[]> = {
  flow: ['hwp', 'hwpx', 'docx', 'pdf', 'html'],
  html: ['hwp', 'hwpx', 'docx', 'pdf', 'html'],
  spreadsheet: ['xlsx', 'ods', 'pdf', 'html', 'csv', 'tsv'],
}

export interface ExportInput {
  /** 작성 모드 — flow(문서형)·html(HTML형)·spreadsheet(스프레드시트형) */
  mode: ExportMode
  title: string
  /** flow 모드: 편집기의 현재 문서(TipTap JSON) */
  flowDoc?: JSONContent | null
  /** html 모드: 고정 서식 HTML(스타일 포함) */
  htmlDocument?: string
  /** spreadsheet 모드: 편집기의 현재 스프레드시트 문서 */
  spreadsheetDoc?: SpreadsheetDocument | null
}

export interface ExportOutcome {
  fileName: string
  /** 사용자에게 알릴 주의(내용 손실 등). 비어 있으면 알릴 것 없음 */
  warnings: string[]
}

const MIME: Record<ExportFormat, string> = {
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  html: 'text/html;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
}

/** 입력에서 "본문 HTML"(flow는 변수 풀이된 조각, html은 스타일 포함 원문)을 얻는다. 비어 있으면 오류. */
function sourceHtml(input: ExportInput): string {
  if (input.mode === 'flow') {
    if (!input.flowDoc) throw new Error('저장할 내용이 없습니다. 문서를 먼저 작성해 주세요.')
    const html = flowDocToExportHtml(input.flowDoc)
    if (!html.replace(/<[^>]+>/g, '').trim() && !/<img\b/i.test(html)) throw new Error('저장할 내용이 비어 있습니다.')
    return html
  }
  if (!input.htmlDocument || !input.htmlDocument.trim()) throw new Error('저장할 내용이 없습니다.')
  return input.htmlDocument
}

async function exportPdf(fullHtml: string): Promise<Blob> {
  if (fullHtml.length > EXPORT_HTML_MAX_CHARS) throw new Error('문서가 너무 커서 PDF로 저장할 수 없어요. 이미지를 줄여 주세요.')
  const res = await fetch('/api/cms/contract-templates/export-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: fullHtml }),
  })
  if (!res.ok) {
    let message = 'PDF로 저장하지 못했습니다.'
    try { message = ((await res.json()) as { error?: string }).error ?? message } catch { /* 본문이 JSON이 아니면 기본 문구 */ }
    throw new Error(message)
  }
  return res.blob()
}

export async function exportContractFile(format: ExportFormat, input: ExportInput): Promise<ExportOutcome> {
  const fileName = toSafeFileName(input.title, format)
  if (!FORMATS_BY_MODE[input.mode].includes(format)) {
    throw new Error('이 형식으로는 저장할 수 없어요.')
  }
  if (format === 'xlsx') {
    if (!input.spreadsheetDoc) throw new Error('저장할 내용이 없습니다. 문서를 먼저 작성해 주세요.')
    const { spreadsheetToXlsxBlob } = await import('./xlsxFromSpreadsheet')
    const built = await spreadsheetToXlsxBlob(input.spreadsheetDoc, input.title)
    downloadBlob(built.blob, fileName)
    return { fileName, warnings: built.warnings }
  }
  if (input.mode === 'spreadsheet') {
    // 표 → HTML로 바꿔 HTML형 양식과 같은 경로(한글·워드·PDF·웹 문서)로 저장한다
    if (!input.spreadsheetDoc) throw new Error('저장할 내용이 없습니다. 문서를 먼저 작성해 주세요.')
    const built = spreadsheetDocToExportHtml(input.spreadsheetDoc)
    if (built.isEmpty) throw new Error('저장할 내용이 비어 있습니다.')
    if (format === 'ods' || format === 'csv' || format === 'tsv') {
      const files = await import('./sheetFilesFromSpreadsheet')
      const made = format === 'ods'
        ? await files.spreadsheetToOdsBlob(input.spreadsheetDoc)
        : files.spreadsheetToDelimitedBlob(input.spreadsheetDoc, format === 'csv' ? ',' : '\t')
      downloadBlob(made.blob, fileName)
      return { fileName, warnings: made.warnings }
    }
    const outcome = await exportContractFile(format, { mode: 'html', title: input.title, htmlDocument: built.html })
    if (built.droppedImages) outcome.warnings.push('서명·직인 이미지는 이 형식에 들어가지 않아요. 글자만 저장됩니다.')
    return outcome
  }
  const html = sourceHtml(input)
  const fullHtml = wrapHtmlDocument({ title: input.title, bodyHtml: html })
  const warnings: string[] = []
  let blob: Blob

  if (format === 'html') {
    blob = new Blob([fullHtml], { type: MIME.html })
  } else if (format === 'pdf') {
    blob = await exportPdf(fullHtml)
  } else if (format === 'docx') {
    const { htmlToDocxBlob } = await import('./docxFromHtml')
    blob = await htmlToDocxBlob(fullHtml, input.title)
  } else if (format === 'hwp' || format === 'hwpx') {
    // 한글 문서: HTML형은 서식(클래스 CSS)을 요소에 풀어 넣은 뒤 엔진에 넣는다
    const [{ loadRhwp }, { htmlToHwp }] = await Promise.all([import('$lib/utils/docImport/rhwpLoader'), import('./hwpFromHtml')])
    const forEngine = input.mode === 'html' ? await (await import('./inlineStyles')).inlineStylesViaIframe(fullHtml) : html
    const rh = await loadRhwp()
    const result = htmlToHwp(rh, forEngine, format)
    if (result.lossCount > 0) warnings.push('일부 서식은 한글 형식으로 바꾸는 과정에서 달라질 수 있어요. 저장한 파일을 열어 확인해 주세요.')
    blob = new Blob([result.bytes as BlobPart], { type: MIME[format] })
  } else {
    throw new Error('이 형식으로는 저장할 수 없어요.')
  }

  downloadBlob(blob, fileName)
  return { fileName, warnings }
}
