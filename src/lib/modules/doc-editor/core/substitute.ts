/**
 * substitute.ts — 변수 치환 + 반복행 전개 (doc-editor core, 프로젝트 비종속)
 *
 * 이관 원본: utils/tiptapRender.ts substituteTiptapDoc (원본은 무변경 유지).
 * 계약서 전용 타입(ContractSubstitutionData)에 의존하지 않고 {values, repeatItems}만 받는다.
 *
 * 치환 정책(원본과 동일):
 *   - 반복 영역(repeatRegion=true 행) 안: 항목(item) 필드 우선 → 스칼라 폴백
 *   - 반복 영역 밖: 스칼라 값만 치환 (문자열이 아닌 값은 원문 `{{key}}` 유지)
 *   - 키가 없으면 `{{key}}` 원문 텍스트 노드로 유지
 *   - repeatItems가 undefined면 반복 확장을 하지 않는다(스칼라 치환만, 무회귀)
 *   - N=0(빈 배열)이면 반복 행 전체 제거
 *   - 항목 i → templateRows[min(i, T-1)] 복제 후 repeatRegion=false로 바꿔 치환
 */

import type { JSONContent } from '@tiptap/core'
import type { SubstituteInput } from './types'
import { marksForChip } from './chipMarks'

export function substituteDoc(doc: JSONContent, input: SubstituteInput): JSONContent {
  const values = input.values as Record<string, unknown>
  const items = input.repeatItems as ReadonlyArray<Record<string, unknown>> | undefined

  function substituteMergeFieldNode(
    node: JSONContent,
    item?: Record<string, unknown>,
  ): JSONContent {
    const varKey = String(node.attrs!['variable'])

    if (item) {
      const itemValue = item[varKey]
      if (itemValue !== undefined && typeof itemValue === 'string') {
        return { type: 'text', text: itemValue }
      }
    }

    const scalarValue = values[varKey]
    const textValue = typeof scalarValue === 'string' ? scalarValue : null
    return {
      type: 'text',
      text: textValue != null ? textValue : `{{${varKey}}}`,
    }
  }

  function traverseNode(node: JSONContent, item?: Record<string, unknown>): JSONContent {
    if (node.type === 'mergeField' && node.attrs?.['variable'] != null) {
      return substituteMergeFieldNode(node, item)
    }

    if (!Array.isArray(node.content)) return node

    if (node.type === 'table') {
      return expandTableRepeatRegion(node)
    }

    const children = node.content
    return {
      ...node,
      content: children.map((n, i) => {
        const out = traverseNode(n, item)
        // 칩 → 값 글자: 칩의 서식(없으면 주변 글자 서식)을 이어받아 값이 주변과 같은 글꼴·크기로 보이게 한다
        if (n.type === 'mergeField' && out.type === 'text') {
          const marks = marksForChip(children, i)
          if (marks) return { ...out, marks }
        }
        return out
      }),
    }
  }

  function expandTableRepeatRegion(tableNode: JSONContent): JSONContent {
    const rows = tableNode.content ?? []

    const repeatIndices: number[] = []
    rows.forEach((row, i) => {
      if (row.type === 'tableRow' && row.attrs?.['repeatRegion'] === true) {
        repeatIndices.push(i)
      }
    })

    if (repeatIndices.length === 0 || items === undefined) {
      return { ...tableNode, content: rows.map((row) => traverseNode(row)) }
    }

    const startIdx = repeatIndices[0]
    const endIdx = repeatIndices[repeatIndices.length - 1]
    const T = endIdx - startIdx + 1
    const templateRows = rows.slice(startIdx, endIdx + 1)

    const beforeRows = rows.slice(0, startIdx).map((row) => traverseNode(row))
    const afterRows = rows.slice(endIdx + 1).map((row) => traverseNode(row))

    const expandedRows: JSONContent[] = items.map((item, i) => {
      const templateRow = JSON.parse(
        JSON.stringify(templateRows[Math.min(i, T - 1)]),
      ) as JSONContent
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

/** 문서 안에 남아 있는 `{{변수}}` 원문(치환 후 미해결 변수) 키를 중복 없이 수집한다. */
export function findUnresolvedInDoc(doc: JSONContent): string[] {
  const found = new Set<string>()
  const walk = (node: JSONContent): void => {
    if (node.type === 'text' && typeof node.text === 'string') {
      for (const m of node.text.matchAll(/\{\{([^}]+)\}\}/g)) found.add(m[1].trim())
    }
    if (node.type === 'mergeField' && node.attrs?.['variable'] != null) {
      found.add(String(node.attrs['variable']))
    }
    for (const c of node.content ?? []) walk(c)
  }
  walk(doc)
  return [...found]
}
