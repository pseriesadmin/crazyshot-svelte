import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/** 관리자 계약서 탭 최종본 PDF 상태(ready/pending/legacy/unsigned) 조회 — 안내 문구 구분용 (2026-10-08) */

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  role: 'manager' as string | null,
  finalDoc: null as { id: string } | null,
  signing: { signed_at: '2026-10-02T06:46:00Z' } as { signed_at: string } | null,
  signErr: false,
  evidence: null as { id: string } | null,
  evErr: false,
  evFilters: [] as [string, unknown][],
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => state.denied) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => state.role) }))
vi.mock('$lib/server/contractArchive/loadArchivedPdf', () => ({ findCurrentFinalDocument: vi.fn(async () => state.finalDoc) }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'not', 'order', 'limit']) b[m] = () => b
      b.eq = (c: string, v: unknown) => { if (table === 'contract_signature_evidence') state.evFilters.push([c, v]); return b }
      b.maybeSingle = async () => {
        if (table === 'contract_signings') return state.signErr ? { data: null, error: { message: 'x' } } : { data: state.signing, error: null }
        if (table === 'contract_signature_evidence') return state.evErr ? { data: null, error: { message: 'x' } } : { data: state.evidence, error: null }
        return { data: null, error: null }
      }
      return b
    },
  }),
}))

import { GET } from '../../routes/api/cms/contracts/[id]/final-pdf-status/+server'

const ID = '11111111-2222-3333-4444-555555555555'
const call = (id = ID) => GET({ params: { id }, locals: {} } as never)

beforeEach(() => {
  Object.assign(state, { denied: null, role: 'manager', finalDoc: null, signing: { signed_at: '2026-10-02T06:46:00Z' }, signErr: false, evidence: null, evErr: false, evFilters: [] })
})

describe('GET final-pdf-status', () => {
  it('최종본이 있으면 ready', async () => {
    state.finalDoc = { id: 'fd1' }
    expect(await (await call()).json()).toEqual({ state: 'ready' })
  })

  it('서명 증적이 있으면 pending(곧 생성)', async () => {
    state.evidence = { id: 'ev1' }
    expect(await (await call()).json()).toEqual({ state: 'pending' })
    // 현재 서명 시각의 증적만 본다(재서명 전 옛 증적과 섞이지 않음)
    expect(state.evFilters).toContainEqual(['contract_id', ID])
    expect(state.evFilters).toContainEqual(['signed_at', '2026-10-02T06:46:00Z'])
  })

  it('서명 증적이 없으면 legacy(최종본이 자동으로 만들어지지 않는 서명 건)', async () => {
    expect(await (await call()).json()).toEqual({ state: 'legacy' })
  })

  it('서명이 완료되지 않았으면 unsigned', async () => {
    state.signing = null
    expect(await (await call()).json()).toEqual({ state: 'unsigned' })
  })

  it('권한이 없으면 막고, 계약 ID 형식이 틀리면 400, DB 오류는 500(상태를 단정하지 않음)', async () => {
    state.denied = new Response('no', { status: 403 })
    expect((await call()).status).toBe(403)
    state.denied = null
    state.role = null
    expect((await call()).status).toBe(403)
    state.role = 'manager'
    expect((await call('not-a-uuid')).status).toBe(400)
    state.signErr = true
    expect((await call()).status).toBe(500)
    state.signErr = false
    state.evErr = true
    expect((await call()).status).toBe(500)
  })

  it('조회 전용이며 menuAccessMap에 등록돼 있다', () => {
    const src = readFileSync('src/routes/api/cms/contracts/[id]/final-pdf-status/+server.ts', 'utf8')
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|recordAuditLog/)
    expect(readFileSync('src/lib/server/menuAccessMap.ts', 'utf8')).toContain("'src/routes/api/cms/contracts/[id]/final-pdf-status'")
  })

  it('관리자 뷰어는 legacy와 pending 안내 문구를 구분한다', () => {
    const v = readFileSync('src/lib/components/cms/RentalContractViewer.svelte', 'utf8')
    expect(v).toContain('/final-pdf-status')
    expect(v).toContain("{#if finalPdfState === 'legacy'}")
    expect(v).toContain('서명 증적이 기록되지 않은 서명 건')
    expect(v).toContain('최종본 PDF가 자동으로 만들어지지 않습니다')
    expect(v).toContain('서명 완료 후 보통 1분 안에 표시됩니다')
    expect(v).toContain("finalPdfState !== 'loading'") // 상태 확인 전에는 안내를 띄우지 않아 문구가 바뀌며 깜박이지 않는다
  })
})
