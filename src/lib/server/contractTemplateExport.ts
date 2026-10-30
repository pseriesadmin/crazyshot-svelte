/**
 * contractTemplateExport.ts — 계약서 양식 "파일 저장 > PDF" 서버 보조 (2026-10-29)
 *
 * 편집 중인 양식 HTML을 PDF 엔진(Chromium)에 넣기 전에 겹겹이 잠근다(sp5 보안 검수 반영).
 *  ① sanitizeArchiveHtml: 스크립트·이벤트 속성·외부 로딩 요소 제거(기존 최종본 PDF 경로와 같은 함수)
 *  ② stripEventHandlerAttributes: 따옴표 바로 뒤에 붙은 on* 속성(<img src="x"onerror=…>)까지 한 번 더 제거(①의 정규식은 공백·/ 뒤만 잡는다)
 *  ③ buildLockedDocument: 문서를 우리가 직접 조립한다 — 스크립트·외부 요청을 막는 CSP 메타를 **우리 <head> 맨 앞**에 두고, 사용자 HTML은 <body> 안쪽에만 넣는다.
 *     (문자열 치환으로 <head>를 찾아 끼우면 주석·<title> 속 "<head>" 글자에 속아 CSP 가 실제 태그 밖에 들어갈 수 있었다)
 *  ④ 렌더러가 data:/about: 외 모든 요청을 차단(renderPdf.ts)
 * 본문 읽기는 읽는 도중 상한을 넘으면 중단한다(readLimitedText — Content-Length 없는 청크 전송도 같은 한도).
 * +server.ts 는 HTTP 메서드 외 export 를 가질 수 없어 이 파일로 분리했다(단위 테스트 대상).
 */
import { sanitizeArchiveHtml } from '$lib/server/contractArchive/sanitizeArchiveHtml'

export const EXPORT_PDF_MAX_BODY_BYTES = 4_000_000

const LOCKDOWN_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`

/** 태그 안의 on* 속성(이름+값)만 지운다. 바로 앞의 따옴표·공백은 남긴다(속성 값의 닫는 따옴표를 먹지 않도록 lookbehind). */
export function stripEventHandlerAttributes(html: string): string {
  const pattern = /(<[a-z][^>]*?)(?<=["'\s/])on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
  let out = html
  for (let i = 0; i < 20; i++) {
    const next = out.replace(pattern, '$1')
    if (next === out) break
    out = next
  }
  return out
}

/** 사용자 HTML에서 문서 뼈대 태그(<!DOCTYPE>·<html>·<head>·<body>)만 걷어 낸다 — 안쪽 내용(<style>·<title> 포함)은 그대로 둔다. */
function unwrapDocumentShell(html: string): string {
  return html.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
}

/** 뼈대 제거 + 우리 뼈대(CSP 가 맨 앞)에 넣기 — 정화와 별개로 CSP 만의 방어를 시험할 수 있게 분리 */
export function wrapWithLockdown(html: string): string {
  return `<!DOCTYPE html><html lang="ko"><head>${LOCKDOWN_CSP}<meta charset="utf-8"></head><body>${unwrapDocumentShell(html)}</body></html>`
}

/** PDF 엔진에 넣을 최종 문서: 정화 → on* 속성 재제거 → 우리 뼈대(CSP 가 맨 앞)에 넣기 */
export function buildLockedDocument(untrustedHtml: string): string {
  return wrapWithLockdown(stripEventHandlerAttributes(sanitizeArchiveHtml(untrustedHtml)))
}

export class BodyTooLargeError extends Error {
  constructor() {
    super('body too large')
    this.name = 'BodyTooLargeError'
  }
}

/** 요청 본문을 한도(바이트) 안에서만 읽는다. 넘으면 읽기를 멈추고 BodyTooLargeError. */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new BodyTooLargeError()
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLargeError()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/** 한 서버 인스턴스에서 동시에 PDF 를 만드는 건수 상한(Chromium 은 무겁다) */
export const EXPORT_PDF_MAX_CONCURRENT = 2
