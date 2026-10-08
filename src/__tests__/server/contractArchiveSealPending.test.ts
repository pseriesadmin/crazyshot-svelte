import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSealKey } from '$lib/server/contractArchive/seal'
import { sealFinalDocument } from '$lib/server/contractArchive/sealArchive'
import { sealPendingDocuments } from '$lib/server/contractArchive/sealPending'

vi.mock('$lib/server/contractArchive/generateArchive', () => ({ ARCHIVE_BUCKET: 'contract-archives' }))

type Row = Record<string, unknown>
const pemKey = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))).map((x) => x.toString(16).padStart(2, '0')).join('')

interface World {
  tables: Record<string, Row[]>
  files: Record<string, Uint8Array>
  failMarkerLookup?: boolean
  failAlarmLookup?: boolean
  failAuditInsert?: boolean
  failMarkerInsertCount?: number
  failSealInsert?: boolean
  throwOnAlarmInsert?: boolean
}

/** 필요한 만큼만 흉내 낸 PostgREST 체인 */
function fakeAdmin(w: World): SupabaseClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let max = Infinity
    const rows = () => (w.tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max)
    const b: Record<string, unknown> = {}
    const cols: string[] = []
    const lookupFails = () =>
      table === 'contract_audit_log' &&
      ((w.failMarkerLookup === true && cols.includes('metadata->>kind')) || (w.failAlarmLookup === true && cols.includes('metadata->>stage')))
    b.select = () => b
    b.is = (col: string, v: unknown) => {
      if (table === 'contract_final_documents' && col === 'contract_final_document_seals' && v === null) {
        filters.push((r) => !(w.tables.contract_final_document_seals ?? []).some((s) => s.final_document_id === r.id))
      }
      return b
    }
    b.gte = (c: string, v: string) => { filters.push((r) => new Date(String(r[c])).getTime() >= new Date(v).getTime()); return b }
    b.eq = (c: string, v: unknown) => {
      cols.push(c)
      filters.push((r) => (c.includes('->>') ? (r.metadata as Row | undefined)?.[c.split('->>')[1]] === v : r[c] === v))
      return b
    }
    b.order = () => b
    b.limit = (n: number) => { max = n; return b }
    b.maybeSingle = async () => (lookupFails() ? { data: null, error: { message: 'boom' } } : { data: rows()[0] ?? null, error: null })
    b.in = (c: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[c])); return b }
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(lookupFails() ? { data: null, error: { message: 'boom' } } : { data: rows(), error: null }).then(res)
    b.insert = async (row: Row) => {
      const isMarker = table === 'contract_audit_log' && (row.metadata as Row | undefined)?.kind === 'sealed'
      if (isMarker && w.failAuditInsert) return { error: { message: 'audit down' } }
      if (isMarker && (w.failMarkerInsertCount ?? 0) > 0) { w.failMarkerInsertCount = (w.failMarkerInsertCount ?? 0) - 1; return { error: { message: 'audit flaky' } } }
      if (table === 'contract_final_document_seals' && w.failSealInsert) return { error: { message: 'seal db down' } }
      if (table === 'contract_audit_log' && w.throwOnAlarmInsert && row.event_type === 'evidence_failed') throw new Error('alarm insert boom')
      ;(w.tables[table] ??= []).push({ ...row, created_at: new Date().toISOString() })
      return { error: null }
    }
    return b
  }
  const storage = { from: () => ({ download: async (path: string) => (w.files[path] ? { data: new Blob([w.files[path] as BlobPart]), error: null } : { data: null, error: { message: 'nf' } }) }) }
  return { from, storage } as unknown as SupabaseClient
}

const key = loadSealKey(pemKey())!
const now = new Date('2026-10-08T12:00:00Z')
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()

