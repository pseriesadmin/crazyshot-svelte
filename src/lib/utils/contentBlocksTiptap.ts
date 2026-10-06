/**
 * contentBlocksTiptap.ts — ContentBlock[] ↔ TipTap 문서 변환 + 충실도(무손실) 판정.
 *
 * 저장 형식(ContentBlock[])은 그대로 두고, 편집만 새 에디터(단일 문서)에서 한다.
 *  - blocksToDoc : 불러올 때. 글자·서식을 손실 없이 옮길 수 있는 text 블록만 문서 노드로 변환하고,
 *                  그렇지 않은 text 블록·html 블록은 LegacyHtml(원본 보존) 노드에 원본 그대로 담는다.
 *  - docToBlocks : 저장할 때. 연속된 텍스트 노드는 하나의 text 블록으로, 미디어/보존 노드는 각자의 블록으로 되돌린다.
 *
 * ⛔ 브라우저(DOM) 전용 — DOMParser / generateHTML이 document를 쓴다. SSR에서 호출하지 말 것(onMount 이후에만).
 */
import { generateHTML, generateJSON } from '@tiptap/core'
import type { Extensions, JSONContent } from '@tiptap/core'
import { IMAGE_WIDTH_MAX, normalizeImageAlign, normalizeImageWidth, type ContentBlock, type ImageItem, type ImageLayout } from '$lib/types/content-editor'
import { createRichExtensions } from '$lib/components/editor/extensions'

let cachedExtensions: Extensions | null = null
function exts(): Extensions {
  return (cachedExtensions ??= createRichExtensions())
}

// ── 텍스트 지문 ─────────────────────────────────────────────

/** HTML의 글자(textContent)를 공백·NBSP·제로폭 문자를 정규화해 비교 가능한 문자열로 만든다. */
export function textFingerprint(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return (doc.body.textContent ?? '')
    .replace(/[ ​‌‍﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 공백을 전부 제거한 글자 지문(블록 경계 차이에 영향받지 않는 비교용). */
function squash(s: string): string {
  return s.replace(/[\s ​‌‍﻿]+/g, '')
}

// ── 레거시 HTML 정규화 ──────────────────────────────────────

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr'])
const BLOCK_ANCESTOR = 'p,div,h1,h2,h3,li,blockquote,td,th'

function hasBlockDescendant(el: Element): boolean {
  return Array.from(el.querySelectorAll('*')).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))
}

/**
 * 기존 에디터(contenteditable) 산출물을 ProseMirror가 서식을 잃지 않고 읽을 수 있는 모양으로 바꾼다.
 *  - <div style="text-align:…"> → <p> (div는 파서가 풀어헤쳐 정렬이 사라진다)
 *  - span에 붙은 text-align을 상위 블록으로 승격
 *  - <p><br></p> → 빈 문단
 */
export function normalizeLegacyHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const root = doc.body

  root.querySelectorAll<HTMLElement>('span').forEach((span) => {
    const ta = span.style.textAlign
    if (!ta) return
    const block = span.closest<HTMLElement>(BLOCK_ANCESTOR)
    if (block && root.contains(block) && !block.style.textAlign) block.style.textAlign = ta
    span.style.removeProperty('text-align')
    if (!span.getAttribute('style')) span.removeAttribute('style')
  })

  Array.from(root.querySelectorAll('div'))
    .reverse()
    .forEach((div) => {
      if (!hasBlockDescendant(div)) {
        const p = doc.createElement('p')
        const style = div.getAttribute('style')
        if (style) p.setAttribute('style', style)
        while (div.firstChild) p.appendChild(div.firstChild)
        div.replaceWith(p)
        return
      }
      const ta = div.style.textAlign
      if (ta) {
        Array.from(div.children).forEach((child) => {
          if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName.toLowerCase()) && !child.style.textAlign) {
            child.style.textAlign = ta
          }
        })
      }
      div.replaceWith(...Array.from(div.childNodes))
    })

  root.querySelectorAll('p').forEach((p) => {
    if (p.childNodes.length === 1 && p.firstChild instanceof HTMLElement && p.firstChild.tagName === 'BR') p.firstChild.remove()
  })

  return root.innerHTML
}

