/**
 * fileName.ts — 내려받을 파일 이름 정리
 *
 * 양식 제목에는 어떤 글자든 들어올 수 있어 운영체제가 거절하는 글자(\ / : * ? " < > |)와 제어 문자를 빼고,
 * 앞뒤 공백·점을 걷어내며, 80글자(코드 포인트 기준)로 자른다. 비면 대체 이름을 쓴다.
 */

const FORBIDDEN_CHARS = '\\/:*?"<>|'
const MAX_BASE_LENGTH = 80
export const DEFAULT_EXPORT_BASE_NAME = '계약서 양식'

/** 운영체제가 거절하는 글자와 제어 문자(0x00~0x1f, 0x7f)를 공백으로 바꾼다 */
function replaceForbidden(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f || FORBIDDEN_CHARS.includes(ch) ? ' ' : ch
  }
  return out
}

export function toSafeFileName(title: string | null | undefined, ext: string, fallback: string = DEFAULT_EXPORT_BASE_NAME): string {
  const cleaned = replaceForbidden(String(title ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const base = [...(cleaned || fallback)].slice(0, MAX_BASE_LENGTH).join('').trim() || fallback
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return safeExt ? `${base}.${safeExt}` : base
}
