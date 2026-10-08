// apply.ts — AI 조력 생성기: 검증·시뮬레이션을 통과한 결과를 운영 DB에 반영하고, 실행 단위로 되돌린다 (서버 전용)
// DB 접근은 AssistDb 인터페이스로 분리해 가짜 클라이언트로 테스트한다. 고객 원문은 어디에도 저장하지 않는다.

import type { GateResult } from './gate'
import type { AdminClient } from '../shared'

export interface AssistDb {
  createRun(): Promise<string>
  getKeywords(cannedId: string): Promise<string[] | null>
  setKeywords(cannedId: string, keywords: string[]): Promise<void>
  insertFaq(f: { title: string; answer: string; keywords: string[] }): Promise<string>
  deleteFaq(cannedId: string): Promise<void>
  insertItem(it: { run_id: string; kind: 'keywords' | 'new_faq'; canned_id: string; added_keywords: string[] }): Promise<void>
  listItems(runId: string): Promise<{ run_id: string; kind: string; canned_id: string; added_keywords: string[] }[]>
  finishRun(runId: string, status: 'done' | 'failed' | 'rolled_back', summary: Record<string, unknown>, extra?: { model?: string; inputTokens?: number | null; outputTokens?: number | null; error?: string }): Promise<void>
  runStatus(runId: string): Promise<string | null>
}

export interface ApplyMeta { model: string; inputTokens: number | null; outputTokens: number | null }

export async function applyAssistResult(db: AssistDb, result: Pick<GateResult, 'keywords' | 'newFaqs' | 'rejected'>, meta: ApplyMeta): Promise<string> {
  const runId = await db.createRun()
  let keywordsAdded = 0
  let faqsCreated = 0
  try {
    for (const k of result.keywords) {
      const current = await db.getKeywords(k.faqId)
      if (current === null) continue
      const have = new Set(current.map((x) => x.replace(/\s+/g, '').toLowerCase()))
      const add = k.add.filter((x) => !have.has(x.replace(/\s+/g, '').toLowerCase()))
      if (!add.length) continue
      await db.setKeywords(k.faqId, [...current, ...add])
      await db.insertItem({ run_id: runId, kind: 'keywords', canned_id: k.faqId, added_keywords: add })
      keywordsAdded += add.length
    }
    for (const nf of result.newFaqs) {
      const id = await db.insertFaq({ title: nf.title, answer: nf.answer, keywords: nf.keywords })
      await db.insertItem({ run_id: runId, kind: 'new_faq', canned_id: id, added_keywords: nf.keywords })
      faqsCreated++
    }
    await db.finishRun(runId, 'done', { keywordsAdded, faqsCreated, rejected: result.rejected }, { model: meta.model, inputTokens: meta.inputTokens, outputTokens: meta.outputTokens })
  } catch (e) {
    // 일부만 반영된 상태로 끝나도 기록이 남아 있어 되돌릴 수 있다
    await db.finishRun(runId, 'failed', { keywordsAdded, faqsCreated }, { model: meta.model, error: e instanceof Error ? e.message.slice(0, 300) : '알 수 없는 오류' })
    throw e
  }
  return runId
}

export async function rollbackAssistRun(db: AssistDb, runId: string): Promise<{ ok: boolean; reason?: string; removedKeywords?: number; deletedFaqs?: number }> {
  const status = await db.runStatus(runId)
  if (!status) return { ok: false, reason: '실행 기록이 없습니다.' }
  if (status === 'rolled_back') return { ok: false, reason: '이미 되돌린 실행입니다.' }
  const items = await db.listItems(runId)
  let removedKeywords = 0
  let deletedFaqs = 0
  for (const it of items) {
    if (it.kind === 'new_faq') { await db.deleteFaq(it.canned_id); deletedFaqs++; continue }
    const current = await db.getKeywords(it.canned_id)
    if (current === null) continue
    const drop = new Set(it.added_keywords)
    const next = current.filter((k) => !drop.has(k))
    removedKeywords += current.length - next.length
    await db.setKeywords(it.canned_id, next)
  }
  await db.finishRun(runId, 'rolled_back', { removedKeywords, deletedFaqs })
  return { ok: true, removedKeywords, deletedFaqs }
}

/** Supabase(service_role) 구현 */
export function createAssistDb(admin: AdminClient, userId: string | null): AssistDb {
  const fail = (e: { message: string } | null): void => { if (e) throw new Error(e.message) }
  return {
    async createRun() {
      const { data, error } = await admin.from('ai_assist_runs').insert({ created_by: userId, status: 'running' }).select('id').single()
      fail(error)
      return (data as { id: string }).id
    },
    async getKeywords(id) {
      const { data, error } = await admin.from('canned_responses').select('match_keywords').eq('id', id).maybeSingle()
      fail(error)
      return data ? ((data as { match_keywords: string[] | null }).match_keywords ?? []) : null
    },
    async setKeywords(id, kws) {
      const { error } = await admin.from('canned_responses').update({ match_keywords: kws }).eq('id', id)
      fail(error)
    },
    async insertFaq(f) {
      const { data, error } = await admin.from('canned_responses')
        .insert({ title: f.title, content: f.answer, category: 'general', help_category: 'basic', match_keywords: f.keywords, pending_review: false })
        .select('id').single()
      fail(error)
      return (data as { id: string }).id
    },
    async deleteFaq(id) {
      const { error } = await admin.from('canned_responses').delete().eq('id', id)
      fail(error)
    },
    async insertItem(it) {
      const { error } = await admin.from('ai_assist_items').insert(it)
      fail(error)
    },
    async listItems(runId) {
      const { data, error } = await admin.from('ai_assist_items').select('run_id, kind, canned_id, added_keywords').eq('run_id', runId)
      fail(error)
      return (data ?? []) as { run_id: string; kind: string; canned_id: string; added_keywords: string[] }[]
    },
    async finishRun(runId, status, summary, extra) {
      const patch: Record<string, unknown> = { status, summary }
      if (extra?.model) patch.model = extra.model
      if (extra?.inputTokens != null) patch.input_tokens = extra.inputTokens
      if (extra?.outputTokens != null) patch.output_tokens = extra.outputTokens
      if (extra?.error) patch.error = extra.error
      if (status === 'rolled_back') { patch.rolled_back_at = new Date().toISOString(); patch.rolled_back_by = userId }
      const { error } = await admin.from('ai_assist_runs').update(patch).eq('id', runId)
      fail(error)
    },
    async runStatus(runId) {
      const { data, error } = await admin.from('ai_assist_runs').select('status').eq('id', runId).maybeSingle()
      fail(error)
      return data ? (data as { status: string }).status : null
    },
  }
}
