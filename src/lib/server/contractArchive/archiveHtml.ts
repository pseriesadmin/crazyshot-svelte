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
  /** 서명 시점에 기록된 최종본 SHA-256(소급 증적은 없음) */
  finalHtmlSha256: string | null
  /** 이 PDF의 원문(계약서 HTML) SHA-256 — 생성 시점에 계산한 값 */
  archivedHtmlSha256?: string | null
  /** 서명 시점 동의 기록(소급이면 빈 배열) */
  consents?: { label: string; checked: boolean; textSha256: string | null }[]
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
  @page { size: A4; margin: 12mm 0; }
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
  tr { page-break-inside: avoid; }
`

/**
 * 한글 폰트 강제 규칙 — 계약서 양식 CSS는 '맑은 고딕'(윈도우 폰트)만 지정하는데, 서버(Vercel)의 Chromium에는
 * 한글 폰트가 없어 그대로 두면 글자가 깨진다. fontCss(임베드한 @font-face)와 함께 쓰며, 계약서 양식의
 * font-family(같은 구체성, 뒤에 나오는 규칙이 이김)를 !important로 덮어 PDF에서는 항상 같은 폰트로 찍는다.
 */
const FONT_FORCE_CSS = `
  body, .archive-appendix, .contract-wrap, .contract-wrap * { font-family: 'Archive KR', sans-serif !important; }
`

function row(label: string, value: string | null | undefined): string {
  const shown = value && value.length > 0 ? esc(value) : '기록 없음'
  return `<tr><th>${esc(label)}</th><td>${shown}</td></tr>`
}

function consentRows(consents: ArchiveEvidenceSummary['consents']): string {
  if (consents === undefined) return ''
  if (consents.length === 0) return row('서명 시 동의 기록', '기록 없음(서명 증적 도입 전 서명 건 — 소급 보관)')
  return consents.map((c) => row(`동의: ${c.label || '항목'}`, `${c.checked ? '동의함' : '미동의'}${c.textSha256 ? ` (대상 문구 SHA-256 ${c.textSha256})` : ''}`)).join('\n    ')
}

function policySection(title: string, text: string | null): string {
  const body = text != null && text.trim().length > 0 ? esc(text) : '등록된 내용이 없습니다.'
  return `<h3>${esc(title)}</h3><p class="archive-policy">${body}</p>`
}

export function buildArchiveHtml(args: {
  contractHtml: string
  evidence: ArchiveEvidenceSummary
  terms: ArchiveTerms | null
  /** 임베드할 @font-face CSS(font-family 'Archive KR'). 있으면 모든 글자를 이 폰트로 강제한다. */
  fontCss?: string
}): string {
  const { contractHtml, evidence: ev, terms, fontCss } = args
  const regenerated = ev.source === 'regenerated'

  const notice = regenerated
    ? `<p class="archive-notice">재생성본 — ${esc(ev.generatedAtKst)}에 서명 당시 저장된 계약 내용(스냅샷)과 서명 이미지로 다시 만든 사본입니다.${terms ? '' : ' 서명 당시 약관 사본 기록이 없어 약관 부록은 포함하지 않습니다.'}</p>`
    : ''

  const evidenceTable = `<table class="archive-evidence">
    ${row('계약 ID', ev.contractId)}
    ${row('서명 기록 ID', ev.signingId)}
    ${row('예약코드', ev.reservationCode)}
    ${row('서명 일시(KST)', ev.signedAtKst)}
    ${row('서명 IP', ev.ipAddress)}
    ${row('서명 기기·브라우저', ev.userAgent)}
    ${row('서명 시점 기록 최종본 SHA-256', ev.finalHtmlSha256 ?? '기록 없음(서명 증적 도입 전 서명 건)')}
    ${ev.archivedHtmlSha256 !== undefined ? row('본 PDF 원문 SHA-256(생성 시점 계산)', ev.archivedHtmlSha256) : ''}
    ${ev.archivedHtmlSha256 && ev.finalHtmlSha256 && ev.archivedHtmlSha256 !== ev.finalHtmlSha256 ? row('해시 대조', '서명 시점 기록과 본 PDF 원문이 다릅니다(서명 시점 스냅샷으로 재생성)') : ''}
    ${consentRows(ev.consents)}
    ${row('서비스이용정책 SHA-256', ev.termsSha256)}
    ${row('환불규정 SHA-256', ev.refundSha256)}
    ${row('개인정보처리방침 SHA-256', ev.privacySha256)}
    ${row('보관본 구분', regenerated ? '재생성본' : '서명 시점 원본')}
    ${row('PDF 생성 일시(KST)', ev.generatedAtKst)}
  </table>`

  // 진위 판단 안내 — 이 문서 안의 해시 값은 문서를 고쳐 쓰는 사람이 함께 바꿀 수 있어 진위 근거가 되지 않는다.
  // 진위는 크레이지샷 공식 사이트에서 이 PDF 파일을 선택해 서버 보관 기록과 대조해야만 확인된다.
  const verifyNote = `<p class="archive-notice">진위 확인 안내 — 이 문서에 적힌 해시 값만으로는 진위를 알 수 없습니다. 공식 사이트(crazyshot.kr/contract-verify)에서 이 PDF 파일을 선택해 확인하세요. 문서를 수정하거나 다른 프로그램·AI로 다시 저장·변환한 파일은 일치하지 않습니다.</p>`

  const evidencePage = `<section class="archive-appendix">
    <h2>서명 증적 요약</h2>
    ${notice}
    ${evidenceTable}
    ${verifyNote}
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
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">
<title>전자계약서 최종본</title>
<style>${fontCss ?? ''}${ARCHIVE_CSS}${fontCss ? FONT_FORCE_CSS : ''}</style>
</head>
<body>
${contractHtml}
${evidencePage}
${policyPage}
</body>
</html>`
}
