/**
 * YoutubeEmbed — 유튜브 동영상(ContentBlock 'youtube'와 1:1) TipTap 블록 노드 (atom).
 * 편집 화면에서는 썸네일 카드로 보이고, 상세 화면에서 iframe으로 재생된다.
 */
import { Node } from '@tiptap/core'

export interface YoutubeEmbedAttrs {
  videoId: string
  url: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    youtubeEmbed: {
      insertYoutubeEmbed: (attrs: YoutubeEmbedAttrs) => ReturnType
    }
  }
}

export const YoutubeEmbed = Node.create({
  name: 'youtubeEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: { default: '' },
      url: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-rc-youtube]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return { videoId: e.getAttribute('data-video-id') ?? '', url: e.getAttribute('data-url') ?? '' }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const id = String(node.attrs.videoId ?? '')
    return [
      'div',
      {
        'data-rc-youtube': '',
        'data-video-id': id,
        'data-url': String(node.attrs.url ?? ''),
        class: 'rc-youtube',
        contenteditable: 'false',
      },
      ['img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '유튜브 동영상', class: 'rc-yt-thumb', draggable: 'false' }],
      ['span', { class: 'rc-yt-badge' }, '▶ YouTube'],
    ]
  },

  addCommands() {
    return {
      insertYoutubeEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
