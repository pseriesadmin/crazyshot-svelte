import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findCurrentFinalDocument } from '$lib/server/contractArchive/loadArchivedPdf'

type Row = Record<string, unknown>

function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from: (t: string) => {
      const inF: [string, unknown[]][] = []
      const api: Record<string, unknown> = {
        select: () => api, not: () => api, order: () => api, limit: () => api,
        in: (k: string, vs: unknown[]) => { inF.push([k, vs]); return api },
        then: (resolve: (v: unknown) => void) => resolve({ data: (tables[t] ?? []).filter((r) => inF.every(([k, vs]) => vs.includes(r[k]))), error: null }),
      }
      return api
    },
  } as unknown as SupabaseClient
}

const doc = (id: string, evidence: string): Row => ({ id, contract_id: 'c-1', evidence_id: evidence, pdf_path: `c-1/${evidence}.pdf`, source: 'original' })
const evidence = (id: string, signedAt: string): Row => ({ id, signed_at: signedAt })

describe('findCurrentFinalDocument — 현재 유효한 서명의 보관본만 제공', () => {
  it('현재 서명(signed_at)과 일치하는 증적의 보관본을 돌려준다', async () => {
    const admin = fakeAdmin({
      contract_signings: [{ contract_id: 'c-1', signed_at: '2026-10-06T10:00:00.000Z' }],
      contract_final_documents: [doc('fd-1', 'ev-1')],
      contract_signature_evidence: [evidence('ev-1', '2026-10-06T10:00:00+00:00')],
    })
    expect((await findCurrentFinalDocument(admin, ['c-1']))?.id).toBe('fd-1')
  })

  it('발행취소 후 재서명하면 취소된 첫 서명의 보관본은 제외하고, 새 서명본이 생기기 전에는 null(준비 중)이다', async () => {
    const base = {
      contract_final_documents: [doc('fd-old', 'ev-old')],
      contract_signature_evidence: [evidence('ev-old', '2026-10-06T10:00:00.000Z'), evidence('ev-new', '2026-10-07T01:00:00.000Z')],
    }
    // 재서명 완료(새 signed_at), 새 PDF는 아직 없음
    const waiting = fakeAdmin({ ...base, contract_signings: [{ contract_id: 'c-1', signed_at: '2026-10-07T01:00:00.000Z' }] })
    expect(await findCurrentFinalDocument(waiting, ['c-1'])).toBeNull()
    // 새 PDF 생성 후
    const ready = fakeAdmin({ ...base, contract_final_documents: [doc('fd-new', 'ev-new'), doc('fd-old', 'ev-old')], contract_signings: [{ contract_id: 'c-1', signed_at: '2026-10-07T01:00:00.000Z' }] })
    expect((await findCurrentFinalDocument(ready, ['c-1']))?.id).toBe('fd-new')
  })

  it('서명이 취소돼 서명 완료 행이 없거나 계약·보관본이 없으면 null이다', async () => {
    expect(await findCurrentFinalDocument(fakeAdmin({ contract_signings: [], contract_final_documents: [doc('fd-1', 'ev-1')], contract_signature_evidence: [evidence('ev-1', '2026-10-06T10:00:00.000Z')] }), ['c-1'])).toBeNull()
    expect(await findCurrentFinalDocument(fakeAdmin({}), [])).toBeNull()
    expect(await findCurrentFinalDocument(fakeAdmin({ contract_signings: [], contract_final_documents: [] }), ['c-1'])).toBeNull()
  })
})
