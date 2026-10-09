/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stampIssueDateInHtml } from '$lib/utils/contractIssueDate'
import { substituteHtmlDocument } from '$lib/utils/contract-substitution'
import { DEFAULT_RENTAL_CONTRACT_HTML } from '$lib/components/cms/contract-editor/templates/defaultRentalContractHtml'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8')

describe('stampIssueDateInHtml — 발행일을 발송 순간 날짜로', () => {
  const doc = (d: string): string => `<h1>계약서</h1><div class="issue-date-row"><p class="issue-date">(계약서 발행일시: ${d})</p><!--DOCUMENT_QR--></div><p>본문 2026.01.01 발행</p>`

  it('발행일 문단의 날짜만 바꾼다(본문의 다른 날짜는 그대로)', () => {
    const out = stampIssueDateInHtml(doc('2026.10.08'), '2026.10.09')
    expect(out).toContain('(계약서 발행일시: 2026.10.09)')
    expect(out).toContain('본문 2026.01.01 발행')
    expect(out).toContain('<!--DOCUMENT_QR-->')
  })

  it("치환 실패로 '-'가 들어 있던 경우도 날짜로 채운다", () => {
    expect(stampIssueDateInHtml(doc('-'), '2026.10.09')).toContain('발행일시: 2026.10.09)')
  })

  it('이미 같은 날짜면 문서가 그대로(변경 없음 → 불필요한 저장 없음)', () => {
    const d = doc('2026.10.09')
    expect(stampIssueDateInHtml(d, '2026.10.09')).toBe(d)
  })

  it('class에 다른 클래스가 섞여도 동작하고, 발행일 문단이 없으면 아무것도 바꾸지 않는다', () => {
    expect(stampIssueDateInHtml('<p class="a issue-date b">(계약서 발행일시: 2026.10.01)</p>', '2026.10.09')).toContain('2026.10.09')
    const none = '<p>(계약서 발행일시: 2026.10.01)</p>'
    expect(stampIssueDateInHtml(none, '2026.10.09')).toBe(none)
    expect(stampIssueDateInHtml('', '2026.10.09')).toBe('')
  })

  it("날짜 값이 '-'(변환 실패)면 건드리지 않는다", () => {
    const d = doc('2026.10.08')
    expect(stampIssueDateInHtml(d, '-')).toBe(d)
  })
})

describe('실제 기본 양식과 호환', () => {
  it('기본 양식을 변수 치환한 결과(발행일 2026.10.08)도 발송 순간 날짜로 정확히 바뀐다', () => {
    const substituted = substituteHtmlDocument(DEFAULT_RENTAL_CONTRACT_HTML, { 계약서발행일: '2026.10.08' } as never)
    expect(substituted).toContain('(계약서 발행일시: 2026.10.08)')
    const stamped = stampIssueDateInHtml(substituted, '2026.10.09')
    expect(stamped).toContain('(계약서 발행일시: 2026.10.09)')
    expect(stamped).not.toContain('(계약서 발행일시: 2026.10.08)')
    // 발행일 문단 외 나머지 문서는 한 글자도 바뀌지 않는다
    expect(stamped.replace('2026.10.09', '2026.10.08')).toBe(substituted)
  })
})

describe('연결 지점', () => {
  it('send-chat은 발송 순간 한국시간 날짜로 발행일을 다시 기록하고 QR 되굽기와 한 번에 저장한다', () => {
    const src = read('src/routes/api/cms/contracts/[id]/send-chat/+server.ts')
    expect(src).toContain("import { stampIssueDateInHtml } from '$lib/utils/contractIssueDate'")
    expect(src).toContain('stampIssueDateInHtml(contract.html_document, formatKstDateDot(new Date()))')
    // 서명 완료건 재발송 차단이 발행일 기록보다 앞에 있다(서명본은 바뀌지 않는다)
    expect(src.indexOf('이미 서명이 완료된 계약서는 재발송할 수 없습니다.')).toBeLessThan(src.indexOf('stampIssueDateInHtml(contract.html_document'))
  })

  it('발행(적용) 모달은 적용 순간의 날짜로 모든 양식(블록·스프레드시트·html)을 치환한다', () => {
    const src = read('src/lib/components/cms/ContractTemplatePreviewModal.svelte')
    expect(src).toContain('계약서발행일: formatKstDateDot(new Date())')
    const apply = src.slice(src.indexOf('async function applySelectedTemplate'), src.indexOf('const result = await applyContractTemplate({'))
    expect(apply).toContain('issueSubData')
    expect(apply).not.toMatch(/substitute\w+\([^)]*\bsubData\b/)
  })

  it('서명(signed) 이후 경로에는 발행일 기록이 없다(share-chat·sign은 html_document를 바꾸지 않음)', () => {
    expect(read('src/routes/api/cms/contracts/[id]/share-chat/+server.ts')).not.toContain('stampIssueDate')
    expect(read('src/routes/api/contracts/[token]/sign/+server.ts')).not.toContain('stampIssueDate')
  })
})
