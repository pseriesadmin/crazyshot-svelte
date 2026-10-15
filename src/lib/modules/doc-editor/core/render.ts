/**
 * render.ts — TipTap 문서 JSON → 정적 HTML (doc-editor core)
 *
 * generateHTML()은 인터랙티브 Editor 없이 동작하며 SSR·Node.js에서도 안전하다(parseHTML 콜백 미실행).
 * 에디터와 같은 확장 목록(DOC_EDITOR_EXTENSIONS)을 쓰므로 편집 화면과 동일한 HTML이 생성된다.
 * 표는 `.tt-table-scroll`로 감싸 넓은 표가 페이지 폭 밖으로 넘치지 않게 한다
 * (에디터의 Table NodeView가 만드는 tableWrapper와 같은 효과를 문자열 치환으로 구현 — DOM 미사용).
 */

import { generateHTML } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { DOC_EDITOR_EXTENSIONS } from './extensions'

export function renderDocToHtml(doc: JSONContent): string {
  const html = generateHTML(doc, DOC_EDITOR_EXTENSIONS)
  return html
    .replace(/<table(\s|>)/g, '<div class="tt-table-scroll"><table$1')
    .replace(/<\/table>/g, '</table></div>')
}
