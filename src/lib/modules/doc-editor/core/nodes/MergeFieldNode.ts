/**
 * MergeFieldNode.ts — 변수 칩 노드 (doc-editor core)
 *
 * 인라인 atom 노드. 직렬화(renderText)는 `{{변수명}}` 원문으로 출력되어 치환 엔진과 호환된다.
 * (기존 contract-editor/nodes/MergeFieldNode.ts 와 동일 스키마 — 저장된 문서가 그대로 열린다)
 */

import { Node, mergeAttributes } from '@tiptap/core'
import type { MergeFieldAttrs } from '../types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mergeField: {
      /** 현재 커서 위치에 변수 칩을 삽입한다. */
      insertMergeField: (attrs: MergeFieldAttrs) => ReturnType
    }
  }
}

export const MergeFieldNode = Node.create({
  name: 'mergeField',

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
    return [{ tag: 'span[data-merge-field]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-merge-field': 'true',
        contenteditable: 'false',
        class: 'cs-merge-chip',
      }),
      HTMLAttributes['data-label'] ?? HTMLAttributes['data-variable'] ?? '',
    ]
  },

  renderText({ node }) {
    return `{{${node.attrs['variable'] as string}}}`
  },

  addCommands() {
    return {
      insertMergeField:
        (attrs: MergeFieldAttrs) =>
        ({ commands, state }) => {
          // 커서 위치의 글자 서식(글꼴·크기·굵기 등, 링크 제외)을 칩이 이어받는다 — 값 치환 때 그 서식으로 나온다
          const marks = (state.storedMarks ?? state.selection.$from.marks())
            .filter((m) => m.type.name !== 'link')
            .map((m) => m.toJSON())
          return commands.insertContent({
            type: this.name,
            attrs,
            ...(marks.length > 0 ? { marks } : {}),
          })
        },
    }
  },
})
