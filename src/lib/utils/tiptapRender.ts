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
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'
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
 * 치환 정책:
 *   - 반복 영역(repeatRegion=true 행) 안: ContractLineItem 필드 우선 → 스칼라 폴백
 *   - 반복 영역 밖: 스칼라 값만 치환 (배열 필드는 원문 {{key}} 유지)
 *   - 키가 없으면 → {{key}} 원문 텍스트 노드로 유지
 *
 * 반복 영역 확장 (Stage 5):
 *   - 표 노드 안에 repeatRegion=true인 행이 있으면 data.상품목록 항목 수만큼 행 확장
 *   - 항목 i → templateRows[min(i, T-1)] 복제 후 항목+스칼라 치환
 *   - N=0이면 반복 행 전체 제거
 *   - 반복 영역이 없거나 items 미정의이면 기존 스칼라 치환 동작 그대로 유지 (무회귀)
 *
 * 결과는 여전히 tiptap-doc 구조이므로 renderTiptapDocToHtml()로 그대로 렌더링 가능.
 */
export function substituteTiptapDoc(
  doc: JSONContent,
  data: ContractSubstitutionData
): JSONContent {
  const items = data.상품목록

  /**
   * mergeField 노드를 실제 텍스트 노드로 변환한다.
   * item이 주어지면 ContractLineItem 필드를 1순위로, 스칼라 data를 2순위로 사용한다.
   */
  function substituteMergeFieldNode(
    node: JSONContent,
    item?: ContractLineItem,
  ): JSONContent {
    const varKey = String(node.attrs!['variable'])

    // 1순위: 반복 영역 아이템 필드
    if (item) {
      const itemKey = varKey as keyof ContractLineItem
      const itemValue = item[itemKey]
      if (itemValue !== undefined && typeof itemValue === 'string') {
        return { type: 'text', text: itemValue }
      }
    }

    // 2순위: 스칼라 데이터 (배열 필드 스킵 — 원문 유지)
    const scalarValue = data[varKey as keyof ContractSubstitutionData]
    const textValue = typeof scalarValue === 'string' ? scalarValue : null
    return {
      type: 'text',
      text: textValue != null ? textValue : `{{${varKey}}}`,
    }
  }

  /**
   * 노드 트리를 재귀 순회하며 mergeField를 치환한다.
   * item이 주어지면 반복 영역 아이템 컨텍스트로 동작한다.
   * table 노드를 만나면 expandTableRepeatRegion()으로 반복 영역 처리를 위임한다.
   */
  function traverseNode(node: JSONContent, item?: ContractLineItem): JSONContent {
    if (node.type === 'mergeField' && node.attrs?.['variable'] != null) {
      return substituteMergeFieldNode(node, item)
    }

    if (!Array.isArray(node.content)) return node

    // 표 노드: 반복 영역 확장 처리를 위임
    if (node.type === 'table') {
      return expandTableRepeatRegion(node)
    }

    return { ...node, content: node.content.map((n) => traverseNode(n, item)) }
  }

  /**
   * 표 노드 안에 반복 영역(repeatRegion=true인 행)이 있으면
   * data.상품목록 항목 수만큼 행을 확장한다.
   *
   * 스프레드시트 Stage 2의 expandSheet()와 동일한 정책:
   *   - before 행: 스칼라 치환
   *   - 반복 템플릿 행: 항목 i → templateRows[min(i, T-1)] 복제+치환
   *   - after 행: 스칼라 치환
   *   - N=0이면 반복 영역 행 전체 제거 (공란)
   */
  function expandTableRepeatRegion(tableNode: JSONContent): JSONContent {
    const rows = tableNode.content ?? []

    // 반복 영역으로 표시된 행 인덱스 수집
    const repeatIndices: number[] = []
    rows.forEach((row, i) => {
      if (row.type === 'tableRow' && row.attrs?.['repeatRegion'] === true) {
        repeatIndices.push(i)
      }
    })

    // 반복 영역 없거나 items 미정의: 기존 스칼라 치환 유지 (무회귀)
    if (repeatIndices.length === 0 || items === undefined) {
      return { ...tableNode, content: rows.map((row) => traverseNode(row)) }
    }

    const startIdx = repeatIndices[0]
    const endIdx = repeatIndices[repeatIndices.length - 1]
    const T = endIdx - startIdx + 1 // 템플릿 행 수
    const N = items.length
    const templateRows = rows.slice(startIdx, endIdx + 1)

    // before/after 행: 스칼라 치환
    const beforeRows = rows.slice(0, startIdx).map((row) => traverseNode(row))
    const afterRows = rows.slice(endIdx + 1).map((row) => traverseNode(row))

    // 항목별 확장: N=0이면 빈 배열 (반복 행 전체 제거)
    const expandedRows: JSONContent[] = items.map((item, i) => {
      // 항목 수가 템플릿 행 수를 초과하면 마지막 템플릿 행 재사용
      const templateRow = JSON.parse(
        JSON.stringify(templateRows[Math.min(i, T - 1)]),
      ) as JSONContent
      // 출력 행에서 반복 영역 표시 제거 (렌더링 결과에 data-repeat-region 남기지 않음)
      templateRow.attrs = { ...templateRow.attrs, repeatRegion: false }
      return traverseNode(templateRow, item)
    })

    return {
      ...tableNode,
      content: [...beforeRows, ...expandedRows, ...afterRows],
    }
  }

  return traverseNode(doc)
}
