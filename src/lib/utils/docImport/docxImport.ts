/**
 * docxImport.ts — mammoth 기반 .docx → HTML 변환
 *
 * 클라이언트 전용 (브라우저에서 mammoth 실행).
 * 서버 측 파싱 없음 — 결과 HTML은 기존 PATCH /api/cms/contracts/[id]/content 로 저장.
 *
 * 서식 보존 범위:
 *   단락 정렬(center/right/justify)  → 일반 단락(Named 스타일 없음)만 보존
 *   표 셀 배경색 / 테두리 색         → jszip + DOMParser로 OOXML 직접 추출 후 주입
 *                                       (mammoth AST 우회 방식)
 */

import mammoth from 'mammoth'
import {
  extractTableFormatting,
  injectTableFormattingIntoHtml,
} from './docxTableFormatting'

// --------------------------------------------------------------------------
// mammoth.transforms 타입 확장
// (공식 TS 정의에 없으나 JS export에는 존재: lib/index.js line 17)
// --------------------------------------------------------------------------
interface MammothParagraphEl {
  type: string
  alignment?: string
  styleName?: string | null
  styleId?: string | null
  children?: unknown[]
  [key: string]: unknown
}

interface MammothWithTransforms {
  transforms: {
    paragraph: (
      fn: (el: MammothParagraphEl) => MammothParagraphEl,
    ) => (doc: unknown) => unknown
  }
}

// mammoth의 JS export에는 transforms가 있으나 TS 정의에는 없음 — 인터페이스로 안전 확장
const mammothEx = mammoth as unknown as MammothWithTransforms

// --------------------------------------------------------------------------
// 정렬 변환 상수
// --------------------------------------------------------------------------

/** Word XML w:jc 값 → CSS text-align 값 */
const W_JC_TO_CSS: Record<string, string> = {
  center:     'center',
  right:      'right',
  both:       'justify',   // Word '양쪽 정렬'은 both로 저장
  distribute: 'justify',   // 동아시아 균등 배분 정렬
}

/** mammoth AST에 주입할 합성 styleName — 실제 Word 스타일명과 충돌 방지용 접두사 */
const CS_ALIGN_STYLE = {
  center:  '__cs_align_center__',
  right:   '__cs_align_right__',
  justify: '__cs_align_justify__',
} as const

/**
 * mammoth styleMap 항목 — 합성 스타일명 → 인라인 style 속성 포함 <p> 출력.
 * custom styleMap이 default styleMap보다 먼저 적용되므로(options-reader.js)
 * 일반 단락의 합성 이름은 이 규칙으로 처리되고, 제목(Heading 1~6)은
 * 원본 styleName이 유지되어 기본 스타일맵 규칙으로 처리된다.
 */
export const ALIGNMENT_STYLE_MAP = [
  `p[style-name='${CS_ALIGN_STYLE.center}']  => p[style='text-align:center']`,
  `p[style-name='${CS_ALIGN_STYLE.right}']   => p[style='text-align:right']`,
  `p[style-name='${CS_ALIGN_STYLE.justify}'] => p[style='text-align:justify']`,
]

/**
 * mammoth transformDocument 콜백 — 직접 서식(direct formatting) 정렬이 적용된
 * 일반 단락에 합성 styleName을 주입해 styleMap이 인라인 CSS를 출력하도록 한다.
 *
 * 주의사항:
 *   - Named Word 스타일(Heading 1~6, Custom 스타일)이 있는 단락은 원본 styleName을
 *     유지해 mammoth 기본 스타일맵(h1~h6 등)이 정상 동작하도록 한다.
 *   - 표 셀 배경색 / 테두리 색은 mammoth가 AST 자체에서 캡처하지 않아
 *     이 변환으로도 처리 불가(mammoth 라이브러리 근본 한계).
 */
export function alignmentTransform(document: unknown): unknown {
  return mammothEx.transforms.paragraph((paragraph: MammothParagraphEl) => {
    if (!paragraph.alignment) return paragraph

    const cssAlign = W_JC_TO_CSS[paragraph.alignment]
    if (!cssAlign) return paragraph

    // Named 스타일(Heading 1, Custom 등)이 있는 단락은 styleName 유지
    const hasNamedStyle =
      paragraph.styleName && paragraph.styleName !== 'Normal'
    if (hasNamedStyle) return paragraph

    const syntheticName = CS_ALIGN_STYLE[cssAlign as keyof typeof CS_ALIGN_STYLE]
    if (!syntheticName) return paragraph

    return { ...paragraph, styleName: syntheticName, styleId: undefined }
  })(document)
}

// --------------------------------------------------------------------------
// 공개 API
// --------------------------------------------------------------------------

export interface DocxImportResult {
  /** mammoth 변환 결과 HTML */
  html: string
  /** 변환 중 발생한 경고 메시지 (서식 손실 등) */
  warnings: string[]
}

/**
 * .docx 파일을 HTML로 변환한다.
 *
 * 단락 정렬(일반 단락만)은 인라인 style로 보존된다.
 * 표 셀 배경색·테두리색은 jszip + DOMParser로 OOXML을 직접 읽어 mammoth 출력에 주입된다.
 * XML과 HTML의 표/행/셀 개수가 불일치하는 표는 서식 주입 없이 그대로 출력된다.
 *
 * @param file - .docx File 객체
 * @returns 변환된 HTML과 경고 목록
 * @throws mammoth 파싱 실패 시 에러
 */
export async function importDocx(file: File): Promise<DocxImportResult> {
  const arrayBuffer = await file.arrayBuffer()

  // mammoth 변환과 OOXML 표 서식 추출을 병렬 실행 (동일 buffer, 독립 처리)
  const [mammothResult, tableFormatting] = await Promise.all([
    mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap:          ALIGNMENT_STYLE_MAP,
        transformDocument: alignmentTransform,
      },
    ),
    extractTableFormatting(arrayBuffer),
  ])

  const warnings = mammothResult.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message)

  // 표 셀 서식(배경색·테두리색)을 mammoth HTML에 주입
  const html =
    tableFormatting.length > 0
      ? injectTableFormattingIntoHtml(mammothResult.value, tableFormatting)
      : mammothResult.value

  return { html, warnings }
}
