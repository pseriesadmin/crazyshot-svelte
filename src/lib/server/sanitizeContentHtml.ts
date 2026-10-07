import sanitizeHtml from 'sanitize-html'
import {
  normalizeImageAlign,
  normalizeImageWidth,
  type ContentBlock,
  type ImageItem,
} from '$lib/types/content-editor'

/**
 * 상품설명·구독 설명(CMS 작성 콘텐츠) 고객 화면용 HTML 정화 — 서버 전용 (2026-10-06).
 *
 * 배경: products/[id]·subscribe/[planId]가 본문(text.html · html.content)을 {@html}로 그대로 출력해 저장형 XSS가 가능했다.
 * sanitizeCrazylogHtml(크레이지로그: 일반 사용자 작성)은 에디터가 만드는 서식만 허용하는 "좁은 허용 목록"이지만,
 * 이쪽은 CMS 관리자가 Gemini·ChatGPT·imweb 등에서 복사해 붙인 HTML이 대부분이라 좁은 목록을 쓰면 고객이 보는 모양이 바뀐다.
 * → "겉모양은 유지하고 실행 가능한 요소만 제거"하는 넓은 허용 목록(권한 있는 작성자용)을 따로 둔다.
 *
 * 허용: 일반 서식 태그 전부(font·sup·sub·h1~h6·pre·code·table 계열·figure…), class·style·data-*·aria-*,
 *       https/http 이미지, http/https/mailto/tel 링크
 * 제거: script·iframe·object·embed·style·link·meta·base·form 요소 일체, 이벤트 속성(on*), javascript:·data: 링크,
 *       style 안의 url()·expression()·behavior·@import·역슬래시 이스케이프·position:fixed/sticky 선언
 * 저장값은 건드리지 않는다(로더에서 화면으로 내려보낼 때만 정화) — 기존 글도 한 번에 보호된다.
 */

const TAGS = [
  'p', 'div', 'span', 'br', 'hr', 'center',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'big', 'abbr', 'cite', 'q', 'time', 'var', 'kbd', 'samp',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code',
  'a', 'font', 'img', 'figure', 'figcaption', 'picture', 'source',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary',
]

const SAFE_STYLE_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|\\|<|>)).*$/i
const BLOCKED_STYLE_PROP = /^(?:behavior|-moz-binding)$/i

