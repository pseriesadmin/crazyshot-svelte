/**
 * LegacyHtml — 원본 보존 블록 (atom).
 * 새 에디터가 글자·서식을 손실 없이 옮길 수 없다고 판정한 text/html 블록의 원본 HTML을 한 글자도 바꾸지 않고 담는다.
 * 저장 시 attrs.html을 그대로 원래 블록 타입(kind)으로 되돌려 쓴다.
 */
import { Node } from '@tiptap/core'
import { sanitizeForPreview } from '$lib/utils/previewSanitize'

export interface LegacyHtmlAttrs {
  html: string
  kind: 'text' | 'html'
  id: string
}

export const LegacyHtml = Node.create({
  name: 'legacyHtml',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: { default: '' },
      kind: { default: 'text' },
      id: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-rc-legacy]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return {
            html: e.getAttribute('data-html') ?? '',
            kind: e.getAttribute('data-kind') === 'html' ? 'html' : 'text',
            id: e.getAttribute('data-id') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-rc-legacy': '',
        'data-html': String(node.attrs.html ?? ''),
        'data-kind': String(node.attrs.kind ?? 'text'),
        'data-id': String(node.attrs.id ?? ''),
        class: 'rc-legacy',
      },
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'rc-legacy'
      dom.setAttribute('contenteditable', 'false')
      dom.setAttribute('data-rc-legacy', '')
      const badge = document.createElement('div')
      badge.className = 'rc-legacy-badge'
      badge.textContent = '원본 보존 블록 — 선택하면 편집·변환 도구가 나타나요'
      const body = document.createElement('div')
      body.className = 'rc-legacy-body rc-content'
      body.innerHTML = sanitizeForPreview(String(node.attrs.html ?? ''))
      dom.append(badge, body)
      return { dom }
    }
  },
})
