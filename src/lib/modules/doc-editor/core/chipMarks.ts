/**
 * chipMarks.ts — 변수 칩이 값으로 치환될 때 이어받을 글자 서식(marks) 결정 (doc-editor core, 순수 함수)
 *
 * 변수 칩(mergeField)을 값 글자로 바꿀 때 칩 자신의 서식이 있으면 그대로, 없으면(옛 양식·한글 가져오기 문서 등)
 * 같은 문단 안 가장 가까운 앞 글자(없으면 뒤 글자)의 서식을 이어받는다 — 값이 주변 글자와 같은 글꼴·크기·굵기로 보이게 하기 위함.
 * 링크(link)는 값까지 번지지 않도록 제외한다.
 */
import type { JSONContent } from '@tiptap/core'

type Marks = NonNullable<JSONContent['marks']>

function withoutLink(marks: JSONContent['marks']): Marks | undefined {
  const m = (marks ?? []).filter((x) => x.type !== 'link')
  return m.length > 0 ? m : undefined
}

function nearestTextMarks(children: JSONContent[], from: number, step: 1 | -1): { found: boolean; marks?: Marks } {
  for (let i = from + step; i >= 0 && i < children.length; i += step) {
    const c = children[i]!
    if (c.type === 'text' && (c.text ?? '').length > 0) return { found: true, marks: withoutLink(c.marks) }
  }
  return { found: false }
}

/** children[index] 의 mergeField 가 치환될 때 붙일 marks (없으면 undefined) */
export function marksForChip(children: JSONContent[], index: number): Marks | undefined {
  const own = withoutLink(children[index]?.marks)
  if (own) return own
  const before = nearestTextMarks(children, index, -1)
  if (before.found) return before.marks
  return nearestTextMarks(children, index, 1).marks
}