// ── 충실도 판정 ─────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'p', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
])
const BLOCK_STYLE_PROPS = new Set(['text-align', 'padding-left'])
const SPAN_STYLE_PROPS = new Set(['font-size', 'font-family', 'color', 'background-color', 'font-weight', 'font-style', 'text-decoration'])
const ALLOWED_ATTRS = new Set(['style', 'href', 'target', 'rel', 'colspan', 'rowspan'])

/** 정규화된 HTML에 새 에디터가 표현하지 못하는 요소·속성·스타일이 있으면 사유를, 없으면 null을 돌려준다. */
function findUnsupported(normalizedHtml: string): string | null {
  const doc = new DOMParser().parseFromString(`<body>${normalizedHtml}</body>`, 'text/html')
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    const tag = el.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return `tag:${tag}`
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) return `attr:${attr.name}`
    }
    const style = el.getAttribute('style')
    if (style) {
      const allowed = tag === 'span' ? SPAN_STYLE_PROPS : tag === 'p' || /^h[1-3]$/.test(tag) ? BLOCK_STYLE_PROPS : null
      if (!allowed) return `style-on:${tag}`
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style.item(i)
        if (!allowed.has(prop)) return `style:${prop}`
      }
      // 파서가 인식하지 못해 CSSStyleDeclaration에 담기지 않은 선언(예: CSS 변수)도 걸러낸다.
      const declared = style.split(';').map((d) => d.trim()).filter(Boolean).length
      if (declared > el.style.length) return 'style:unparsed'
    }
    if (tag === 'a' && !el.getAttribute('href')) return 'a:no-href'
  }
  return null
}

export interface FidelityResult {
  convertible: boolean
  reason?: string
}

function convertText(html: string): { json: JSONContent[]; reason?: undefined } | { json: null; reason: string } {
  const normalized = normalizeLegacyHtml(html)
  const risk = findUnsupported(normalized)
  if (risk) return { json: null, reason: risk }
  const doc = generateJSON(normalized, exts()) as JSONContent
  const back = generateHTML(doc, exts())
  if (textFingerprint(html) !== textFingerprint(back)) return { json: null, reason: 'text-mismatch' }
  return { json: doc.content ?? [] }
}

/** text 블록 HTML을 새 문서로 옮겼다가 되돌렸을 때 글자가 같은지·표현 불가 요소가 없는지 판정한다. */
export function classifyBlockFidelity(html: string): FidelityResult {
  if (!html || !html.trim()) return { convertible: true }
  const r = convertText(html)
  return r.json ? { convertible: true } : { convertible: false, reason: r.reason }
}

/** 강제 변환 미리보기용 — 판정과 무관하게 변환 결과 HTML과 글자 일치 여부를 돌려준다. */
export function previewConversion(html: string): { html: string; doc: JSONContent; textMatches: boolean } {
  const doc = generateJSON(normalizeLegacyHtml(html), exts()) as JSONContent
  const back = generateHTML(doc, exts())
  return { html: back, doc, textMatches: textFingerprint(html) === textFingerprint(back) }
}

// ── blocks → doc ────────────────────────────────────────────

