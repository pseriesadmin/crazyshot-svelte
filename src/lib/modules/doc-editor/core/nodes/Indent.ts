/**
 * Indent.ts — 문단·제목 들여쓰기 (doc-editor core)
 *
 * 이관 원본: src/lib/components/editor/extensions.ts 의 Indent (원본은 무변경 유지, 동일 규칙).
 * 저장 형식: 노드 속성 indent(0~MAX_INDENT) · 렌더: padding-left: N*2 em (indent 0이면 아무 스타일도 내지 않는다 → 기존 문서 HTML 무변경).
 * ⚠️ 이 확장은 '렌더 경로(고객 서명 화면)의 확장 목록'에도 같이 등록돼야 들여쓰기가 보인다.
 */
import { Extension } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export const MAX_INDENT = 6

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indentBlock: () => ReturnType
      outdentBlock: () => ReturnType
    }
  }
}

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const m = /^(\d+(?:\.\d+)?)em$/.exec(el.style.paddingLeft || '')
              return m ? Math.min(MAX_INDENT, Math.round(parseFloat(m[1]) / 2)) : 0
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = Number(attrs['indent']) || 0
              return n > 0 ? { style: `padding-left: ${n * 2}em` } : {}
            },
          },
        },
      },
    ]
  },
  addCommands() {
    const shift =
      (delta: number) =>
      () =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
          const cur = Number(node.attrs['indent']) || 0
          const next = Math.max(0, Math.min(MAX_INDENT, cur + delta))
          if (next !== cur) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    return { indentBlock: shift(1), outdentBlock: shift(-1) }
  },
})
