/**
 * tiptapExtensions.ts — 계약서 TipTap 에디터·렌더링 공유 확장 목록
 *
 * ContractDocumentEditor.svelte(에디터)와 tiptapRender.ts(정적 HTML 생성)가
 * 동일한 확장 설정을 공유하도록 여기서 단일 정의한다.
 *
 * 주의: parseStyleProp가 반환하는 함수는 HTML 파싱 시(parseHTML 콜백)에만 호출됨.
 * generateHTML() 호출 시엔 parseHTML이 실행되지 않으므로 SSR·Node.js 환경에서 안전.
 */

import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import { MergeFieldNode } from './nodes/MergeFieldNode'

// ────────────────────────────────────────────────────────────────────────────
// CustomImage 전용 파서 헬퍼
// ────────────────────────────────────────────────────────────────────────────

/**
 * img element 의 inline style / HTML 속성에서 px 너비를 읽는다.
 * parseHTML 콜백에서만 호출되므로 generateHTML(Node.js SSR) 시 실행되지 않음.
 */
function parseImgWidth(element: HTMLElement): number | null {
  const sw = element.style.getPropertyValue('width')
  if (sw && sw.endsWith('px')) {
    const v = parseInt(sw, 10)
    return isNaN(v) ? null : v
  }
  const aw = element.getAttribute('width')
  if (aw && /^\d+$/.test(aw)) return parseInt(aw, 10)
  return null
}

/**
 * img element 의 float style 에서 정렬값을 읽는다.
 * (renderHTML 에서 left → float:left / right → float:right / center → display:block;margin:0 auto 로 기록)
 */
function parseImgAlign(element: HTMLElement): 'left' | 'center' | 'right' {
  const f = element.style.getPropertyValue('float')
  if (f === 'left') return 'left'
  if (f === 'right') return 'right'
  return 'center'
}

/**
 * HTMLElement.style에서 특정 CSS 속성을 파싱하는 콜백 팩토리.
 * parseHTML에서만 사용되므로 generateHTML 호출 시 실행되지 않음.
 */
function parseStyleProp(prop: string) {
  return (element: HTMLElement): string | null =>
    element.style.getPropertyValue(prop) || null
}

/**
 * 표 셀 backgroundColor / borderColor 보존 확장.
 * 기본 @tiptap/extension-table-cell은 style 속성을 파싱하지 않아
 * HTML 파싱 시 셀 색상·테두리 정보가 버려짐 — 이 확장으로 보존.
 */
export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: parseStyleProp('background-color'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['backgroundColor']
            ? { style: `background-color: ${attrs['backgroundColor']}` }
            : {},
      },
      borderColor: {
        default: null,
        parseHTML: parseStyleProp('border-color'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['borderColor']
            ? { style: `border-color: ${attrs['borderColor']}` }
            : {},
      },
    }
  },
})

/**
 * 이미지 width · align · overlay 속성 보존 확장.
 *
 * 기본 @tiptap/extension-image 는 크기·정렬 정보를 보존하지 않아
 * 삽입 후 조절이 불가능 — 이 확장으로 속성들을 JSON·HTML 양쪽에 보존한다.
 *
 * overlay=true 시: position:absolute 로 텍스트 위에 겹치기 배치.
 *   x/y(px) 로 위치 지정. align 스타일은 overlay 시 적용하지 않음.
 * overlay=false(기본): 기존 align 기반 float/margin 인라인 배치.
 *
 * renderHTML: 각 속성이 { style: '...' }을 반환하며
 * TipTap 의 mergeAttributes()가 style 문자열을 ';'로 자동 합성한다.
 *
 * 에디터용 NodeView 는 ContractDocumentEditor.svelte 에서
 * CustomImage.extend({ addNodeView() {...} }) 로 별도 추가된다.
 * generateHTML()/tiptapRender.ts 경로는 NodeView 없이 이 renderHTML 만 사용한다.
 */
