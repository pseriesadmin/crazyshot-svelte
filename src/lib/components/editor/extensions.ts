/**
 * 새 콘텐츠 에디터의 확장 목록.
 *  - createRichExtensions(): 문서 ↔ HTML 변환(contentBlocksTiptap.ts)과 에디터가 함께 쓰는 "스키마" 확장
 *  - createEditorOnlyExtensions(): 에디터 화면에서만 필요한 확장(플레이스홀더·끝 문단 유지)
 */
import { Extension } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Placeholder } from '@tiptap/extensions'
import { ImageGroup } from './nodes/ImageGroup'
import { YoutubeEmbed } from './nodes/YoutubeEmbed'
import { LegacyHtml } from './nodes/LegacyHtml'

export const MAX_INDENT = 6

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indentBlock: () => ReturnType
      outdentBlock: () => ReturnType
    }
  }
}

/** 문단·제목 들여쓰기 — padding-left: N em (서버 정화 허용 값과 동일 형식). */
const Indent = Extension.create({
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
              const n = Number(attrs.indent) || 0
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
      ({ state, tr, dispatch }: { state: import('@tiptap/pm/state').EditorState; tr: import('@tiptap/pm/state').Transaction; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
          const cur = Number(node.attrs.indent) || 0
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

/** 문서 끝이 문단이 아니면(이미지·동영상 등으로 끝나면) 빈 문단을 붙여 커서를 둘 자리를 유지한다. */
const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (_trs, _old, state) => {
          const last = state.doc.lastChild
          const para = state.schema.nodes.paragraph
          if (!last || last.type === para || !para) return null
          return state.tr.insert(state.doc.content.size, para.create())
        },
      }),
    ]
  },
})

export const RICH_HEADING_LEVELS: (1 | 2 | 3)[] = [1, 2, 3]

export function createRichExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: RICH_HEADING_LEVELS },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow ugc' },
      },
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    Indent,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ImageGroup,
    YoutubeEmbed,
    LegacyHtml,
  ]
}

export function createEditorOnlyExtensions(placeholder: string): Extensions {
  return [Placeholder.configure({ placeholder }), TrailingParagraph]
}
