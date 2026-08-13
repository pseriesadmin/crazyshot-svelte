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
 */
export const TIPTAP_CONTRACT_EXTENSIONS = [
  StarterKit,
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
  Image,
  MergeFieldNode,
]