/** style 속성에서 위험한 선언만 걸러낸다(나머지 선언은 그대로 — 겉모양 유지). */
export function cleanStyleAttribute(style: string): string {
  const kept: string[] = []
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (!prop || !value) continue
    // 속성명은 영문·숫자·하이픈(CSS 변수 --x 포함)만 — 역슬래시 이스케이프(pos\69tion)로 차단 우회 방지
    if (!/^[a-z0-9-]+$/i.test(prop)) continue
    if (BLOCKED_STYLE_PROP.test(prop)) continue
    if (!SAFE_STYLE_VALUE.test(value)) continue
    // 화면 위 덮어쓰기(클릭 가로채기) 방지 — !important·주석을 걷어낸 값으로 비교
    const plainValue = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/!\s*important/gi, '').trim()
    if (/^position$/i.test(prop) && /^(?:-webkit-)?(fixed|sticky)\b/i.test(plainValue)) continue
    kept.push(`${prop}: ${value}`)
  }
  return kept.join('; ')
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: {
    '*': ['style', 'class', 'title', 'lang', 'dir', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'color', 'face', 'size', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'data-*', 'aria-*', 'role'],
    a: ['href', 'target', 'rel', 'name', 'title', 'class', 'style', 'data-*', 'aria-*'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'class', 'style', 'data-*'],
    source: ['srcset', 'media', 'type'],
    ol: ['start', 'type', 'reversed', 'class', 'style'],
    li: ['value', 'class', 'style'],
    time: ['datetime'],
    details: ['open', 'class', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https', 'http'], source: ['https', 'http'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // 알 수 없는 태그(Gemini의 Angular 커스텀 요소 등)는 태그만 버리고 안의 글자는 유지한다(브라우저도 인라인으로 그렸음)
  transformTags: {
    '*': (tagName, attribs) => {
      if (typeof attribs.style === 'string') {
        const cleaned = cleanStyleAttribute(attribs.style)
        if (cleaned) attribs.style = cleaned
        else delete attribs.style
      }
      return { tagName, attribs }
    },
    a: (tagName, attribs) => {
      const out = { ...attribs }
      if (typeof out.style === 'string') {
        const cleaned = cleanStyleAttribute(out.style)
        if (cleaned) out.style = cleaned
        else delete out.style
      }
      // 새 창으로 열리는 링크는 opener 차단(탭 탈취·추천 정보 노출 방지)
      if (out.target && out.target !== '_self') {
        out.target = '_blank'
        out.rel = 'noopener noreferrer'
      } else {
        delete out.target
      }
      return { tagName, attribs: out }
    },
  },
}

/** 본문 HTML 문자열 하나를 정화한다. 문자열이 아니면 빈 문자열. */
export function sanitizeContentHtml(html: unknown): string {
  if (typeof html !== 'string' || html === '') return ''
  return sanitizeHtml(html, OPTIONS)
}

// ── ContentBlock[] ─────────────────────────────────────────

const YOUTUBE_ID = /^[\w-]{11}$/
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:)/i
// 사이트 내부 경로는 '/'로 시작하되 '//'(프로토콜 상대 = 외부 호스트)는 제외
const SAFE_IMG_URL = /^(?:https?:\/\/|\/(?!\/))/i

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function sanitizeImageItems(items: unknown): ImageItem[] {
  if (!Array.isArray(items)) return []
  const out: ImageItem[] = []
  for (const it of items) {
    if (!isObj(it) || typeof it.url !== 'string' || !SAFE_IMG_URL.test(it.url.trim())) continue
    out.push({
      url: it.url.trim(),
      alt: typeof it.alt === 'string' ? it.alt : '',
      ...(it.isHead ? { isHead: true } : {}),
    })
  }
  return out
}

/**
 * content_blocks를 고객 화면용으로 정화한다.
 *  - text.html · html.content : sanitizeContentHtml
 *  - image : 이미지 주소는 http(s)·사이트 내부 경로만, 폭·정렬은 허용 범위로 한정
 *  - youtube : 영상 ID가 11자 영숫자·-·_ 가 아니면 블록 제거
 *  - link-entry : 주소가 http(s)·mailto·tel 이 아니면 블록 제거
 *  - divider : 그대로 / 알 수 없는 type : 제거
 * 원본 배열·객체는 바꾸지 않고 새 배열을 돌려준다. 배열이 아니면 빈 배열.
 */
export function sanitizeContentBlocks(blocks: unknown): ContentBlock[] {
  if (!Array.isArray(blocks)) return []
  const out: ContentBlock[] = []
  for (const raw of blocks) {
    if (!isObj(raw)) continue
    switch (raw.type) {
      case 'text':
        out.push({ type: 'text', html: sanitizeContentHtml(raw.html) })
        break
      case 'html':
        out.push({ type: 'html', content: sanitizeContentHtml(raw.content) })
        break
      case 'image': {
        const layout = raw.layout === 'collage' || raw.layout === 'slide' ? raw.layout : 'individual'
        const hasW = 'width' in raw
        const hasA = 'align' in raw
        out.push({
          type: 'image',
          layout,
          images: sanitizeImageItems(raw.images),
          ...(hasW ? { width: normalizeImageWidth(raw.width) } : {}),
          ...(hasA ? { align: normalizeImageAlign(raw.align) } : {}),
        })
        break
      }
      case 'youtube':
        if (typeof raw.videoId === 'string' && YOUTUBE_ID.test(raw.videoId)) {
          out.push({ type: 'youtube', videoId: raw.videoId, url: typeof raw.url === 'string' ? raw.url : '' })
        }
        break
      case 'divider':
        out.push({ type: 'divider' })
        break
      case 'link-entry':
        if (typeof raw.url === 'string' && SAFE_URL.test(raw.url.trim())) {
          out.push({ type: 'link-entry', url: raw.url.trim(), text: typeof raw.text === 'string' ? raw.text : '' })
        }
        break
      default:
        break
    }
  }
  return out
}
