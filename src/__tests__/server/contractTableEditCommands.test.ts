// @vitest-environment jsdom
/**
 * contractTableEditCommands.test.ts
 *
 * ContractDocumentEditor.svelte 표 편집 툴바에 새로 추가한 중급 편집 커맨드
 * (행/열 앞에 추가, 셀 병합/분할, 헤더열 토글)가 @tiptap/extension-table 스키마에서
 * 실제로 동작하는지 라이브 Editor 인스턴스로 검증한다(2026-08-15, Stephen 실사용 제보 —
 * "구글 워드·스프레드시트 기본 기능" 수준의 표 편집이 안 된다는 지적으로 발견한 기능
 * 공백. 커맨드 자체는 @tiptap/extension-table에 이미 구현돼 있었으나 툴바 버튼이 없어
 * 접근할 방법이 없었음).
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { TIPTAP_CONTRACT_EXTENSIONS } from '$lib/components/cms/contract-editor/tiptapExtensions.js'

function makeEditorWithTable(): Editor {
  return new Editor({
    extensions: TIPTAP_CONTRACT_EXTENSIONS,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
}

describe('표 편집 커맨드 — 행/열 앞에 추가', () => {
  it('addRowBefore로 현재 행 위에 새 행이 삽입된다', () => {
    const editor = makeEditorWithTable()
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()

    const before = editor.state.doc
    let rowCountBefore = 0
    before.descendants((node) => { if (node.type.name === 'tableRow') rowCountBefore++ })

    const ok = editor.chain().focus().addRowBefore().run()
    expect(ok).toBe(true)

    let rowCountAfter = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableRow') rowCountAfter++ })
    expect(rowCountAfter).toBe(rowCountBefore + 1)

    editor.destroy()
  })

  it('addColumnBefore로 현재 열 왼쪽에 새 열이 삽입된다', () => {
    const editor = makeEditorWithTable()
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()

    let firstRowCellCountBefore = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow' && firstRowCellCountBefore === 0) {
        firstRowCellCountBefore = node.childCount
      }
    })

    const ok = editor.chain().focus().addColumnBefore().run()
    expect(ok).toBe(true)

    let firstRowCellCountAfter = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow' && firstRowCellCountAfter === 0) {
        firstRowCellCountAfter = node.childCount
      }
    })
    expect(firstRowCellCountAfter).toBe(firstRowCellCountBefore + 1)

    editor.destroy()
  })
})

describe('표 편집 커맨드 — 셀 병합/분할', () => {
  it('여러 셀을 CellSelection으로 선택한 뒤 mergeCells 실행 시 셀 개수가 줄어든다', () => {
    const editor = makeEditorWithTable()
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()

    // 표의 첫 두 셀(같은 행)을 CellSelection으로 직접 구성 — 실제 사용자의 드래그 선택을
    // 재현(tableEditing() 플러그인이 마우스 드래그로 만드는 것과 동일한 selection 타입)
    let tablePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && tablePos === -1) tablePos = pos
    })
    expect(tablePos).toBeGreaterThanOrEqual(0)

    // 표 내부 첫 번째 셀과 두 번째 셀의 위치(CellSelection.create는 셀 노드 자체를
    // 가리키는 위치를 기대함 — 셀 콘텐츠 내부 위치(pos+1)가 아니라 노드 시작 위치(pos))
    const cellPositions: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cellPositions.push(pos)
    })
    expect(cellPositions.length).toBeGreaterThanOrEqual(2)

    const { state } = editor
    const selection = CellSelection.create(state.doc, cellPositions[0], cellPositions[1])
    editor.view.dispatch(state.tr.setSelection(selection))

    let cellCountBefore = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableCell') cellCountBefore++ })

    const merged = editor.chain().focus().mergeCells().run()
    expect(merged).toBe(true)

    let cellCountAfter = 0
    let mergedCellColspan = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') {
        cellCountAfter++
        if ((node.attrs['colspan'] as number) > 1) mergedCellColspan = node.attrs['colspan'] as number
      }
    })
    expect(cellCountAfter).toBe(cellCountBefore - 1) // 두 셀이 하나로 합쳐짐
    expect(mergedCellColspan).toBe(2)

    // 병합된 셀을 다시 분할하면 원래 셀 개수로 복원됨
    const split = editor.chain().focus().splitCell().run()
    expect(split).toBe(true)
    let cellCountFinal = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableCell') cellCountFinal++ })
    expect(cellCountFinal).toBe(cellCountBefore)

    editor.destroy()
  })
})

describe('표 편집 커맨드 — 헤더열 토글', () => {
  it('toggleHeaderColumn 실행 시 첫 번째 열의 셀이 tableHeader로 바뀐다', () => {
    const editor = makeEditorWithTable()
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()

    const ok = editor.chain().focus().toggleHeaderColumn().run()
    expect(ok).toBe(true)

    let headerCellCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableHeader') headerCellCount++ })
    expect(headerCellCount).toBeGreaterThan(0)

    editor.destroy()
  })
})
