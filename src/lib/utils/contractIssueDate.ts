/**
 * contractIssueDate.ts — 전자계약 "발행일"을 발행(=고객에게 발송) 실행 순간의 한국시간 날짜로 맞추는 순수 함수 (2026-10-09, Stephen 지시)
 *
 * 배경: 계약서 변수 `계약서발행일`은 발행 화면(모달)이 계약 정보를 불러오는 시점의 날짜로 채워져서, 모달을 열어 둔 채 날짜가 바뀌거나
 *       미리 만들어 둔(특약 즉시 발행 등) 계약을 나중에 발송하면 "발행 버튼을 누른 날"과 다른 날짜가 기록됐다.
 * 방식: 발송(send-chat) 순간에 저장된 html_document 안의 발행일 표기만 그 순간 날짜로 다시 쓴다(최초 발송·재발송 공통, 서명 전에만 — 서명 후엔 재발송 차단).
 *       양식의 `<p class="issue-date">(계약서 발행일시: YYYY.MM.DD)</p>` 문단 안의 날짜 토큰만 바꾸고, 그 문단이 없거나 편집으로 지워졌으면 아무것도 바꾸지 않는다.
 */

// 발행일 문단: class에 issue-date를 포함한 <p> 안, "발행일시:" 뒤의 값(날짜 또는 '-')만 대상
const ISSUE_DATE_PARAGRAPH =
  /(<p\b[^>]*\bclass="[^"]*\bissue-date\b[^"]*"[^>]*>[^<]*?발행일시\s*:\s*)(\d{4}[.\-/]\d{2}[.\-/]\d{2}|-)(\s*\)?[^<]*<\/p>)/

/** html 안의 발행일 표기를 dateDot("YYYY.MM.DD")로 바꾼 html. 대상이 없거나 이미 같은 날짜면 원본 그대로. */
export function stampIssueDateInHtml(html: string, dateDot: string): string {
  if (!html || !dateDot || dateDot === '-') return html
  return html.replace(ISSUE_DATE_PARAGRAPH, (_m, head: string, _old: string, tail: string) => `${head}${dateDot}${tail}`)
}
