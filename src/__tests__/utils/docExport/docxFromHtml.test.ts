// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { htmlToDocxBytes } from '$lib/utils/docExport/docxFromHtml'
import { wrapHtmlDocument } from '$lib/utils/docExport/exportHtml'
import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'

/**
 * HTML → Word(.docx) — docx 9.15.0 의 docx/html. 기준 입력은 실제 기본 계약서 HTML(<style> 클래스 CSS 포함).
 * 2026-10-29 시험 기준선: 표 10/10, 변수 27/27, 클래스 CSS가 풀려 배경·테두리·정렬·굵게가 담김.
 */
const VARS = [...new Set(DEFAULT_RENTAL_CONTRACT_HTML.match(/\{\{[^}]+\}\}/g) ?? [])]

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  return zip.file('word/document.xml')!.async('string')
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('htmlToDocxBytes — 실제 기본 계약서 HTML', () => {
  it('표 10개·변수 27개가 Word 문서에 그대로 들어가고 Word 형식으로 다시 읽힌다', async () => {
    const bytes = await htmlToDocxBytes(wrapHtmlDocument({ title: '렌탈 계약서', bodyHtml: DEFAULT_RENTAL_CONTRACT_HTML }), '렌탈 계약서')
    expect(bytes.length).toBeGreaterThan(2000)
    const xml = await documentXml(bytes)
    expect(count(xml, /<w:tbl>/g)).toBe(10)

    const { value: text, messages } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    expect(VARS.filter((v) => !text.includes(v))).toEqual([])
    expect(messages).toEqual([])
  })

  it('클래스 CSS(<style>)가 풀려 배경·테두리·정렬·굵게가 담긴다(서식 없는 입력보다 풍부)', async () => {
    const withCss = await documentXml(await htmlToDocxBytes(wrapHtmlDocument({ title: 't', bodyHtml: DEFAULT_RENTAL_CONTRACT_HTML }), 't'))
    const noCss = await documentXml(await htmlToDocxBytes(wrapHtmlDocument({ title: 't', bodyHtml: DEFAULT_RENTAL_CONTRACT_HTML.replace(/<style[\s\S]*?<\/style>/gi, '') }), 't'))
    expect(count(withCss, /<w:shd /g)).toBeGreaterThan(count(noCss, /<w:shd /g))
    expect(count(withCss, /<w:tcBorders>/g)).toBeGreaterThan(0)
    expect(count(withCss, /<w:jc /g)).toBeGreaterThan(count(noCss, /<w:jc /g))
  })

  it('편집기형 HTML(표 칸 합침·번호 목록·이미지)을 담는다', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const html = `<h2 style="text-align:center">렌탈 계약서</h2><p>임차인 <strong>{{고객이름}}</strong></p>
      <table><tbody><tr><td style="background-color:#eeeeee">상품명</td><td>{{상품명}}</td></tr><tr><td colspan="2">비고</td></tr></tbody></table>
      <ol><li>제1조</li><li>제2조</li></ol><p><img src="${png}" width="40" height="40"></p>`
    const xml = await documentXml(await htmlToDocxBytes(wrapHtmlDocument({ title: 't', bodyHtml: html }), 't'))
    expect(count(xml, /<w:tbl>/g)).toBe(1)
    expect(count(xml, /<w:gridSpan/g)).toBe(1)
    expect(count(xml, /<w:numPr>/g)).toBe(2)
    expect(count(xml, /<w:drawing>/g)).toBe(1)
  })
})
