// @vitest-environment node
/**
 * contractHtmlSubstitution.test.ts — HTML형 계약서 변수 치환 TDD
 *
 * 보안 경계: substituteHtmlDocument()는 사용자 입력(고객 이름, 주소 등)을
 * HTML 문자열 안에 삽입하므로 escapeHtml() 처리가 XSS 방어의 유일한 서버측 장벽이다.
 * 이 파일의 테스트가 항상 GREEN인 상태에서만 html_document를 DB에 저장·발송·렌더링할 수 있다.
 *
 * 테스트 범위:
 *   HT-1  스칼라 필드 1:1 치환
 *   HT-2  <!--REPEAT:상품목록-->...<!--/REPEAT--> 반복 영역 확장 (N=0 / N=1 / N=5)
 *   HT-3  {{NO}} 1-based 자동 번호 매김
 *   HT-4  XSS 방어 — <script> 인젝션 차단 (보안 경계)
 *   HT-5  ContractLineItem 필드 우선 → ContractSubstitutionData 스칼라 폴백
 *   HT-6  치환 불가 변수는 빈 문자열로 대체({{변수명}} 원문 제거)
 *   HT-7  기존 spreadsheetRender 테스트 무회귀 확인(escapeHtml export 변경)
 */

import { describe, it, expect } from 'vitest'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module.js'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const baseData: ContractSubstitutionData = {
  고객이름: '김철수',
  연락처: '010-1234-5678',
  이메일: 'kim@example.com',
  주소: '서울시 강남구 테헤란로 1',
  예약코드: 'RSV-2026-001',
  수령일시: '2026-09-10 10:00',
  반납일시: '2026-09-12 18:00',
  수령형태: '방문수령',
  반납형태: '방문반납',
  기본대여요금: '100,000원',
  할인차감: '10,000원',
  차감포인트: '5,000원',
  배송비: '0원',
  최종합계: '85,000원',
  요금유형: '24시간(1일)',
  할인금액: '0원',
  부가세: '0원',
}

const sampleItems: ContractLineItem[] = [
  { 상품명: 'Sony FX3', 상품코드: 'CSCRD01', 수량: '1', 금액: '60,000원' },
  { 상품명: 'FE 24-70mm F2.8', 상품코드: 'CSLEN01', 수량: '1', 금액: '25,000원' },
  { 상품명: '배터리 (옵션)', 수량: '2', 금액: '6,000원' },
]

// 최소 반복 영역을 포함하는 HTML 스텁
function makeRepeatHtml(innerTemplate: string): string {
  return `<table><thead><tr><th>NO.</th><th>품목</th><th>수량</th><th>금액</th></tr></thead><tbody><!--REPEAT:상품목록-->${innerTemplate}<!--/REPEAT--></tbody></table>`
}

const rowTemplate = `<tr><td>{{NO.}}</td><td>{{상품명}}</td><td>{{수량}}</td><td>{{금액}}</td></tr>`

// ─────────────────────────────────────────────────────────────────────────────

