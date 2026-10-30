// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveModeDraft, loadModeDraft, clearModeDraft, FLOW_DRAFT_MAX_CHARS, MODE_DRAFT_MAX_AGE_MS } from '$lib/utils/contractModeDraft'

const FLOW = { kind: 'flow' as const, title: '문서형', specsJson: '[]', requiresIssuerSignature: false, flowDoc: { type: 'doc', content: [{ type: 'paragraph' }] } }
const HTML = {
  kind: 'html' as const, title: 'HTML형', specsJson: '[{"key":"a","value":"b"}]', requiresIssuerSignature: true,
  html: { signatureUrl: 'https://x.test/s.png', signatureWidth: 200, signatureOffsetX: 1, signatureOffsetY: 2, contractTerms: '본문', privacyTerms: '동의' },
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('문서형·HTML형 임시저장', () => {
  it('저장한 내용을 그대로 읽고 방식·양식별로 따로 보관한다', () => {
    expect(saveModeDraft('t1', FLOW)).toBe('ok')
    expect(saveModeDraft('t1', HTML)).toBe('ok')
    expect(saveModeDraft('new', FLOW)).toBe('ok')
    expect(loadModeDraft('t1', 'flow')?.title).toBe('문서형')
    expect(loadModeDraft('t1', 'html')?.html?.contractTerms).toBe('본문')
    expect(loadModeDraft('new', 'flow')?.flowDoc).toEqual(FLOW.flowDoc)
    expect(loadModeDraft('t2', 'flow')).toBeNull()
  })
  it('문서형이 한도를 넘으면 저장하지 않고 알리며, 낡은 임시저장도 지운다', () => {
    expect(saveModeDraft('t1', FLOW)).toBe('ok')
    const big = { ...FLOW, flowDoc: { type: 'doc', content: [{ type: 'paragraph', text: 'x'.repeat(FLOW_DRAFT_MAX_CHARS) }] } }
    expect(saveModeDraft('t1', big)).toBe('too-large')
    expect(loadModeDraft('t1', 'flow')).toBeNull()
  })
  it('DB 저장본보다 오래된 것·7일 지난 것·손상된 것은 버린다', () => {
    saveModeDraft('t1', HTML)
    expect(loadModeDraft('t1', 'html', { notBefore: Date.now() + 60_000 })).toBeNull()
    saveModeDraft('t1', HTML)
    expect(loadModeDraft('t1', 'html', { now: Date.now() + MODE_DRAFT_MAX_AGE_MS + 1000 })).toBeNull()
    localStorage.setItem('cs-contract-mode-draft:v1:flow:t3', '{bad')
    expect(loadModeDraft('t3', 'flow')).toBeNull()
    localStorage.setItem('cs-contract-mode-draft:v1:flow:t4', JSON.stringify({ savedAt: Date.now(), kind: 'flow', title: 'x', specsJson: '[]', requiresIssuerSignature: false, flowDoc: 'oops' }))
    expect(loadModeDraft('t4', 'flow')).toBeNull()
    expect(localStorage.getItem('cs-contract-mode-draft:v1:flow:t4')).toBeNull()
  })
  it('저장소를 쓸 수 없으면 조용히 건너뛰고, 지우기', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(saveModeDraft('t1', HTML)).toBe('unavailable')
    vi.restoreAllMocks()
    saveModeDraft('t1', HTML)
    clearModeDraft('t1', 'html')
    expect(loadModeDraft('t1', 'html')).toBeNull()
  })
})
