/**
 * placeholderExtension.ts — 빈 문서 안내 문구 (에디터 전용, doc-editor ui)
 *
 * @tiptap/extensions 의 Placeholder 와 같은 결과(빈 첫 문단에 is-editor-empty + data-placeholder)를
 * 추가 패키지 없이 @tiptap/core · @tiptap/pm 만으로 구현한다(이식 시 필수 패키지 목록을 늘리지 않기 위함).
 * 문서 스키마·저장 JSON·렌더(generateHTML)에는 영향이 없다.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export function createPlaceholder(text: string) {
  return Extension.create({
    name: 'docPlaceholder',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('docPlaceholder'),
          props: {
            decorations: (state) => {
              const { doc } = state
              const first = doc.firstChild
              if (doc.childCount !== 1 || !first || first.type.name !== 'paragraph' || first.content.size !== 0) return null
              return DecorationSet.create(doc, [
                Decoration.node(0, first.nodeSize, { class: 'is-editor-empty', 'data-placeholder': text }),
              ])
            },
          },
        }),
      ]
    },
  })
}
