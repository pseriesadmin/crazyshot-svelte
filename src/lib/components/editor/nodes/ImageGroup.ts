/**
 * ImageGroup — 이미지 묶음(ContentBlock 'image'와 1:1) TipTap 블록 노드 (atom).
 * layout: individual | collage | slide, images: [{url, alt, isHead?}]
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { imageBlockStyle, normalizeImageAlign, normalizeImageWidth, type ImageAlign, type ImageItem, type ImageLayout } from '$lib/types/content-editor'

export interface ImageGroupAttrs {
  layout: ImageLayout
  images: ImageItem[]
  width?: number
  align?: ImageAlign
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageGroup: {
      insertImageGroup: (attrs: ImageGroupAttrs) => ReturnType
    }
  }
}

function parseLayout(v: string | null): ImageLayout {
  return v === 'collage' || v === 'slide' ? v : 'individual'
}

function parseImages(v: string | null): ImageItem[] {
  if (!v) return []
  try {
    const arr: unknown = JSON.parse(v)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        url: typeof x.url === 'string' ? x.url : '',
        alt: typeof x.alt === 'string' ? x.alt : '',
        ...(x.isHead ? { isHead: true } : {}),
      }))
  } catch {
    return []
  }
}

export const ImageGroup = Node.create({
  name: 'imageGroup',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    // rendered:false — 값은 data-* 와 style로만 내보낸다(기본 렌더링은 layout="..." 같은 잡속성을 붙임)
    return {
      layout: { default: 'individual', rendered: false },
      images: { default: [], rendered: false },
      width: { default: 100, rendered: false },
      align: { default: 'center', rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-rc-image-group]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return {
            layout: parseLayout(e.getAttribute('data-layout')),
            images: parseImages(e.getAttribute('data-images')),
            width: normalizeImageWidth(e.getAttribute('data-width')),
            align: normalizeImageAlign(e.getAttribute('data-align')),
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const layout = parseLayout(node.attrs.layout as string)
    const images = (node.attrs.images as ImageItem[]) ?? []
    const width = normalizeImageWidth(node.attrs.width)
    const align = normalizeImageAlign(node.attrs.align)
    const style = imageBlockStyle(width, align)
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-rc-image-group': '',
        'data-layout': layout,
        'data-images': JSON.stringify(images),
        'data-width': String(width),
        'data-align': align,
        ...(style ? { style } : {}),
        class: `rc-images rc-images--${layout}`,
        contenteditable: 'false',
      }),
      ...images.map(
        (img, i): DOMOutputSpec => [
          'figure',
          { class: 'rc-fig', 'data-idx': String(i), ...(img.isHead ? { 'data-head': '1' } : {}) },
          ['img', { src: img.url, alt: img.alt ?? '', class: 'rc-img', draggable: 'false', loading: 'lazy' }],
        ],
      ),
    ]
  },

  addCommands() {
    return {
      insertImageGroup:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
