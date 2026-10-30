/**
 * hwpFromHtml.ts — HTML → 한글 문서(.hwp / .hwpx) 바이트 (한글 엔진 rhwp 사용)
 *
 * 순서: 빈 문서 만들기 → 본문 HTML 붙여넣기(pasteHtml) → 한글 형식으로 내보내기(내용 손실 보고 포함).
 * 엔진 모듈은 호출부가 넘긴다(loadRhwp 결과) — 이 파일은 브라우저·Node(테스트) 어디서든 같은 코드로 돈다.
 *
 * 알려진 한계(2026-10-29 실험)
 *  - 엔진은 `<style>`·클래스 CSS를 읽지 않는다 → HTML형 양식은 호출 전에 inlineStyles.ts로 서식을 요소에 풀어 넣는다.
 *  - 번호 목록(<ol>)은 글머리표(•)로 바뀐다 → 번호를 글자("1. ")로 풀어 붙인 문단으로 바꿔 넣는다(prepareHtmlForHwp).
 *  - <style>가 그대로 들어가면 CSS 글자가 본문 문단으로 붙는다 → 반드시 제거한다.
 *  - 한컴 오피스에서 열리는지는 이 코드로 보증할 수 없다(.hwpx는 "베타" 표기).
 */
import type { RhwpModule } from '$lib/utils/docImport/rhwpLoader'

export type HwpFormat = 'hwp' | 'hwpx'

export interface HwpExportResult {
  bytes: Uint8Array
  format: HwpFormat
  /** 엔진이 보고한 내용 손실 항목 수(0이면 보고된 손실 없음) */
  lossCount: number
  losses: unknown[]
}

/** <ol> 하나를 "n. 내용" 문단들로 바꾼다(중첩 없는 단순 목록 기준 — 에디터가 만드는 목록 수준) */
function olToNumberedParagraphs(html: string): string {
  return html.replace(/<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi, (_m, attrs: string, inner: string) => {
    const start = Number(/\bstart\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? '1') || 1
    let n = start - 1
    const items = inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? []
    return items.map((li) => {
      n += 1
      // 편집기가 만드는 <li><p>글</p></li> 모양은 안쪽 <p>를 벗겨 한 문단으로 만든다
      const content = li.replace(/^<li\b[^>]*>\s*/i, '').replace(/\s*<\/li>$/i, '').replace(/^\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*$/i, '$1')
      return `<p>${n}. ${content}</p>`
    }).join('')
  })
}

/** 엔진에 넣기 전 본문 HTML 정리: 머리·스타일·스크립트·주석 제거, <body> 안쪽만, 번호 목록 풀기 */
export function prepareHtmlForHwp(html: string): string {
  let out = html
  out = out.replace(/<!--[\s\S]*?-->/g, '')
  out = out.replace(/<(style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  out = out.replace(/<\/?(meta|link|base)\b[^>]*>/gi, '')
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(out)
  if (body) out = body[1]
  out = out.replace(/<\/?(html|head)\b[^>]*>/gi, '')
  return olToNumberedParagraphs(out).trim()
}

function parseLoss(json: string): { count: number; losses: unknown[] } {
  try {
    const parsed = JSON.parse(json) as { count?: number; losses?: unknown[] }
    return { count: Number(parsed.count ?? 0), losses: Array.isArray(parsed.losses) ? parsed.losses : [] }
  } catch {
    return { count: 0, losses: [] }
  }
}

/**
 * 본문 HTML을 한글 문서로 바꿔 바이트를 돌려준다.
 * @throws 붙여넣기 실패 등 — 호출부가 사용자 안내 문구로 바꿔 보여 준다.
 */
export function htmlToHwp(rh: RhwpModule, html: string, format: HwpFormat): HwpExportResult {
  const prepared = prepareHtmlForHwp(html)
  if (!prepared) throw new Error('저장할 내용이 비어 있습니다.')
  const doc = rh.HwpDocument.createEmpty()
  try {
    doc.createBlankDocument()
    const pasted = doc.pasteHtml(0, 0, 0, prepared)
    let ok = true
    try {
      ok = (JSON.parse(pasted) as { ok?: boolean }).ok !== false
    } catch {
      ok = true // JSON이 아니면 엔진이 성공 시 값만 돌려준 것 — 아래 내보내기 단계에서 실패를 잡는다
    }
    if (!ok) throw new Error('한글 문서로 바꾸지 못했습니다(본문을 읽을 수 없음).')
    const exported = format === 'hwp' ? doc.exportHwpWithReport() : doc.exportHwpxWithReport()
    try {
      const bytes = exported.takeBytes()
      const { count, losses } = parseLoss(exported.contentLoss())
      return { bytes, format, lossCount: count, losses }
    } finally {
      exported.free()
    }
  } finally {
    doc.free()
  }
}
