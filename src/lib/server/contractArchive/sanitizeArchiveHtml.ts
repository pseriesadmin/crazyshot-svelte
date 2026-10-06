/**
 * sanitizeArchiveHtml.ts — 최종본 PDF 렌더링 직전, 저장된 계약서 HTML에서 실행 가능한 요소를 제거
 *
 * 계약서 html_document는 관리자가 편집한 임의 HTML이다. PDF는 서버의 Chromium이 렌더링하므로 저장된 HTML에
 * 스크립트가 섞여 있으면 서버 안에서 실행될 수 있다. 렌더러는 외부 요청을 전부 차단하지만(renderPdf.ts) 방어를
 * 겹쳐 둔다 — ① 여기서 스크립트·이벤트 핸들러·외부 로딩 요소를 제거 ② archiveHtml이 CSP로 스크립트 실행 금지.
 * 계약서 "내용"(표·글·서명 이미지·스타일)은 건드리지 않는다.
 */

const BLOCK_TAGS = ['script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset']

/** 한 번의 치환 결과에 금지 요소가 다시 조립되는 중첩 입력(<scr<script>ipt>)을 막기 위해 더 바뀌지 않을 때까지 반복한다. */
export function sanitizeArchiveHtml(html: string): string {
  let out = html
  for (let i = 0; i < 10; i++) {
    const next = sanitizeOnce(out)
    if (next === out) break
    out = next
  }
  return out
}

function sanitizeOnce(html: string): string {
  let out = html
  // 짝이 있는 태그는 내용까지 제거
  for (const tag of BLOCK_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    // 닫는 태그 없이 열린 태그 잔여분
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  // 외부 문서를 끌어오거나 기준 주소를 바꾸는 단독 태그
  out = out.replace(/<(?:link|base)\b[^>]*>/gi, '')
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
  // 이벤트 핸들러 속성(onclick=, onerror= …)
  // 한 태그에 핸들러가 여러 개일 수 있어 더 바뀌지 않을 때까지 반복한다
  const handler = /(<[^>]*?)[\s/]+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
  for (let prev = ''; prev !== out; ) {
    prev = out
    out = out.replace(handler, '$1')
  }
  // javascript: 주소 (href·src·xlink:href·action 등)
  out = out.replace(/\b(href|src|action|formaction|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2')
  return out
}
