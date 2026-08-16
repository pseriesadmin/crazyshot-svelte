/**
 * tiptapRender.ts — TipTap JSONContent → HTML 변환 유틸
 *
 * - generateHTML()(@tiptap/core)을 사용해 인터랙티브 Editor 인스턴스 없이 정적 HTML 생성
 * - TIPTAP_CONTRACT_EXTENSIONS를 에디터와 공유해 렌더링 결과 일치 보장
 * - SSR·Node.js 환경에서도 동작 (parseHTML 콜백은 generateHTML 시 실행 안 됨)
 *
 * 사용처:
 *   - src/routes/contract/[token]/+page.svelte (고객 서명화면)
 *   - src/lib/components/cms/ContractTemplatePreviewModal.svelte (발송 전 미리보기)
 */

import { generateHTML } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { TIPTAP_CONTRACT_EXTENSIONS } from '$lib/components/cms/contract-editor/tiptapExtensions'

/**
 * TipTap JSONContent 문서를 HTML 문자열로 변환한다.
 *
 * 에디터와 동일한 TIPTAP_CONTRACT_EXTENSIONS를 사용하므로
 * 에디터에서 보이는 것과 동일한 HTML이 생성된다.
 *
 * 표는 `.tt-table-scroll`로 감싸 넓은 표가 A4 페이지 폭 밖으로 넘치지 않도록 한다.
 * 에디터(ContractDocumentEditor)는 resizable:true인 TipTap Table의 NodeView가 자동으로
 * <table>을 <div class="tableWrapper">로 감싸주지만, generateHTML()은 NodeView를 거치지
 * 않는 순수 렌더링이라 이 래퍼가 생기지 않는다 — 여기서 문자열 치환으로 동일 효과를 낸다.
 * generateHTML()은 Node.js/SSR에서도 실행되는 순수 함수라 DOM을 쓸 수 없으므로(SSR 안전성
 * — contractSsrSafety.test.ts 참고) 정규식 기반 순수 문자열 치환만 사용한다.
 * <table>/</table>는 우리 스키마상 중첩되지 않으므로(표 안에 표 없음) 개수가 항상 1:1이라
 * 순서대로 짝지어 감싸는 이 방식이 안전하다.
 */
export function renderTiptapDocToHtml(doc: JSONContent): string {
  const html = generateHTML(doc, TIPTAP_CONTRACT_EXTENSIONS)
  return html
    .replace(/<table(\s|>)/g, '<div class="tt-table-scroll"><table$1')
    .replace(/<\/table>/g, '</table></div>')
}

/**
 * TipTap JSONContent 트리를 재귀 순회하며 mergeField 노드를
 * ContractSubstitutionData의 실제 값으로 치환한다.
 *
 * 치환 정책 (substituteVariables의 applySubstitution과 동일):
 *   - 키가 있으면 → 실제 값 텍스트 노드로 대체
 *   - 키가 없으면 → {{key}} 원문 텍스트 노드로 유지
 *
 * 결과는 여전히 tiptap-doc 구조이므로 renderTiptapDocToHtml()로 그대로 렌더링 가능.
 */
export function substituteTiptapDoc(
  doc: JSONContent,
  data: ContractSubstitutionData
): JSONContent {
  function traverseNode(node: JSONContent): JSONContent {
    // mergeField 노드 치환
    if (node.type === 'mergeField' && node.attrs?.['variable'] != null) {
      const varKey = String(node.attrs['variable']) as keyof ContractSubstitutionData
      const value = data[varKey]
      return {
        type: 'text',
        text: value != null ? value : `{{${String(node.attrs['variable'])}}}`,
      }
    }
    // content 배열이 있는 노드는 재귀 처리
    if (Array.isArray(node.content)) {
      return { ...node, content: node.content.map(traverseNode) }
    }
    return node
  }

  return traverseNode(doc)
}
