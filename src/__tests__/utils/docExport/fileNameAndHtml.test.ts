// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { toSafeFileName } from '$lib/utils/docExport/fileName'
import { wrapHtmlDocument } from '$lib/utils/docExport/exportHtml'

describe('toSafeFileName — 내려받을 파일 이름', () => {
  it('운영체제가 거절하는 글자와 제어 문자를 뺀다', () => {
    expect(toSafeFileName('렌탈/계약:서*양식?"<>|', 'hwp')).toBe('렌탈 계약 서 양식.hwp')
    expect(toSafeFileName('a\u0000b\nc', 'pdf')).toBe('a b c.pdf')
  })
  it('빈 제목·공백·점뿐인 제목은 기본 이름으로 대체한다', () => {
    expect(toSafeFileName('', 'docx')).toBe('계약서 양식.docx')
    expect(toSafeFileName('   ', 'docx')).toBe('계약서 양식.docx')
    expect(toSafeFileName('...', 'html')).toBe('계약서 양식.html')
    expect(toSafeFileName(null, 'hwpx')).toBe('계약서 양식.hwpx')
  })
  it('80글자(코드 포인트 기준)로 자른다', () => {
    const name = toSafeFileName('가'.repeat(200), 'pdf')
    expect([...name.replace(/\.pdf$/, '')]).toHaveLength(80)
  })
  it('확장자는 영문·숫자만 남긴다', () => {
    expect(toSafeFileName('양식', '../x')).toBe('양식.x')
  })
})

describe('wrapHtmlDocument — 독립 HTML 문서', () => {
  it('문자셋·제목을 넣고 제목의 특수문자를 이스케이프한다', () => {
    const out = wrapHtmlDocument({ title: '<b>"양식"</b>', bodyHtml: '<p>본문</p>' })
    expect(out).toContain('<meta charset="utf-8">')
    expect(out).toContain('<title>&lt;b&gt;&quot;양식&quot;&lt;/b&gt;</title>')
    expect(out).toContain('<p>본문</p>')
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true)
  })
})