describe('substituteHtmlDocument', () => {
  // ── HT-1: 스칼라 필드 1:1 치환 ───────────────────────────────────────────

  it('[HT-1] 스칼라 변수 {{고객이름}} 을 정상 치환한다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = '<p>임차인: {{고객이름}}</p>'
    const result = substituteHtmlDocument(html, baseData)
    expect(result).toContain('임차인: 김철수')
    expect(result).not.toContain('{{고객이름}}')
  })

  it('[HT-1] 여러 스칼라 변수를 한 번에 치환한다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = '<p>{{고객이름}} / {{연락처}} / {{이메일}}</p><p>{{주소}}</p>'
    const result = substituteHtmlDocument(html, baseData)
    expect(result).toContain('김철수')
    expect(result).toContain('010-1234-5678')
    expect(result).toContain('kim@example.com')
    expect(result).toContain('서울시 강남구 테헤란로 1')
    expect(result).not.toMatch(/\{\{[^}]+\}\}/) // 치환 잔여 없음
  })

  // ── HT-2: 반복 영역 확장 ─────────────────────────────────────────────────

  it('[HT-2a] 상품목록 N=0 이면 반복 영역이 빈 상태로 렌더링된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = makeRepeatHtml(rowTemplate)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: [] })
    // REPEAT 마커는 제거되어야 함
    expect(result).not.toContain('<!--REPEAT:상품목록-->')
    expect(result).not.toContain('<!--/REPEAT-->')
    // 항목 행 없어야 함
    expect(result).not.toContain('<td>')
  })

  it('[HT-2b] 상품목록 N=1 이면 행 1개가 정확히 렌더링된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    // {{상품코드}}도 포함한 템플릿으로 테스트 (HT-5와 다른 맥락 — N=1 확장 검증)
    const rowWithCode = `<tr><td>{{NO.}}</td><td>{{상품명}}</td><td>{{상품코드}}</td><td>{{수량}}</td><td>{{금액}}</td></tr>`
    const html = makeRepeatHtml(rowWithCode)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: [sampleItems[0]] })
    expect(result).not.toContain('<!--REPEAT:상품목록-->')
    // 항목 1개
    const trMatches = result.match(/<tr>/g)
    expect(trMatches).not.toBeNull()
    // 헤더 tr + 데이터 tr 1개 = 최소 2개
    expect((trMatches?.length ?? 0)).toBeGreaterThanOrEqual(2)
    expect(result).toContain('Sony FX3')
    expect(result).toContain('CSCRD01')
  })

  it('[HT-2c] 상품목록 N=5 이면 행 5개가 정확히 렌더링된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const fiveItems = [
      { 상품명: '상품A', 수량: '1', 금액: '10,000원' },
      { 상품명: '상품B', 수량: '1', 금액: '20,000원' },
      { 상품명: '상품C', 수량: '1', 금액: '30,000원' },
      { 상품명: '상품D', 수량: '1', 금액: '40,000원' },
      { 상품명: '상품E', 수량: '1', 금액: '50,000원' },
    ]
    const html = makeRepeatHtml(rowTemplate)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: fiveItems })
    // 각 상품명이 결과에 포함돼야 함
    for (const item of fiveItems) {
      expect(result).toContain(item.상품명)
    }
    expect(result).not.toContain('<!--REPEAT:상품목록-->')
  })

  // ── HT-3: {{NO.}} 1-based 자동 번호 매김 ────────────────────────────────

  it('[HT-3] {{NO.}} 가 1부터 시작하는 일련번호로 치환된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = makeRepeatHtml(`<tr><td>{{NO.}}</td><td>{{상품명}}</td></tr>`)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: sampleItems })
    // 1, 2, 3 순서로 등장해야 함
    const noMatches = result.match(/<td>\d+<\/td>/g)
    expect(noMatches).not.toBeNull()
    expect(noMatches?.[0]).toBe('<td>1</td>')
    expect(noMatches?.[1]).toBe('<td>2</td>')
    expect(noMatches?.[2]).toBe('<td>3</td>')
  })

  // ── HT-4: XSS 방어 (보안 경계) ──────────────────────────────────────────

  it('[HT-4] 고객이름에 <script> 태그가 포함된 경우 이스케이프된다 (XSS 차단)', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const maliciousData: ContractSubstitutionData = {
      ...baseData,
      고객이름: '<script>alert("XSS")</script>',
    }
    const html = '<p>임차인: {{고객이름}}</p>'
    const result = substituteHtmlDocument(html, maliciousData)
    // 원본 <script> 태그가 그대로 삽입되면 안 됨
    expect(result).not.toContain('<script>')
    // 이스케이프된 형태로 저장돼야 함
    expect(result).toContain('&lt;script&gt;')
    expect(result).toContain('&lt;/script&gt;')
  })

  it('[HT-4] 주소에 HTML 특수문자가 포함된 경우 이스케이프된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const dataWithSpecialChars: ContractSubstitutionData = {
      ...baseData,
      주소: '서울 강남구 <도산대로> 100 & 101',
    }
    const html = '<p>주소: {{주소}}</p>'
    const result = substituteHtmlDocument(html, dataWithSpecialChars)
    expect(result).not.toContain('<도산대로>')
    expect(result).toContain('&lt;도산대로&gt;')
    expect(result).toContain('&amp;')
  })

  it('[HT-4] 반복 영역 안 상품명에 XSS 시도가 있어도 이스케이프된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const maliciousItems: ContractLineItem[] = [
      { 상품명: '<img src=x onerror=alert(1)>', 수량: '1', 금액: '0원' },
    ]
    const html = makeRepeatHtml(`<tr><td>{{상품명}}</td></tr>`)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: maliciousItems })
    expect(result).not.toContain('<img src=x')
    expect(result).toContain('&lt;img')
  })

  // ── HT-5: ContractLineItem 필드 우선순위 → 스칼라 폴백 ──────────────────

  it('[HT-5] 반복 행 안 {{상품코드}} 는 ContractLineItem.상품코드가 있으면 그것을 사용한다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = makeRepeatHtml(`<tr><td>{{상품코드}}</td><td>{{상품명}}</td></tr>`)
    const result = substituteHtmlDocument(html, { ...baseData, 상품목록: [sampleItems[0]] })
    expect(result).toContain('CSCRD01') // ContractLineItem.상품코드 사용
  })

  it('[HT-5] 반복 행 안 {{상품코드}} 는 ContractLineItem에 없으면 baseData 스칼라로 폴백한다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const itemWithoutCode: ContractLineItem = { 상품명: '배터리', 수량: '2', 금액: '6,000원' }
    const dataWithCode: ContractSubstitutionData = { ...baseData, 상품코드: 'FALLBACK-CODE', 상품목록: [itemWithoutCode] }
    const html = makeRepeatHtml(`<tr><td>{{상품코드}}</td></tr>`)
    const result = substituteHtmlDocument(html, dataWithCode)
    expect(result).toContain('FALLBACK-CODE')
  })

  // ── HT-6: 치환 불가 변수 처리 ───────────────────────────────────────────

  it('[HT-6] 치환 데이터에 없는 변수 {{알수없음}} 은 빈 문자열로 대체된다', async () => {
    const { substituteHtmlDocument } = await import('$lib/utils/contract-substitution.js')
    const html = '<p>{{알수없음}}</p>'
    const result = substituteHtmlDocument(html, baseData)
    expect(result).not.toContain('{{알수없음}}')
    expect(result).toContain('<p></p>')
  })

  // ── HT-7: escapeHtml export 무회귀 ──────────────────────────────────────

  it('[HT-7] spreadsheetRender.escapeHtml 이 여전히 import 가능하다 (export 변경 무회귀)', async () => {
    const { escapeHtml } = await import('$lib/utils/spreadsheetRender.js')
    expect(typeof escapeHtml).toBe('function')
    expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;')
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applySpecialNotesMarker — 정산내역 "특이사항" 마커 (2026-09-07 신설, "특약 조항" 재사용)
// ─────────────────────────────────────────────────────────────────────────────
describe('applySpecialNotesMarker', () => {
  it('특약 조항이 1개면 "key: value" 형태로 마커를 대체한다', async () => {
    const { applySpecialNotesMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<td><!--SPECIAL_NOTES--></td>'
    const result = applySpecialNotesMarker(html, [{ key: '비고', value: '파손 없음' }])
    expect(result).toBe('<td>비고: 파손 없음</td>')
  })

  it('특약 조항이 여러 개면 <br/>로 이어붙인다', async () => {
    const { applySpecialNotesMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<!--SPECIAL_NOTES-->'
    const result = applySpecialNotesMarker(html, [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ])
    expect(result).toBe('A: 1<br/>B: 2')
  })

  it('키가 빈 문자열인 항목은 제외한다', async () => {
    const { applySpecialNotesMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<!--SPECIAL_NOTES-->'
    const result = applySpecialNotesMarker(html, [
      { key: '', value: '무시됨' },
      { key: '유효', value: '값' },
    ])
    expect(result).toBe('유효: 값')
  })

  it('빈 배열/null/undefined면 &nbsp;로 대체(기존 하드코딩 빈칸과 시각적으로 동일)', async () => {
    const { applySpecialNotesMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<!--SPECIAL_NOTES-->'
    expect(applySpecialNotesMarker(html, [])).toBe('&nbsp;')
    expect(applySpecialNotesMarker(html, null)).toBe('&nbsp;')
    expect(applySpecialNotesMarker(html, undefined)).toBe('&nbsp;')
  })

  it('key/value 모두 XSS 이스케이프 처리된다', async () => {
    const { applySpecialNotesMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<!--SPECIAL_NOTES-->'
    const result = applySpecialNotesMarker(html, [{ key: '<b>k</b>', value: '<script>alert(1)</script>' }])
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyIssuerSignatureMarker — 발행자 서명·직인 마커 (2026-09-07 회귀 커버리지 보강)
// ─────────────────────────────────────────────────────────────────────────────
describe('applyIssuerSignatureMarker', () => {
  it('URL 미지정 시 마커를 빈 문자열로 제거한다', async () => {
    const { applyIssuerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    expect(applyIssuerSignatureMarker('<td><!--ISSUER_SIGNATURE--></td>', null)).toBe('<td></td>')
  })

  it('http(s) URL이면 <img> 태그로 치환하고 기본 너비 90px을 적용한다', async () => {
    const { applyIssuerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const result = applyIssuerSignatureMarker('<!--ISSUER_SIGNATURE-->', 'https://example.com/seal.png')
    expect(result).toContain('<img')
    expect(result).toContain('width:90px')
  })

  it('javascript: 스킴은 차단되어 마커가 제거된다 (XSS 방어)', async () => {
    const { applyIssuerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const result = applyIssuerSignatureMarker('<!--ISSUER_SIGNATURE-->', 'javascript:alert(1)')
    expect(result).not.toContain('<img')
  })

  it('width는 20~1200 범위로 클램프된다', async () => {
    const { applyIssuerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const tooSmall = applyIssuerSignatureMarker('<!--ISSUER_SIGNATURE-->', 'https://example.com/seal.png', 5)
    const tooBig = applyIssuerSignatureMarker('<!--ISSUER_SIGNATURE-->', 'https://example.com/seal.png', 5000)
    expect(tooSmall).toContain('width:20px')
    expect(tooBig).toContain('width:1200px')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyCustomerSignatureMarker — 고객(예약자) 서명 마커 (2026-09-08 신설)
// ─────────────────────────────────────────────────────────────────────────────
describe('applyCustomerSignatureMarker', () => {
  it('서명 데이터 미지정 시 마커를 빈 문자열로 제거한다', async () => {
    const { applyCustomerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    expect(applyCustomerSignatureMarker('<td><!--CUSTOMER_SIGNATURE--></td>', null)).toBe('<td></td>')
  })

  it('유효한 data:image/png base64 문자열이면 <img> 태그로 치환한다', async () => {
    const { applyCustomerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const result = applyCustomerSignatureMarker('<!--CUSTOMER_SIGNATURE-->', dataUrl)
    expect(result).toContain('<img')
    expect(result).toContain('customer-sig-overlay')
    expect(result).toContain(dataUrl)
  })

  it('data URI 접두사가 아니면(http URL 등) 차단되어 마커가 제거된다', async () => {
    const { applyCustomerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const result = applyCustomerSignatureMarker('<!--CUSTOMER_SIGNATURE-->', 'https://example.com/x.png')
    expect(result).not.toContain('<img')
  })

  it('접두사만 맞고 콤마 뒤에 임의 문자열이 섞여 있으면(속성 인젝션 시도) 차단된다', async () => {
    const { applyCustomerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const malicious = 'data:image/png;base64,AAAA" onerror="alert(1)'
    const result = applyCustomerSignatureMarker('<!--CUSTOMER_SIGNATURE-->', malicious)
    expect(result).not.toContain('<img')
    expect(result).not.toContain('onerror')
  })

  it('마커가 없는 원문은 그대로 반환한다(레거시 계약 무영향)', async () => {
    const { applyCustomerSignatureMarker } = await import('$lib/utils/contract-substitution.js')
    const html = '<td>(인)이기성</td>'
    expect(applyCustomerSignatureMarker(html, 'data:image/png;base64,AAAA')).toBe(html)
  })
})
