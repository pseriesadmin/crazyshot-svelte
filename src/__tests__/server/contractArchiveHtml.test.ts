import { describe, it, expect } from 'vitest'
import { buildArchiveHtml, type ArchiveEvidenceSummary, type ArchiveTerms } from '$lib/server/contractArchive/archiveHtml'

const CONTRACT_HTML = '<style>.contract-wrap{padding:40px}</style><div class="contract-wrap"><table><tr><td class="sig-host-cell">박상진 (인)<img src="data:image/png;base64,AAAA" alt="예약자 서명" class="customer-sig-overlay" /></td></tr></table></div>'

const EVIDENCE: ArchiveEvidenceSummary = {
  contractId: 'c-1',
  signingId: 's-1',
  reservationCode: 'CSRSV26100034',
  signedAtKst: '2026.10.02 18:43',
  ipAddress: '211.234.198.124',
  userAgent: 'Mozilla/5.0 (iPhone)',
  finalHtmlSha256: 'a'.repeat(64),
  termsSha256: 'b'.repeat(64),
  refundSha256: 'c'.repeat(64),
  privacySha256: 'd'.repeat(64),
  source: 'original',
  generatedAtKst: '2026.10.06 12:00',
}

const TERMS: ArchiveTerms = { terms: '서비스이용정책 원문', refund: '환불규정 원문', privacy: '개인정보처리방침 원문' }

describe('buildArchiveHtml', () => {
  it('계약서 본문(서명 합성 포함)을 변경 없이 그대로 포함한다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toContain(CONTRACT_HTML)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
  })

  it('A4 인쇄 설정과 한글 폰트 대체 목록을 갖는다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toContain('@page')
    expect(html).toContain('A4')
    expect(html).toMatch(/font-family:[^;]*Noto Sans KR/)
  })

  it('서명 증적 요약(계약 ID·예약코드·서명 일시·IP·UA·해시)을 부록으로 넣는다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toContain('서명 증적')
    expect(html).toContain('c-1')
    expect(html).toContain('CSRSV26100034')
    expect(html).toContain('2026.10.02 18:43')
    expect(html).toContain('211.234.198.124')
    expect(html).toContain('Mozilla/5.0 (iPhone)')
    expect(html).toContain('a'.repeat(64))
    expect(html).toContain('b'.repeat(64))
  })

  it('약관 3종 사본을 서명 시점 원문 그대로 부록으로 넣는다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toContain('서비스이용정책')
    expect(html).toContain('서비스이용정책 원문')
    expect(html).toContain('환불규정 원문')
    expect(html).toContain('개인정보처리방침 원문')
    expect(html).not.toContain('재생성본')
  })

  it('부록은 새 페이지에서 시작한다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toContain('page-break-before')
  })

  it('재생성본이면 그 사실과 생성 일시를 명시하고, 약관 사본이 없으면 현재 약관을 넣지 않고 "기록 없음"으로 표기한다', () => {
    const html = buildArchiveHtml({
      contractHtml: CONTRACT_HTML,
      evidence: { ...EVIDENCE, source: 'regenerated', termsSha256: null, refundSha256: null, privacySha256: null },
      terms: null,
    })
    expect(html).toContain('재생성본')
    expect(html).toContain('2026.10.06 12:00')
    expect(html).toContain('서명 당시 약관 사본 기록이 없어')
    expect(html).not.toContain('서비스이용정책 원문')
  })

  it('동적 값은 HTML 이스케이프한다(UA·약관 원문에 태그가 있어도 실행되지 않음)', () => {
    const html = buildArchiveHtml({
      contractHtml: CONTRACT_HTML,
      evidence: { ...EVIDENCE, userAgent: '<script>alert(1)</script>' },
      terms: { terms: '<img src=x onerror=alert(1)>', refund: '', privacy: '' },
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('빈 약관 텍스트는 "등록된 내용이 없습니다"로 표기한다', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: { terms: '', refund: '환불', privacy: '   ' } })
    expect(html.match(/등록된 내용이 없습니다/g)?.length).toBe(2)
  })
})

describe('buildArchiveHtml — 한글 폰트 임베드 옵션', () => {
  const FONT_CSS = "@font-face{font-family:'Archive KR';font-weight:400;src:url(data:font/woff2;base64,AAAA) format('woff2')}"

  it('fontCss를 주면 head에 넣고, 계약서·부록 모두 Archive KR을 !important로 강제한다(맑은 고딕은 서버 Chromium에 없음)', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS, fontCss: FONT_CSS })
    expect(html).toContain(FONT_CSS)
    expect(html).toMatch(/\.contract-wrap[^{]*\{[^}]*font-family:\s*'Archive KR'[^}]*!important/)
    expect(html.indexOf(FONT_CSS)).toBeLessThan(html.indexOf(CONTRACT_HTML))
  })

  it('fontCss가 없으면 폰트 강제 규칙을 넣지 않는다(기존 동작 유지)', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).not.toContain('Archive KR')
  })

  it('페이지 상하 여백을 둔다(둘째 쪽부터 글자가 용지 끝에 붙지 않도록)', () => {
    const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: EVIDENCE, terms: TERMS })
    expect(html).toMatch(/@page\s*\{[^}]*margin:\s*12mm 0/)
  })

  it('증적 쪽에 "문서 안 해시만으로는 진위를 알 수 없고 공식 사이트에서 파일을 확인하라"는 안내를 넣는다(원본·재생성본 모두)', () => {
    for (const source of ['original', 'regenerated'] as const) {
      const html = buildArchiveHtml({ contractHtml: CONTRACT_HTML, evidence: { ...EVIDENCE, source }, terms: source === 'original' ? TERMS : null })
      expect(html).toContain('진위 확인 안내')
      expect(html).toContain('crazyshot.kr/contract-verify')
      expect(html).toContain('해시 값만으로는 진위를 알 수 없습니다')
    }
  })
})
