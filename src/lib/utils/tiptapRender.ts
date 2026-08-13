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
 */
export function renderTiptapDocToHtml(doc: JSONContent): string {
  return generateHTML(doc, TIPTAP_CONTRACT_EXTENSIONS)
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
