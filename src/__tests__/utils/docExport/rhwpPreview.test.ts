// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import * as rhwp from '@rhwp/core'
import type { RhwpModule } from '$lib/utils/docImport/rhwpLoader'
import { isValidVariableName, openHwpPreview, suggestVariable } from '$lib/utils/docImport/rhwpPreview'
import { importHwp } from '$lib/utils/docImport/hwpxImport'

/**
 * 한글 가져오기 보조 — 원본 미리보기(쪽 그림)·누름틀 → 변수 연결. 누름틀이 있는 한글 문서는 엔진으로 직접 만들어 쓴다(외부 파일 불필요).
 */
const rh = rhwp as unknown as RhwpModule

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  g['measureTextWidth'] ??= (_font: string, text: string) => [...text].length * 8
  rhwp.initSync({ module: readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm') })
})

/** 문단 3개(회사명·작성자·회사명 다시)에 누름틀 3개(이름 중복 포함)를 넣은 HWP 파일을 만든다 */
function buildFormWithFields(): Uint8Array {
  const doc = rh.HwpDocument.createEmpty()
  try {
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, '회사: ')
    doc.splitParagraph(0, 0, 6)
    doc.insertText(0, 1, 0, '작성자: ')
    doc.splitParagraph(0, 1, 5)
    doc.insertText(0, 2, 0, '확인 회사: ')
    doc.insertClickHereField(0, 0, 4, '입력', '', '회사명', true)
    doc.insertClickHereField(0, 1, 5, '입력', '', '작성자', true)
    doc.insertClickHereField(0, 2, 7, '입력', '', '회사명', true)
    const out = doc.exportHwpWithReport()
    try { return out.takeBytes() } finally { out.free() }
  } finally {
    doc.free()
  }
}

describe('openHwpPreview — 쪽 수·그림·누름틀 목록', () => {
  it('쪽 수와 첫 쪽 그림(SVG)을 돌려준다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      expect(s.pageCount).toBeGreaterThanOrEqual(1)
      const svg = s.renderPageSvg(0)
      expect(svg.trimStart().startsWith('<svg')).toBe(true)
      expect(svg.length).toBeGreaterThan(500)
    } finally { s.close() }
  })

  it('누름틀을 이름별로 묶고 같은 이름의 필드 번호를 모두 모은다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      expect(s.fieldGroups.map((g) => g.name)).toEqual(['회사명', '작성자'])
      expect(s.fieldGroups[0].fieldIds).toHaveLength(2)
      expect(s.fieldGroups[1].fieldIds).toHaveLength(1)
    } finally { s.close() }
  })

  it('누름틀이 없는 문서는 목록이 비어 있다', () => {
    const doc = rh.HwpDocument.createEmpty()
    doc.createBlankDocument()
    const ex = doc.exportHwpWithReport(); const bytes = ex.takeBytes(); ex.free(); doc.free()
    const s = openHwpPreview(rh, bytes)
    try { expect(s.fieldGroups).toEqual([]) } finally { s.close() }
  })

  it('닫은 뒤에는 그림을 그릴 수 없다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    s.close()
    expect(() => s.renderPageSvg(0)).toThrow()
  })
})

describe('exportWithVariables — 누름틀 → {{변수}}', () => {
  it('같은 이름 누름틀 2곳과 다른 이름 1곳이 모두 변수로 채워져 본문 글에 나타난다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      const r = s.exportWithVariables({ 회사명: '고객이름', 작성자: '연락처' })
      expect(r.applied).toBe(3)
      expect(r.unreflected).toEqual([])
      const doc = new rh.HwpDocument(r.bytes)
      const text = String(JSON.parse(doc.getTextFileUnicode()))
      doc.free()
      expect((text.match(/\{\{고객이름\}\}/g) ?? []).length).toBe(2)
      expect(text).toContain('{{연락처}}')
    } finally { s.close() }
  })

  it('연결하지 않은 누름틀과 잘못된 변수 이름은 건드리지 않는다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      const r = s.exportWithVariables({ 회사명: '고객{이름}', 작성자: '' })
      expect(r.applied).toBe(0)
    } finally { s.close() }
  })

  it('연결을 바꿔 다시 만들면 이전 연결 값이 남지 않는다', () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      s.exportWithVariables({ 회사명: '고객이름' })
      const r = s.exportWithVariables({ 작성자: '이메일' })
      const doc = new rh.HwpDocument(r.bytes)
      const text = String(JSON.parse(doc.getTextFileUnicode()))
      doc.free()
      expect(text).toContain('{{이메일}}')
      expect(text).not.toContain('{{고객이름}}')
    } finally { s.close() }
  })

  it('채운 HWP 를 기존 가져오기 경로(hwp-convert)로 변환하면 변수가 HTML 본문에 들어 있다', async () => {
    const s = openHwpPreview(rh, buildFormWithFields())
    try {
      const { bytes } = s.exportWithVariables({ 회사명: '고객이름', 작성자: '연락처' })
      const { html } = await importHwp(new File([bytes as BlobPart], 'form.hwp'))
      expect(html).toContain('{{고객이름}}')
      expect(html).toContain('{{연락처}}')
    } finally { s.close() }
  })
})

describe('suggestVariable / isValidVariableName', () => {
  const vars = ['고객이름', '연락처', '이메일', '주소', '상품명', '예약코드']
  it('같은 이름·비슷한 이름이면 변수를 제안한다', () => {
    expect(suggestVariable('고객이름', vars)).toBe('고객이름')
    expect(suggestVariable('성명', vars)).toBe('고객이름')
    expect(suggestVariable('전화 번호', vars)).toBe('연락처')
    expect(suggestVariable('E-mail', vars)).toBe('이메일')
    expect(suggestVariable('비고', vars)).toBeNull() // 사전에 없는 이름은 제안하지 않는다(틀린 제안보다 무제안)
  })
  it('카탈로그에 없는 변수는 제안하지 않는다', () => {
    expect(suggestVariable('성명', ['연락처'])).toBeNull()
    expect(suggestVariable('', vars)).toBeNull()
  })
  it('변수 이름은 중괄호·줄바꿈·앞뒤 공백을 허용하지 않는다', () => {
    expect(isValidVariableName('고객이름')).toBe(true)
    expect(isValidVariableName('총 정상 대여가')).toBe(true)
    expect(isValidVariableName('a{b')).toBe(false)
    expect(isValidVariableName('a\nb')).toBe(false)
    expect(isValidVariableName(' a')).toBe(false)
    expect(isValidVariableName('')).toBe(false)
  })
})
