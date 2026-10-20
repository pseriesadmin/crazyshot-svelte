// linkify.ts — 채팅 글 속 주소(http(s)://, www.)를 눌러서 열 수 있는 링크 조각으로 나눈다 (2026-10-20, Stephen 지시)
// 배경: 말풍선은 글을 그대로 보여 줘서 상담원이 적은 주소가 고객 화면에서 눌러지지 않았다.
// 보안: {@html}을 쓰지 않고 조각 배열만 만든다 — 링크로 인정하는 건 http/https뿐(javascript:·data: 등은 글자로만 남는다).
export type LinkSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }

// 주소에 쓰는 ASCII 글자만 — 한글 조사("https://x.com를")는 주소에 포함되지 않는다
const URL_RE = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi
const TRAILING_PUNCT = /[.,!?;:'"…]+$/

/** 주소 끝에 붙은 문장부호·짝 없는 닫는 괄호를 떼어 낸다 */
function trimUrl(raw: string): { url: string; rest: string } {
  let url = raw
  let rest = ''
  for (;;) {
    const m = url.match(TRAILING_PUNCT)
    if (m) { rest = m[0] + rest; url = url.slice(0, -m[0].length); continue }
    if (url.endsWith(')') && !url.includes('(')) { rest = ')' + rest; url = url.slice(0, -1); continue }
    break
  }
  return { url, rest }
}

function toHref(url: string): string | null {
  const href = /^www\./i.test(url) ? `https://${url}` : url
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function linkifyText(input: string | null | undefined): LinkSegment[] {
  const text = input ?? ''
  const out: LinkSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    // www.로 시작하는 주소는 앞에 글자·점이 붙은 단어(awww.x)면 링크로 보지 않는다(정규식 lookbehind는 구형 사파리 호환 문제로 쓰지 않음)
    if (/^www\./i.test(m[0]) && start > 0 && /[A-Za-z0-9.]/.test(text[start - 1])) continue
    const { url } = trimUrl(m[0])
    const href = url ? toHref(url) : null
    if (!href) continue
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    out.push({ kind: 'link', text: url, href })
    last = start + url.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out.length > 0 ? out : [{ kind: 'text', text }]
}