export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** 이미지 너비 (px 숫자). null → CSS 미설정(원본 크기) */
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => parseImgWidth(element),
        renderHTML: (attrs: Record<string, unknown>) => {
          const w = attrs['width'] as number | null
          return w ? { style: `width:${w}px;height:auto` } : {}
        },
      },
      /** 정렬: 'left' | 'center'(기본) | 'right' — overlay=true 시 적용 안 됨 */
      align: {
        default: 'center',
        parseHTML: (element: HTMLElement) => parseImgAlign(element),
        renderHTML: (attrs: Record<string, unknown>) => {
          // overlay 모드에서는 align 스타일 무시 (position:absolute가 대신 적용됨)
          if (attrs['overlay']) return {}
          const a = (attrs['align'] as string) || 'center'
          if (a === 'left') return { style: 'float:left;margin-right:8px' }
          if (a === 'right') return { style: 'float:right;margin-left:8px' }
          // center
          return { style: 'display:block;margin:0 auto' }
        },
      },
      /**
       * 겹치기 모드: true → position:absolute로 텍스트 위에 자유 배치
       * false(기본) → align 기반 인라인 배치 유지
       */
      overlay: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.style.getPropertyValue('position') === 'absolute',
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs['overlay']) return {}
          const x = (attrs['x'] as number) || 0
          const y = (attrs['y'] as number) || 0
          return { style: `position:absolute;left:${x}px;top:${y}px;z-index:10` }
        },
      },
      /** 겹치기 모드 X 좌표 (px, 에디터 .ProseMirror 기준) */
      x: {
        default: 0,
        parseHTML: (element: HTMLElement) => {
          const left = element.style.getPropertyValue('left')
          return left && left.endsWith('px') ? (parseInt(left, 10) || 0) : 0
        },
        renderHTML: () => ({}), // overlay renderHTML에서 통합 처리
      },
      /** 겹치기 모드 Y 좌표 (px, 에디터 .ProseMirror 기준) */
      y: {
        default: 0,
        parseHTML: (element: HTMLElement) => {
          const top = element.style.getPropertyValue('top')
          return top && top.endsWith('px') ? (parseInt(top, 10) || 0) : 0
        },
        renderHTML: () => ({}), // overlay renderHTML에서 통합 처리
      },
    }
  },
})

/**
 * 표 헤더 backgroundColor / borderColor 보존 확장.
 */
export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: parseStyleProp('background-color'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['backgroundColor']
            ? { style: `background-color: ${attrs['backgroundColor']}` }
            : {},
      },
      borderColor: {
        default: null,
        parseHTML: parseStyleProp('border-color'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs['borderColor']
            ? { style: `border-color: ${attrs['borderColor']}` }
            : {},
      },
    }
  },
})

/**
 * 계약서 TipTap 에디터·렌더링에 사용하는 확장 목록.
 * ContractDocumentEditor.svelte와 tiptapRender.ts가 동일한 리스트를 공유해
 * 에디터 렌더링 결과와 정적 HTML 생성 결과가 일치함을 보장한다.
 *
 * ⚠️ StarterKit(@tiptap/starter-kit v3)은 Link·Underline을 기본 번들에 포함한다
 * (v2에서는 없었음). 이 목록은 아래에서 Link/Underline을 별도 설정(openOnClick:false 등)으로
 * 다시 등록하므로, StarterKit 쪽 기본 인스턴스를 반드시 꺼야 한다 — 안 그러면 동일 이름
 * 확장이 중복 등록돼 "[tiptap warn]: Duplicate extension names found" 경고가 뜨고,
 * 두 인스턴스의 커맨드·키맵·플러그인이 함께 등록되어 예측 불가능한 동작(2026-08-15 실사용
 * 중 발견 — 표 편집 상호작용 이상 증상과 함께 확인된 근본 원인 후보)으로 이어질 수 있다.
 */
export const TIPTAP_CONTRACT_EXTENSIONS = [
  StarterKit.configure({ link: false, underline: false }),
  Underline,
  // tableCell / tableHeader 정렬도 TextAlign이 파싱·렌더링하도록 명시
  TextAlign.configure({ types: ['heading', 'paragraph', 'tableCell', 'tableHeader'] }),
  TextStyle,
  Color,
  FontFamily,
  Link.configure({ openOnClick: false }),
  Table.configure({ resizable: true }),
  TableRow,
  CustomTableHeader,
  CustomTableCell,
  CustomImage,          // Image → CustomImage (width·align 속성 추가)
  MergeFieldNode,
]
