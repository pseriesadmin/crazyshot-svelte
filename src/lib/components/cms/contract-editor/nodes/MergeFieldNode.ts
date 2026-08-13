/**
 * MergeFieldNode.ts — TipTap 변수 칩 커스텀 노드
 *
 * 인라인 atom 노드. contenteditable=false 로 렌더링되어 시각적 칩처럼 보임.
 * 직렬화(HTML → 저장) 시 `{{변수명}}` 원문 텍스트로 변환되어
 * contract-substitution.ts 의 /\{\{([^}]+)\}\}/g 정규식과 완전 호환.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import type { MergeFieldAttrs } from '$lib/types/contract-document'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mergeField: {
      /**
       * 현재 커서 위치에 변수 칩을 삽입합니다.
       */
      insertMergeField: (attrs: MergeFieldAttrs) => ReturnType
    }
  }
}

export const MergeFieldNode = Node.create({
  name: 'mergeField',

  // 인라인 atom: 내부 편집 불가, 단일 단위로 선택/삭제됨
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      variable: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variable'),
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-variable': attrs['variable'],
        }),
      },
      label: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-label') ?? element.textContent,
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-label': attrs['label'],
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        // 직렬화된 HTML에서 data-merge-field 속성으로 파싱
        tag: 'span[data-merge-field]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-merge-field': 'true',
        contenteditable: 'false',
        class: 'cs-merge-chip',
      }),
      // 내부 텍스트는 label(표시용) — 직렬화 시엔 variable로 대체
      HTMLAttributes['data-label'] ?? HTMLAttributes['data-variable'] ?? '',
    ]
  },

  /**
   * HTML 직렬화: {{변수명}} 원문으로 출력.
   * substituteVariables() 정규식(/\{\{([^}]+)\}\}/g)이 정상 매칭됨.
   */
  renderText({ node }) {
    return `{{${node.attrs['variable'] as string}}}`
  },

  addCommands() {
    return {
      insertMergeField:
        (attrs: MergeFieldAttrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },
})
