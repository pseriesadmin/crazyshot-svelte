// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SpreadsheetDocument } from '$lib/types/contract-document'
import {
  saveSheetDraft,
  loadSheetDraft,
  clearSheetDraft,
  isValidDraftDocument,
  SHEET_DRAFT_MAX_AGE_MS,
  SHEET_DRAFT_MAX_CHARS,
} from '$lib/utils/contractSheetDraft'
import { registerUnsavedProbe, confirmDiscardUnsaved } from '$lib/utils/contractUnsavedGuard'

const DOC: SpreadsheetDocument = {
  activeSheetIndex: 0,
  sheets: [{ name: 'S', rows: [['a', 'b']], merges: [], colWidths: [null, null], cellFormatting: [[{}, {}]] }],
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('임시저장 — 저장·복구', () => {
  it('저장한 내용을 그대로 읽는다', () => {
    expect(saveSheetDraft('t1', { title: '제목', doc: DOC })).toBe('ok')
    const d = loadSheetDraft('t1')
    expect(d?.title).toBe('제목')
    expect(d?.doc).toEqual(DOC)
    expect(typeof d?.savedAt).toBe('number')
  })
  it('양식별로 따로 보관한다(new 포함)', () => {
    saveSheetDraft('t1', { title: 'A', doc: DOC })
    saveSheetDraft('new', { title: 'B', doc: DOC })
    expect(loadSheetDraft('t1')?.title).toBe('A')
    expect(loadSheetDraft('new')?.title).toBe('B')
    expect(loadSheetDraft('t2')).toBeNull()
  })
  it('DB 저장본보다 오래된 임시저장은 버린다', () => {
    saveSheetDraft('t1', { title: 'A', doc: DOC })
    expect(loadSheetDraft('t1', { notBefore: Date.now() + 60_000 })).toBeNull()
    expect(loadSheetDraft('t1')).toBeNull() // 지워졌다
  })
  it('7일이 지난 임시저장은 버린다', () => {
    saveSheetDraft('t1', { title: 'A', doc: DOC })
    expect(loadSheetDraft('t1', { now: Date.now() + SHEET_DRAFT_MAX_AGE_MS + 1000 })).toBeNull()
  })
  it('손상된 값은 버리고 편집기를 깨뜨리지 않는다', () => {
    localStorage.setItem('cs-contract-sheet-draft:v1:t1', '{not json')
    expect(loadSheetDraft('t1')).toBeNull()
    localStorage.setItem('cs-contract-sheet-draft:v1:t2', JSON.stringify({ savedAt: Date.now(), title: 'x', doc: { sheets: [{ name: 'S', rows: 'oops' }], activeSheetIndex: 0 } }))
    expect(loadSheetDraft('t2')).toBeNull()
    expect(localStorage.getItem('cs-contract-sheet-draft:v1:t2')).toBeNull()
  })
  it('문서 구조 검사', () => {
    expect(isValidDraftDocument(DOC)).toBe(true)
    expect(isValidDraftDocument({ sheets: [], activeSheetIndex: 0 })).toBe(false)
    expect(isValidDraftDocument(null)).toBe(false)
  })
  it('너무 크면 저장하지 않고 알린다', () => {
    const big: SpreadsheetDocument = { ...DOC, sheets: [{ ...DOC.sheets[0], rows: [['x'.repeat(SHEET_DRAFT_MAX_CHARS)]] }] }
    expect(saveSheetDraft('t1', { title: 'A', doc: big })).toBe('too-large')
    expect(loadSheetDraft('t1')).toBeNull()
  })
  it('저장소를 쓸 수 없으면 조용히 건너뛴다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(saveSheetDraft('t1', { title: 'A', doc: DOC })).toBe('unavailable')
  })
  it('지우기', () => {
    saveSheetDraft('t1', { title: 'A', doc: DOC })
    clearSheetDraft('t1')
    expect(loadSheetDraft('t1')).toBeNull()
  })
})

describe('이탈 경고 — confirmDiscardUnsaved', () => {
  it('등록이 없거나 변경이 없으면 묻지 않고 통과', () => {
    const ask = vi.spyOn(window, 'confirm')
    expect(confirmDiscardUnsaved()).toBe(true)
    const off = registerUnsavedProbe({ isDirty: () => false, discard: () => {} })
    expect(confirmDiscardUnsaved()).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    off()
  })
  it('변경이 있으면 묻고, 취소하면 막고, 확정하면 discard 를 부른다', () => {
    const discard = vi.fn()
    const off = registerUnsavedProbe({ isDirty: () => true, discard })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    expect(confirmDiscardUnsaved()).toBe(false)
    expect(discard).not.toHaveBeenCalled()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    expect(confirmDiscardUnsaved()).toBe(true)
    expect(discard).toHaveBeenCalledOnce()
    off()
    expect(confirmDiscardUnsaved()).toBe(true) // 해제 후엔 묻지 않는다
  })
})
