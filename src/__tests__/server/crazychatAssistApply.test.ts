/**
 * TDD: AI 조력 생성기 — DB 반영과 되돌리기 (2026-10-08)
 * 가짜 DB 클라이언트로 반영 순서·기록·되돌림 범위를 검증한다(실제 DB 호출 없음).
 */
import { describe, it, expect } from 'vitest'
import { applyAssistResult, rollbackAssistRun, type AssistDb } from '$lib/server/crazychat/assist/apply'

function fakeDb(initial: { id: string; title: string; match_keywords: string[] }[]) {
  const canned = initial.map((c) => ({ ...c, pending_review: false }))
  const items: { run_id: string; kind: string; canned_id: string; added_keywords: string[] }[] = []
  const runs: { id: string; status: string; summary?: unknown }[] = []
  let seq = 0
  const db: AssistDb = {
    async createRun() { const id = `run${++seq}`; runs.push({ id, status: 'running' }); return id },
    async getKeywords(id) { return canned.find((c) => c.id === id)?.match_keywords ?? null },
    async setKeywords(id, kws) { const c = canned.find((x) => x.id === id); if (!c) throw new Error('없음'); c.match_keywords = kws },
    async insertFaq(f) { const id = `faq${++seq}`; canned.push({ id, title: f.title, match_keywords: f.keywords, pending_review: false }); return id },
    async deleteFaq(id) { const i = canned.findIndex((x) => x.id === id); if (i >= 0) canned.splice(i, 1) },
    async insertItem(it) { items.push(it) },
    async listItems(runId) { return items.filter((i) => i.run_id === runId) },
    async finishRun(id, status, summary) { const r = runs.find((x) => x.id === id)!; r.status = status; r.summary = summary },
    async runStatus(id) { return runs.find((x) => x.id === id)?.status ?? null },
  }
  return { db, canned, items, runs }
}

const result = {
  keywords: [{ faqId: 'c1', add: ['보증금환급', '예치금반환'] }],
  newFaqs: [{ title: '촬영 전날 수령 문의', keywords: ['전날수령', '미리수령', '전날픽업'], answer: '안내', sources: ['c1'], tempId: 'n0' }],
  rejected: { keywords: 0, newFaqs: 0 },
}

describe('applyAssistResult', () => {
  it('키워드를 합치고 새 빠른답변을 만들고 항목을 기록한다', async () => {
    const f = fakeDb([{ id: 'c1', title: '보증금', match_keywords: ['보증금'] }])
    const runId = await applyAssistResult(f.db, result, { model: 'm', inputTokens: 10, outputTokens: 5 })
    expect(f.canned.find((c) => c.id === 'c1')?.match_keywords).toEqual(['보증금', '보증금환급', '예치금반환'])
    expect(f.canned.some((c) => c.title === '촬영 전날 수령 문의')).toBe(true)
    expect(f.items.map((i) => i.kind).sort()).toEqual(['keywords', 'new_faq'])
    expect(f.runs.find((r) => r.id === runId)?.status).toBe('done')
  })
  it('이미 있는 키워드는 중복 추가하지 않고 실제 추가분만 기록한다', async () => {
    const f = fakeDb([{ id: 'c1', title: '보증금', match_keywords: ['보증금', '보증금환급'] }])
    await applyAssistResult(f.db, result, { model: 'm', inputTokens: 1, outputTokens: 1 })
    const kwItem = f.items.find((i) => i.kind === 'keywords')!
    expect(kwItem.added_keywords).toEqual(['예치금반환'])
  })
  it('대상 FAQ가 사라졌으면 그 항목만 건너뛴다', async () => {
    const f = fakeDb([])
    await applyAssistResult(f.db, result, { model: 'm', inputTokens: 1, outputTokens: 1 })
    expect(f.items.filter((i) => i.kind === 'keywords')).toHaveLength(0)
  })
})

describe('rollbackAssistRun', () => {
  it('추가한 키워드만 빼고 새로 만든 빠른답변을 지운다(다른 키워드는 그대로)', async () => {
    const f = fakeDb([{ id: 'c1', title: '보증금', match_keywords: ['보증금'] }])
    const runId = await applyAssistResult(f.db, result, { model: 'm', inputTokens: 1, outputTokens: 1 })
    // 실행 이후 사람이 키워드를 하나 더 붙였다고 가정
    f.canned.find((c) => c.id === 'c1')!.match_keywords.push('수동추가')
    const r = await rollbackAssistRun(f.db, runId)
    expect(r.ok).toBe(true)
    expect(f.canned.find((c) => c.id === 'c1')?.match_keywords).toEqual(['보증금', '수동추가'])
    expect(f.canned.some((c) => c.title === '촬영 전날 수령 문의')).toBe(false)
    expect(f.runs.find((x) => x.id === runId)?.status).toBe('rolled_back')
  })
  it('이미 되돌린 실행은 다시 되돌리지 않는다', async () => {
    const f = fakeDb([{ id: 'c1', title: '보증금', match_keywords: ['보증금'] }])
    const runId = await applyAssistResult(f.db, result, { model: 'm', inputTokens: 1, outputTokens: 1 })
    await rollbackAssistRun(f.db, runId)
    const again = await rollbackAssistRun(f.db, runId)
    expect(again.ok).toBe(false)
  })
})
