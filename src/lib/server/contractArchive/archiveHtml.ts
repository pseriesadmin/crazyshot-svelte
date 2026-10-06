/**
 * archiveHtml.ts — 최종본 PDF의 원본 HTML 조립 (순수 함수, PDF 엔진과 무관)
 *
 * 구성: 서명이 합성된 계약서 본문(변경 없이 그대로) + 부록 ① 서명 증적 요약 ② 약관 사본 3종.
 * 부록은 새 페이지에서 시작한다. PDF 변환기(Chromium 등)는 이 HTML을 그대로 렌더링한다.
 *
 * 원칙:
 *   - 계약서 본문은 가공하지 않는다(저장된 html_document = 고객이 서명한 문서).
 *   - 약관 부록은 "서명 당시 스냅샷"만 넣는다. 스냅샷이 없는(소급 재생성) 경우 현재 게시된 약관을
 *     당시 교부본인 것처럼 넣지 않고 "기록 없음"을 명시한다.
 *   - 모든 동적 값(UA·IP·약관 원문 등)은 HTML 이스케이프한다.
 */

export interface ArchiveEvidenceSummary {
  contractId: string
  signingId: string
  reservationCode: string | null
  /** KST로 포맷된 서명 일시 */
  signedAtKst: string
  ipAddress: string | null
  userAgent: string | null
  finalHtmlSha256: string | null
  termsSha256: string | null
  refundSha256: string | null
  privacySha256: string | null
  source: 'original' | 'regenerated'
  /** KST로 포맷된 PDF 생성 일시 */
  generatedAtKst: string
}

export interface ArchiveTerms {
  terms: string | null
  refund: string | null
  privacy: string | null
}

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ARCHIVE_CSS = `
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #111; }
  .archive-appendix { box-sizing: border-box; width: 210mm; padding: 18mm 16mm; font-size: 11px; line-height: 1.7; page-break-before: always; }
  .archive-appendix h2 { margin: 0 0 10px; font-size: 16px; }
  .archive-appendix h3 { margin: 14px 0 4px; font-size: 13px; }
  .archive-notice { margin: 0 0 12px; padding: 8px 10px; background: #fff2cc; font-weight: 700; }
  .archive-evidence { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .archive-evidence th, .archive-evidence td { border: 1px solid #333; padding: 5px 8px; text-align: left; vertical-align: top; word-break: break-all; }
  .archive-evidence th { width: 30%; background: #f3f3f3; }
  .archive-policy { margin: 0; white-space: pre-wrap; word-break: break-word; }
`

function row(label: string, value: string | null | undefined): string {
  const shown = value && value.length > 0 ? esc(value) : '기록 없음'
  return `<tr><th>${esc(label)}</th><td>${shown}</td></tr>`
}

function policySection(title: string, text: string | null): string {
  const body = text != null && text.trim().length > 0 ? esc(text) : '등록된 내용이 없습니다.'
  return `<h3>${esc(title)}</h3><p class="archive-policy">${body}</p>`
}

export function buildArchiveHtml(args: {
  contractHtml: string
  evidence: ArchiveEvidenceSummary
  terms: ArchiveTerms | null
}): string {
  const { contractHtml, evidence: ev, terms } = args
  const regenerated = ev.source === 'regenerated'

  const notice = regenerated
    ? `<p class="archive-notice">재생성본 — ${esc(ev.generatedAtKst)}에 서명 당시 저장된 계약 내용(스냅샷)과 서명 이미지로 다시 만든 사본입니다. 서명 당시 약관 사본 기록이 없어 약관 부록은 포함하지 않습니다.</p>`
    : ''

  const evidenceTable = `<table class="archive-evidence">
    ${row('계약 ID', ev.contractId)}
    ${row('서명 기록 ID', ev.signingId)}
    ${row('예약코드', ev.reservationCode)}
    ${row('서명 일시(KST)', ev.signedAtKst)}
    ${row('서명 IP', ev.ipAddress)}
    ${row('서명 기기·브라우저', ev.userAgent)}
    ${row('최종본 문서 SHA-256', ev.finalHtmlSha256)}
    ${row('서비스이용정책 SHA-256', ev.termsSha256)}
    ${row('환불규정 SHA-256', ev.refundSha256)}
    ${row('개인정보처리방침 SHA-256', ev.privacySha256)}
    ${row('보관본 구분', regenerated ? '재생성본' : '서명 시점 원본')}
    ${row('PDF 생성 일시(KST)', ev.generatedAtKst)}
  </table>`

  const evidencePage = `<section class="archive-appendix">
    <h2>서명 증적 요약</h2>
    ${notice}
    ${evidenceTable}
  </section>`

  const policyPage = terms
    ? `<section class="archive-appendix">
    <h2>약관 사본 (서명 당시 교부본)</h2>
    ${policySection('서비스이용정책', terms.terms)}
    ${policySection('환불규정', terms.refund)}
    ${policySection('개인정보처리방침', terms.privacy)}
  </section>`
    : ''

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>전자계약서 최종본</title>
<style>${ARCHIVE_CSS}</style>
</head>
<body>
${contractHtml}
${evidencePage}
${policyPage}
</body>
</html>`
}
