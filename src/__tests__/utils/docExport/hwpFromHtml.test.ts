// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import * as rhwp from '@rhwp/core'
import type { RhwpModule } from '$lib/utils/docImport/rhwpLoader'
import { htmlToHwp, prepareHtmlForHwp } from '$lib/utils/docExport/hwpFromHtml'
import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'

/**
 * HTML → 한글 파일(.hwp/.hwpx) — 실제 엔진(@rhwp/core WASM)으로 돌린다. 기준 입력은 이 프로젝트의 실제 기본 계약서 HTML.
 * 2026-10-29 실험 기준선: 표 10/10 · 변수 27/27 보존, 두 형식 모두 다시 열림, 내용 손실 보고 0건.
 */
const rh = rhwp as unknown as RhwpModule
const VARS = [...new Set(DEFAULT_RENTAL_CONTRACT_HTML.match(/\{\{[^}]+\}\}/g) ?? [])]

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  g['measureTextWidth'] ??= (_font: string, text: string) => [...text].length * 8
  rhwp.initSync({ module: readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm') })
})

function reopenText(bytes: Uint8Array): string {
  const doc = new rh.HwpDocument(bytes)
  try { return String(JSON.parse(doc.getTextFileUnicode())) } finally { doc.free() }
}

describe('prepareHtmlForHwp — 엔진에 넣기 전 정리', () => {
  it('<style>·<script>·주석·<head>를 지우고 <body> 안쪽만 남긴다', () => {
    const out = prepareHtmlForHwp('<html><head><title>t</title><style>p{color:red}</style></head><body><!--c--><p>본문</p><script>alert(1)</script></body></html>')
    expect(out).toBe('<p>본문</p>')
  })
  it('번호 목록(<ol>)을 "n. 내용" 문단으로 풀어 번호가 글머리표로 바뀌지 않게 한다', () => {
    const out = prepareHtmlForHwp('<ol><li><p>가</p></li><li>나</li></ol><ul><li>점</li></ul>')
    expect(out).not.toMatch(/<ol/i)
    expect(out).toContain('<p>1. 가</p>')
    expect(out).toContain('<p>2. 나</p>')
    expect(out).toContain('<ul>')
  })
  it('start 속성이 있으면 그 번호부터 시작한다', () => {
    expect(prepareHtmlForHwp('<ol start="3"><li>다</li></ol>')).toContain('<p>3. 다</p>')
  })
})

describe('htmlToHwp — 실제 기본 계약서 HTML', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    it(`.${format}: 변수 ${VARS.length}/${VARS.length} 보존, 다시 열림, 손실 보고 0건`, () => {
      const r = htmlToHwp(rh, DEFAULT_RENTAL_CONTRACT_HTML, format)
      expect(r.bytes.length).toBeGreaterThan(1000)
      expect(r.format).toBe(format)
      expect(r.lossCount).toBe(0)
      const text = reopenText(r.bytes)
      const missing = VARS.filter((v) => !text.includes(v))
      expect(missing).toEqual([])
    })
  }

  it('.hwpx를 기존 변환기(hwp-convert)로 다시 읽으면 표 10개·변수 27개가 그대로다', async () => {
    const r = htmlToHwp(rh, DEFAULT_RENTAL_CONTRACT_HTML, 'hwpx')
    const hc = await import('hwp-convert')
    const reader = new hc.HwpxReader()
    await reader.loadFromArrayBuffer(r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) as ArrayBuffer)
    const html = await reader.extractHtml({ embedImages: true })
    const inputTables = (prepareHtmlForHwp(DEFAULT_RENTAL_CONTRACT_HTML).match(/<table/gi) ?? []).length
    expect(inputTables).toBe(10)
    expect((html.match(/<table/g) ?? []).length).toBe(inputTables)
    expect(VARS.filter((v) => !html.includes(v))).toEqual([])
  })

  it('이미지(data URL)가 들어 있어도 내보내기가 실패하지 않는다', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const r = htmlToHwp(rh, `<p>서명 <img src="${png}" width="40" height="40"></p>`, 'hwp')
    expect(r.bytes.length).toBeGreaterThan(1000)
  })

  it('내용이 비어 있으면 오류를 던진다', () => {
    expect(() => htmlToHwp(rh, '<style>p{}</style>', 'hwp')).toThrow('비어 있습니다')
  })
})
