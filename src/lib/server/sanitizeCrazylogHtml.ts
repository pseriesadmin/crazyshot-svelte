import sanitizeHtml from 'sanitize-html'
import { normalizeImageAlign, normalizeImageWidth } from '$lib/types/content-editor'

/**
 * 크레이지로그 본문 HTML 정화 (서버 전용, 2026-10-05).
 *
 * 배경: 본문(content_blocks의 text 블록 html)은 사용자가 쓴 HTML이 그대로 저장되고 상세 화면에서 {@html}로 출력된다.
 * 글 등록 RPC는 로그인한 누구나 직접 호출할 수 있어, 에디터를 거치지 않고 스크립트가 든 글을 올리면
 * 다른 방문자(관리자 포함)의 브라우저에서 실행될 수 있었다(저장형 XSS).
 *
 * 방식: 저장값은 건드리지 않고, 글을 화면으로 내려보내는 서버 로더에서 허용 목록 기준으로 정화한다.
 *  → 기존에 저장된 글도 한 번에 보호되고, 에디터가 만드는 서식(굵게·기울임·밑줄·정렬·글자 크기·서체·목록·인용·표·링크)은 유지된다.
 * 허용 밖: 스크립트·iframe·이벤트 속성(onerror 등)·javascript: 링크·위험한 style 값은 제거한다.
 */

const ALLOWED_TAGS = [
	'p', 'div', 'span', 'br', 'hr',
	'b', 'strong', 'i', 'em', 'u', 's', 'strike',
	'h1', 'h2', 'h3', 'h4',
	'ul', 'ol', 'li', 'blockquote',
	'a',
	'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i]
const LENGTH = /^\d{1,3}(\.\d+)?(px|em|rem|%)?$/

// 에디터(CmsContentEditor·RichContentEditor)가 만드는 서식만 허용 — 값은 정규식으로 한정(url()·expression() 등 차단)
const ALLOWED_STYLES = {
	'*': {
		'text-align': [/^(left|center|right|justify)$/],
		'font-size': [/^\d{1,3}(\.\d+)?(px|em|rem|%)$/],
		'font-family': [/^[\w\s,'"\-가-힣]+$/],
		'font-weight': [/^(normal|bold|[1-9]00)$/],
		'font-style': [/^(normal|italic)$/],
		'text-decoration': [/^(none|underline|line-through|underline line-through)$/],
		'color': COLOR,
		'background-color': COLOR,
		'background': [/^#[0-9a-f]{3,8}$/i],
		'line-height': [LENGTH],
		'padding': [/^(\d{1,3}(\.\d+)?(px|em|rem|%)?\s*){1,4}$/],
		'padding-left': [/^\d{1,2}(\.\d+)?em$/], // 새 에디터 들여쓰기(2em 단위)
		'border': [/^\d{1,2}px\s+(solid|dashed|dotted|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
		'border-collapse': [/^(collapse|separate)$/],
		'width': [/^\d{1,3}(\.\d+)?(px|%)$/],
	},
}

const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: ALLOWED_TAGS,
	allowedAttributes: {
		a: ['href', 'target', 'rel'],
		th: ['colspan', 'rowspan', 'style'],
		td: ['colspan', 'rowspan', 'style'],
		table: ['style', 'class'],
		'*': ['style'],
	},
	allowedClasses: { table: ['cs-contract-table'] },
	allowedStyles: ALLOWED_STYLES,
	allowedSchemes: ['http', 'https', 'mailto', 'tel'],
	allowProtocolRelative: false,
	disallowedTagsMode: 'discard',
	// 링크는 항상 새 창 + opener 차단(사용자 링크로 인한 탭 탈취·추천 정보 노출 방지)
	transformTags: {
		a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow ugc' }),
	},
}

/** 본문 HTML 문자열 하나를 정화한다. 문자열이 아니면 빈 문자열. */
export function sanitizeCrazylogHtml(html: unknown): string {
	if (typeof html !== 'string' || html === '') return ''
	return sanitizeHtml(html, OPTIONS)
}

/**
 * content_blocks 배열에서 HTML을 담는 블록(text.html · html.content)만 정화하고 나머지(이미지·유튜브·구분선 등)는 그대로 둔다.
 * 원본 배열·객체는 바꾸지 않고 새 배열을 돌려준다. 배열이 아니면 그대로 반환.
 */
export function sanitizeCrazylogBlocks(blocks: unknown): unknown {
	if (!Array.isArray(blocks)) return blocks
	return blocks.map((block) => {
		if (!block || typeof block !== 'object') return block
		const b = block as Record<string, unknown>
		if (b.type === 'text') return { ...b, html: sanitizeCrazylogHtml(b.html) }
		if (b.type === 'html') return { ...b, content: sanitizeCrazylogHtml(b.content) }
		// 이미지 묶음의 폭·정렬은 화면 스타일로 쓰이므로 허용 범위로 한정(없으면 그대로 둠)
		if (b.type === 'image' && ('width' in b || 'align' in b)) {
			const { width: _w, align: _a, ...rest } = b
			return {
				...rest,
				...('width' in b ? { width: normalizeImageWidth(b.width) } : {}),
				...('align' in b ? { align: normalizeImageAlign(b.align) } : {}),
			}
		}
		return block
	})
}