async function world(opts: { bytes?: Uint8Array; recordedSha?: string; ageMin?: number; marker?: boolean } = {}): Promise<World> {
  const bytes = opts.bytes ?? new TextEncoder().encode('%PDF-1.4 fake body for test')
  const w: World = {
    tables: {
      contract_final_documents: [{ id: 'fd1', contract_id: 'c1', signing_id: 's1', evidence_id: 'ev1', pdf_path: 'c1/ev1.pdf', pdf_sha256: opts.recordedSha ?? (await sha(bytes)), source: 'original', generated_at: minutesAgo(opts.ageMin ?? 30) }],
      contracts: [{ id: 'c1' }],
      contract_signature_evidence: [{ id: 'ev1', signed_at: minutesAgo(40) }],
      contract_final_document_seals: [],
      contract_audit_log: opts.marker ? [{ contract_id: 'c1', event_type: 'archive_created', metadata: { kind: 'sealed', final_document_id: 'fd1' }, created_at: minutesAgo(20) }] : [],
    },
    files: { 'c1/ev1.pdf': bytes },
  }
  return w
}

const alarms = (w: World, reason: string) => w.tables.contract_audit_log.filter((r) => (r.metadata as Row | undefined)?.stage === 'seal' && (r.metadata as Row).reason === reason)

describe('sealPendingDocuments — A안(최근 보관본만·표식·경보)', () => {
  it('최근 보관본은 봉인하고 봉인 표식을 남긴다', async () => {
    const w = await world()
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r).toMatchObject({ sealed: 1, failed: 0 })
    expect(w.tables.contract_final_document_seals).toHaveLength(1)
    expect(w.tables.contract_audit_log.some((l) => (l.metadata as Row).kind === 'sealed')).toBe(true)
  })

  it('6시간보다 오래된 미봉인 보관본은 자동으로 봉인하지 않는다(관리자 수동 봉인 대상)', async () => {
    const w = await world({ ageMin: 6 * 60 + 5 })
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r.sealed).toBe(0)
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
  })

  it('봉인된 적이 있는데 봉인 행이 없으면 재봉인하지 않고 경보를 남기며, 같은 경보는 반복 기록하지 않는다', async () => {
    const w = await world({ marker: true })
    const admin = fakeAdmin(w)
    const r1 = await sealPendingDocuments(admin, key, 20, { now })
    expect(r1).toMatchObject({ sealed: 0, skippedMissingAfterSealed: 1 })
    await sealPendingDocuments(admin, key, 20, { now })
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
    expect(alarms(w, 'seal_missing_after_sealed')).toHaveLength(1)
  })

  it('보관 파일 지문이 기록과 다르면 봉인하지 않고 경보를 1회만 남긴다', async () => {
    const w = await world({ recordedSha: 'f'.repeat(64) })
    const admin = fakeAdmin(w)
    expect((await sealPendingDocuments(admin, key, 20, { now })).skippedMismatch).toBe(1)
    await sealPendingDocuments(admin, key, 20, { now })
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
    expect(alarms(w, 'archive_hash_mismatch')).toHaveLength(1)
  })

  it('보관 파일을 읽지 못하면 실패로 세고 경보를 남긴다', async () => {
    const w = await world()
    w.files = {}
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r.failed).toBe(1)
    expect(alarms(w, 'archive_file_unreadable')).toHaveLength(1)
  })

  it('표식 조회가 오류 나면 "표식 없음"으로 보지 않고 건너뛴다(fail-closed)', async () => {
    const w = await world()
    w.failMarkerLookup = true
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r).toMatchObject({ sealed: 0, failed: 1 })
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
  })

  it('증적을 찾지 못하면 실패로 세고 evidence_missing 경보를 남긴다', async () => {
    const w = await world()
    w.tables.contract_signature_evidence = []
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r.failed).toBe(1)
    expect(alarms(w, 'evidence_missing')).toHaveLength(1)
  })

  it('봉인 저장이 실패하면 seal_failed 경보를 남기고, 표식은 남기지 않는다', async () => {
    const w = await world()
    w.failSealInsert = true
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r.failed).toBe(1)
    expect(alarms(w, 'seal_failed')).toHaveLength(1)
    expect(w.tables.contract_audit_log.some((l) => (l.metadata as Row).kind === 'sealed')).toBe(false)
  })

  it('표식 조회가 실패하면 seal_marker_lookup_failed 경보를 남기고 봉인하지 않는다', async () => {
    const w = await world()
    w.failMarkerLookup = true
    await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(alarms(w, 'seal_marker_lookup_failed')).toHaveLength(1)
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
  })

  it('경보 중복 조회가 실패하면 경보 기록을 건너뛴다(장애 중 크론마다 재시도하지 않음)', async () => {
    const w = await world({ recordedSha: 'f'.repeat(64) })
    w.failAlarmLookup = true
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r.skippedMismatch).toBe(1)
    expect(alarms(w, 'archive_hash_mismatch')).toHaveLength(0)
  })

  it('24시간이 지난 같은 경보는 다시 기록한다', async () => {
    const w = await world({ recordedSha: 'f'.repeat(64) })
    w.tables.contract_audit_log.push({ contract_id: 'c1', event_type: 'evidence_failed', metadata: { stage: 'seal', reason: 'archive_hash_mismatch', final_document_id: 'fd1' }, created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString() })
    await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(alarms(w, 'archive_hash_mismatch')).toHaveLength(2)
  })

  it('경보 기록이 예외를 던져도 크론 전체가 멈추지 않는다(다른 건 처리 계속)', async () => {
    const w = await world({ recordedSha: 'f'.repeat(64) })
    w.throwOnAlarmInsert = true
    await expect(sealPendingDocuments(fakeAdmin(w), key, 20, { now })).resolves.toBeDefined()
  })

  it('계약이 삭제된 보관본은 봉인하지 않고 건너뛴다(감사로그 FK 때문에 표식을 남길 수 없음)', async () => {
    const w = await world()
    w.tables.contracts = []
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now })
    expect(r).toMatchObject({ sealed: 0, skippedContractGone: 1 })
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
  })

  it('시간 예산이 지나면 남은 건을 미룬다', async () => {
    const w = await world()
    const r = await sealPendingDocuments(fakeAdmin(w), key, 20, { now, deadlineMs: Date.now() - 1 })
    expect(r).toMatchObject({ sealed: 0, deferred: 1 })
  })
})

