import { describe, it, expect } from 'vitest'
import { alignmentTransform, ALIGNMENT_STYLE_MAP } from '$lib/utils/docImport/docxImport'

// --------------------------------------------------------------------------
// docxImport.test.ts — alignmentTransform 단위 테스트
//
// mammoth 내부 단락 AST 구조를 모사해 변환 로직만 검증.
// 실제 .docx 파싱은 포함하지 않음(파일 픽스처 불필요).
// --------------------------------------------------------------------------

/** mammoth 단락 AST 생성 헬퍼 */
function makeParagraph(
  alignment: string | undefined,
  styleName?: string | null,
  styleId?: string | null,
) {
  return {
    type:      'paragraph',
    alignment: alignment ?? undefined,
    styleName: styleName ?? null,
    styleId:   styleId ?? null,
    children:  [] as unknown[],
  }
}

/** mammoth 문서 AST 생성 헬퍼 */
function makeDoc(paragraphs: ReturnType<typeof makeParagraph>[]) {
  return { type: 'document', children: paragraphs }
}

// --------------------------------------------------------------------------
// 단락 정렬 변환 — 합성 styleName 주입 검증
// --------------------------------------------------------------------------

describe('alignmentTransform — 합성 styleName 주입', () => {
  it('가운데 정렬(center) 일반 단락에 __cs_align_center__ 주입', () => {
    const doc = makeDoc([makeParagraph('center')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('__cs_align_center__')
  })

  it('오른쪽 정렬(right) 일반 단락에 __cs_align_right__ 주입', () => {
    const doc = makeDoc([makeParagraph('right')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('__cs_align_right__')
  })

  it('양쪽 정렬(both → justify) 일반 단락에 __cs_align_justify__ 주입', () => {
    const doc = makeDoc([makeParagraph('both')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('__cs_align_justify__')
  })

  it('균등 배분(distribute → justify) 일반 단락에 __cs_align_justify__ 주입', () => {
    const doc = makeDoc([makeParagraph('distribute')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('__cs_align_justify__')
  })

  it('정렬 없는 단락은 변경하지 않음', () => {
    const doc = makeDoc([makeParagraph(undefined)])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: null }> }
    expect(result.children[0].styleName).toBeNull()
  })

  it('왼쪽 정렬(left)은 CSS 기본값과 동일 — 합성 styleName 미주입', () => {
    // W_JC_TO_CSS에 'left' 없음 → 변경 없음
    const doc = makeDoc([makeParagraph('left')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: null }> }
    expect(result.children[0].styleName).toBeNull()
  })
})

// --------------------------------------------------------------------------
// Named 스타일(Heading 등) 보호 — styleName 덮어쓰기 금지
// --------------------------------------------------------------------------

describe('alignmentTransform — Named 스타일 보호', () => {
  it('Heading 1 단락은 center 정렬이 있어도 styleName을 유지', () => {
    const doc = makeDoc([makeParagraph('center', 'Heading 1', 'Heading1')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('Heading 1')
  })

  it('커스텀 스타일 단락은 center 정렬이 있어도 styleName을 유지', () => {
    const doc = makeDoc([makeParagraph('center', 'MyCustomStyle', 'MyCustomStyle')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('MyCustomStyle')
  })

  it('Normal 스타일은 일반 단락으로 취급 — 정렬 시 합성 styleName 주입', () => {
    const doc = makeDoc([makeParagraph('right', 'Normal', 'Normal')])
    const result = alignmentTransform(doc) as { children: Array<{ styleName: string }> }
    expect(result.children[0].styleName).toBe('__cs_align_right__')
  })
})

// --------------------------------------------------------------------------
// 중첩 자식 단락 처리 — transforms.paragraph의 재귀 처리 검증
// --------------------------------------------------------------------------

describe('alignmentTransform — 중첩 구조 처리', () => {
  it('표 > 행 > 셀 > 단락 구조에서도 정렬이 변환됨', () => {
    const innerParagraph = makeParagraph('center')
    const tableCell = { type: 'tableCell', children: [innerParagraph] }
    const tableRow  = { type: 'tableRow',  children: [tableCell] }
    const table     = { type: 'table',     children: [tableRow] }
    const doc       = makeDoc([table as unknown as ReturnType<typeof makeParagraph>])

    const result = alignmentTransform(doc) as {
      children: Array<{
        children: Array<{
          children: Array<{
            children: Array<{ styleName: string }>
          }>
        }>
      }>
    }
    const cellParagraph = result.children[0].children[0].children[0].children[0]
    expect(cellParagraph.styleName).toBe('__cs_align_center__')
  })
})

// --------------------------------------------------------------------------
// ALIGNMENT_STYLE_MAP 포맷 검증
// --------------------------------------------------------------------------

describe('ALIGNMENT_STYLE_MAP', () => {
  it('3개 규칙(center / right / justify) 모두 포함', () => {
    expect(ALIGNMENT_STYLE_MAP).toHaveLength(3)
  })

  it('text-align:center 규칙 포함', () => {
    expect(ALIGNMENT_STYLE_MAP.some((r) => r.includes("text-align:center"))).toBe(true)
  })

  it('text-align:right 규칙 포함', () => {
    expect(ALIGNMENT_STYLE_MAP.some((r) => r.includes("text-align:right"))).toBe(true)
  })

  it('text-align:justify 규칙 포함', () => {
    expect(ALIGNMENT_STYLE_MAP.some((r) => r.includes("text-align:justify"))).toBe(true)
  })

  it('각 규칙이 mammoth styleMap 형식(=> 구분자) 준수', () => {
    for (const rule of ALIGNMENT_STYLE_MAP) {
      expect(rule).toMatch(/=>/)
    }
  })
})