export function blocksToDoc(blocks: ContentBlock[]): JSONContent {
  const content: JSONContent[] = []
  blocks.forEach((b, i) => {
    switch (b.type) {
      case 'text': {
        const html = b.html ?? ''
        if (!html.trim()) break
        const r = convertText(html)
        if (r.json) content.push(...r.json)
        else content.push({ type: 'legacyHtml', attrs: { html, kind: 'text', id: `lg-${i}` } })
        break
      }
      case 'html': {
        if (!(b.content ?? '').trim()) break
        content.push({ type: 'legacyHtml', attrs: { html: b.content, kind: 'html', id: `lg-${i}` } })
        break
      }
      case 'image':
        content.push({ type: 'imageGroup', attrs: { layout: b.layout, images: b.images ?? [], width: normalizeImageWidth(b.width), align: normalizeImageAlign(b.align) } })
        break
      case 'youtube':
        if (b.videoId) content.push({ type: 'youtubeEmbed', attrs: { videoId: b.videoId, url: b.url ?? '' } })
        break
      case 'divider':
        content.push({ type: 'horizontalRule' })
        break
      default:
        break // link-entry: 저장 대상이 아닌 미완성 입력폼
    }
  })
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

// ── doc → blocks ────────────────────────────────────────────

function isEmptyParagraph(n: JSONContent): boolean {
  return n.type === 'paragraph' && (!n.content || n.content.length === 0)
}

/** 빈 문단 <p></p>는 상세 화면에서 높이가 0으로 접히므로 <br>을 채워 편집 화면과 같은 한 줄을 유지한다. */
function fillEmptyParagraphs(html: string): string {
  return html.replace(/<p((?:\s[^>]*)?)><\/p>/g, '<p$1><br></p>')
}

export function docToBlocks(doc: JSONContent): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let run: JSONContent[] = []
  const flush = () => {
    if (run.length > 0 && !run.every(isEmptyParagraph)) {
      blocks.push({ type: 'text', html: fillEmptyParagraphs(generateHTML({ type: 'doc', content: run }, exts())) })
    }
    run = []
  }
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case 'imageGroup': {
        flush()
        const attrs = node.attrs ?? {}
        const layout = (attrs.layout === 'collage' || attrs.layout === 'slide' ? attrs.layout : 'individual') as ImageLayout
        const width = normalizeImageWidth(attrs.width)
        const align = normalizeImageAlign(attrs.align)
        blocks.push({
          type: 'image',
          layout,
          images: ((attrs.images as ImageItem[]) ?? []).map((x) => ({ ...x })),
          // 기본값(100%·가운데)이면 쓰지 않아 기존 저장 형식과 바이트 호환
          ...(width < IMAGE_WIDTH_MAX ? { width } : {}),
          ...(align !== 'center' ? { align } : {}),
        })
        break
      }
      case 'youtubeEmbed': {
        flush()
        blocks.push({ type: 'youtube', videoId: String(node.attrs?.videoId ?? ''), url: String(node.attrs?.url ?? '') })
        break
      }
      case 'legacyHtml': {
        flush()
        const html = String(node.attrs?.html ?? '')
        blocks.push(node.attrs?.kind === 'html' ? { type: 'html', content: html } : { type: 'text', html })
        break
      }
      case 'horizontalRule':
        flush()
        blocks.push({ type: 'divider' })
        break
      default:
        run.push(node)
    }
  }
  flush()
  return blocks.length > 0 ? blocks : [{ type: 'text', html: '' }]
}

// ── 저장 직전 누락 점검 ─────────────────────────────────────

function docChunks(node: JSONContent, out: string[]): void {
  if (node.type === 'text') out.push(node.text ?? '')
  else if (node.type === 'legacyHtml') out.push(textFingerprint(String(node.attrs?.html ?? '')))
  if (node.content) node.content.forEach((c) => docChunks(c, out))
}

function blocksChunks(blocks: ContentBlock[]): string[] {
  return blocks.map((b) => (b.type === 'text' ? textFingerprint(b.html) : b.type === 'html' ? textFingerprint(b.content) : ''))
}

/** 편집 문서의 글자와, 그 문서를 저장 형식(ContentBlock[])으로 바꾼 결과의 글자가 같은지 확인한다. */
export function verifySerialization(doc: JSONContent): { ok: boolean; blocks: ContentBlock[] } {
  const blocks = docToBlocks(doc)
  const docText: string[] = []
  docChunks(doc, docText)
  return { ok: squash(docText.join('')) === squash(blocksChunks(blocks).join('')), blocks }
}

/** 두 블록 배열의 글자가 같은지(공백 무시) — 감사 스크립트·테스트용. */
export function blocksTextEqual(a: ContentBlock[], b: ContentBlock[]): boolean {
  return squash(blocksChunks(a).join('')) === squash(blocksChunks(b).join(''))
}