describe('sealFinalDocument — 표식 실패·조회 오류', () => {
  const target = { finalDocumentId: 'fd1', contractId: 'c1', evidenceId: 'ev1', signingId: 's1', signedAt: minutesAgo(40), pdfSha256: 'a'.repeat(64), source: 'original' as const }
  const bytes = new TextEncoder().encode('%PDF-1.4 x')

  it('표식 기록이 끝내 실패해도 봉인은 성공으로 보고하고(markerRecorded=false) 경보를 남긴다', async () => {
    const w = await world()
    w.failAuditInsert = true
    const r = await sealFinalDocument(fakeAdmin(w), target, bytes, key)
    expect(r).toEqual({ ok: true, alreadySealed: false, markerRecorded: false })
    expect(w.tables.contract_final_document_seals).toHaveLength(1)
    expect(alarms(w, 'seal_marker_missing')).toHaveLength(1)
  })

  it('표식 기록이 1회 실패해도 재시도로 성공하면 경보 없이 markerRecorded=true다', async () => {
    const w = await world()
    w.failMarkerInsertCount = 1
    const r = await sealFinalDocument(fakeAdmin(w), target, bytes, key)
    expect(r).toEqual({ ok: true, alreadySealed: false, markerRecorded: true })
    expect(alarms(w, 'seal_marker_missing')).toHaveLength(0)
    expect(w.tables.contract_audit_log.filter((l) => (l.metadata as Row).kind === 'sealed')).toHaveLength(1)
  })

  it('표식 실패 경보 기록까지 예외를 던져도 봉인 결과는 보존된다', async () => {
    const w = await world()
    w.failAuditInsert = true
    w.throwOnAlarmInsert = true
    const r = await sealFinalDocument(fakeAdmin(w), target, bytes, key)
    expect(r).toEqual({ ok: true, alreadySealed: false, markerRecorded: false })
    expect(w.tables.contract_final_document_seals).toHaveLength(1)
  })

  it('표식 조회 오류면 봉인하지 않고 실패로 돌려준다(fail-closed)', async () => {
    const w = await world()
    w.failMarkerLookup = true
    const r = await sealFinalDocument(fakeAdmin(w), target, bytes, key)
    expect(r.ok).toBe(false)
    expect(w.tables.contract_final_document_seals).toHaveLength(0)
  })
})
