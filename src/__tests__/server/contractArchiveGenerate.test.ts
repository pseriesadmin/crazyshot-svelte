import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { archiveEvidence, listPendingEvidence, listLegacySignings, recordArchiveFailure, archiveRetryDelayMs, ARCHIVE_BUCKET, type EvidenceRecord } from '$lib/server/contractArchive/generateArchive'
import { sha256Hex } from '$lib/contract-signature/signatureEvidence'

type Row = Record<string, unknown>

/** 최소 in-memory Supabase 대역 — 이 모듈이 쓰는 호출 형태만 지원한다. */
function createFakeAdmin(seed: Record<string, Row[]>, opts: { existingObjects?: Record<string, Uint8Array> } = {}) {
  const tables: Record<string, Row[]> = { ...seed }
  const inserts: Record<string, Row[]> = {}
  const updates: { table: string; values: Row; eq: [string, unknown][] }[] = []
  const uploads: { path: string; bytes: Uint8Array; upsert: boolean | undefined }[] = []
  const objects: Record<string, Uint8Array> = { ...(opts.existingObjects ?? {}) }

  function query(table: string) {
    const filters: [string, unknown][] = []
    const inFilters: [string, unknown[]][] = []
    let antiJoin = false
    let rangeFrom = 0
    let rangeTo = Number.MAX_SAFE_INTEGER
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const run = (): Row[] => {
      const done = new Set((tables.contract_final_documents ?? []).map((d) => d.evidence_id))
      return (tables[table] ?? [])
        .filter((r) => filters.every(([k, v]) => r[k] === v) && inFilters.every(([k, vs]) => vs.includes(r[k])) && (!antiJoin || !done.has(r.id)))
        .slice(rangeFrom, rangeTo + 1)
    }
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return api },
      in: (k: string, vs: unknown[]) => { inFilters.push([k, vs]); return api },
      // 보관본 없음 anti-join(contract_final_documents.evidence_id FK 임베드 + is null) 대역
      is: (k: string, v: unknown) => { if (k === 'contract_final_documents' && v === null) antiJoin = true; return api },
      not: () => api,
      order: () => api,
      range: (from: number, to: number) => { rangeFrom = from; rangeTo = to; return api },
      insert: (row: Row) => { mode = 'insert'; payload = row; return api },
      update: (values: Row) => { mode = 'update'; payload = values; return api },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        if (mode === 'insert') {
          const row = { id: `fd-${(inserts[table]?.length ?? 0) + 1}`, ...payload }
          ;(inserts[table] ??= []).push(row)
          tables[table] = [...(tables[table] ?? []), row]
          return { data: row, error: null }
        }
        return { data: run()[0] ?? null, error: null }
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (mode === 'insert') { (inserts[table] ??= []).push(payload); resolve({ data: null, error: null }) }
        else if (mode === 'update') { updates.push({ table, values: payload, eq: [...filters] }); resolve({ data: null, error: null }) }
        else resolve({ data: run(), error: null })
      },
    }
    return api
  }

  const admin = {
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe(ARCHIVE_BUCKET)
        return {
          upload: async (path: string, bytes: Uint8Array, o: { upsert?: boolean }) => {
            uploads.push({ path, bytes, upsert: o.upsert })
            if (objects[path]) return { error: { message: 'The resource already exists' } }
            objects[path] = bytes
            return { error: null }
          },
          download: async (path: string) => objects[path]
            ? { data: new Blob([objects[path] as BlobPart]), error: null }
            : { data: null, error: { message: 'not found' } },
        }
      },
    },
  } as unknown as SupabaseClient
  return { admin, inserts, updates, uploads }
}

const PDF = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...new Uint8Array(2000).fill(65)])
const render = async () => ({ pdf: PDF })

const BAKED_HTML = '<div class="contract-wrap">계약서<img src="data:image/png;base64,AAAA" alt="예약자 서명"><script>alert(1)</script></div>'

async function evidenceFor(html: string | null, over: Partial<EvidenceRecord> = {}): Promise<EvidenceRecord> {
  return {
    id: 'ev-1', contract_id: 'c-1', signing_id: 's-1', reservation_id: 7,
    signed_at: '2026-10-06T10:00:00.000Z', ip_address: '1.2.3.4', user_agent: 'UA-TEST',
    consent_log: [{ key: 'contract', label: '계약 내용 확인', checked: true, text_sha256: 'x'.repeat(64) }, { key: 'privacy', label: '개인정보 동의', checked: true, text_sha256: null }, { key: 'terms_copy', label: '약관 사본 수령', checked: true, text_sha256: null }],
    final_html_sha256: html ? await sha256Hex(html) : null,
    terms_text: '이용약관 원문', refund_text: '환불 원문', privacy_text: '개인정보 원문',
    terms_sha256: 't'.repeat(64), refund_sha256: 'r'.repeat(64), privacy_sha256: 'p'.repeat(64),
    ...over,
  }
}

function seed(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    contracts: [{ id: 'c-1', authoring_mode: 'html', html_document: BAKED_HTML }],
    contract_signings: [{ id: 's-1', signed_at: '2026-10-06T10:00:00.000Z', signature_data: 'data:image/png;base64,SIG', signed_content_snapshot: { authoring_mode: 'html', html_document: '<div>스냅샷<!--CUSTOMER_SIGNATURE--></div>' } }],
    rental_reservations: [{ id: 7, reservation_code: 'CSRSV26100007' }],
    contract_final_documents: [],
    ...(over as Record<string, Row[]>),
  }
}

describe('archiveEvidence — 최종본 PDF 생성·불변 보관', () => {
  it('저장된 최종본 해시가 증적과 일치하면 original로 보관하고 약관 부록·증적을 담는다', async () => {
    const f = createFakeAdmin(seed())
    let rendered = ''
    const r = await archiveEvidence(f.admin, await evidenceFor(BAKED_HTML), { render: async (h) => { rendered = h; return { pdf: PDF } } })
    expect(r).toMatchObject({ ok: true, source: 'original', pdfPath: 'c-1/ev-1.pdf', alreadyArchived: false })
    // 스크립트는 렌더 전에 제거되고 CSP로도 실행이 금지된다
    expect(rendered).not.toMatch(/<script/i)
    expect(rendered).toContain("script-src 'none'")
    expect(rendered).toContain('예약자 서명')
    expect(rendered).toContain('이용약관 원문')
    expect(rendered).toContain('UA-TEST')
    expect(rendered).toContain('CSRSV26100007')
    expect(rendered).toContain('동의: 계약')
    expect(rendered).toContain('서명 시점 기록 최종본 SHA-256')
    // 비공개 버킷에 덮어쓰기 금지로 저장
    expect(f.uploads).toHaveLength(1)
    expect(f.uploads[0].upsert).toBe(false)
    const row = f.inserts.contract_final_documents[0]
    expect(row).toMatchObject({ evidence_id: 'ev-1', contract_id: 'c-1', signing_id: 's-1', source: 'original', pdf_path: 'c-1/ev-1.pdf', size_bytes: PDF.byteLength })
    expect(row.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    // 뷰어 주소 갱신 + 감사 이벤트(보관·교부)
    expect(f.updates.find((u) => u.table === 'contracts')?.values).toEqual({ document_url: '/api/cms/contracts/c-1/final-pdf' })
    const events = (f.inserts.contract_audit_log ?? []).map((e) => e.event_type)
    expect(events).toEqual(['archive_created', 'copy_sent'])
  })

  it('저장된 최종본이 증적 해시와 다르면 서명 시점 스냅샷+서명 이미지로 재생성하고 regenerated로 표기한다(약관 스냅샷은 유지)', async () => {
    const f = createFakeAdmin(seed())
    let rendered = ''
    const r = await archiveEvidence(f.admin, await evidenceFor('<div>다른 내용</div>'), { render: async (h) => { rendered = h; return { pdf: PDF } } })
    expect(r).toMatchObject({ ok: true, source: 'regenerated' })
    expect(rendered).toContain('스냅샷')
    expect(rendered).toContain('data:image/png;base64,SIG')
    expect(rendered).not.toContain('<!--CUSTOMER_SIGNATURE-->')
    expect(rendered).toContain('재생성본')
    expect(rendered).toContain('서명 시점 기록과 본 PDF 원문이 다릅니다')
    expect(rendered).toContain('이용약관 원문')
    expect(rendered).not.toContain('약관 부록은 포함하지 않습니다')
  })

  it('동의 기록이 없는 소급 증적은 항상 regenerated이고 약관 부록 없이 "기록 없음"을 명시한다', async () => {
    const f = createFakeAdmin(seed())
    let rendered = ''
    const legacy = await evidenceFor(null, { consent_log: [], user_agent: null, terms_text: null, refund_text: null, privacy_text: null, terms_sha256: null, refund_sha256: null, privacy_sha256: null })
    const r = await archiveEvidence(f.admin, legacy, { render: async (h) => { rendered = h; return { pdf: PDF } } })
    expect(r).toMatchObject({ ok: true, source: 'regenerated' })
    expect(rendered).toContain('약관 부록은 포함하지 않습니다')
    expect(rendered).toContain('기록 없음(서명 증적 도입 전 서명 건')
    expect(rendered).not.toContain('약관 사본 (서명 당시 교부본)')
  })

  it('이미 보관된 증적은 다시 만들지 않는다(멱등)', async () => {
    const f = createFakeAdmin(seed({ contract_final_documents: [{ id: 'fd-0', evidence_id: 'ev-1', pdf_path: 'c-1/ev-1.pdf', size_bytes: 3000, source: 'original' }] }))
    let calls = 0
    const r = await archiveEvidence(f.admin, await evidenceFor(BAKED_HTML), { render: async () => { calls++; return { pdf: PDF } } })
    expect(r).toMatchObject({ ok: true, alreadyArchived: true, finalDocumentId: 'fd-0' })
    expect(calls).toBe(0)
    expect(f.uploads).toHaveLength(0)
  })

  it('이전 시도에서 파일만 올라간 경우 올라간 파일을 그대로 채택해 기록을 이어서 만든다', async () => {
    const existing = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...new Uint8Array(1500).fill(66)])
    const f = createFakeAdmin(seed(), { existingObjects: { 'c-1/ev-1.pdf': existing } })
    const r = await archiveEvidence(f.admin, await evidenceFor(BAKED_HTML), { render })
    expect(r).toMatchObject({ ok: true, alreadyArchived: false })
    expect(f.inserts.contract_final_documents[0].size_bytes).toBe(existing.byteLength)
  })

  it('html 방식이 아닌 계약서·서명 이미지 없음·서명 이후 변경·PDF 이상은 ok:false로 사유를 돌려준다', async () => {
    const canvas = createFakeAdmin(seed({ contract_signings: [{ id: 's-1', signed_at: '2026-10-06T10:00:00.000Z', signature_data: 'data:x', signed_content_snapshot: { authoring_mode: 'canvas', html_document: null } }] }))
    expect(await archiveEvidence(canvas.admin, await evidenceFor('x'), { render })).toEqual({ ok: false, reason: 'unsupported_authoring_mode', permanent: true })

    const noSig = createFakeAdmin(seed({ contract_signings: [{ id: 's-1', signed_at: '2026-10-06T10:00:00.000Z', signature_data: null, signed_content_snapshot: null }] }))
    expect(await archiveEvidence(noSig.admin, await evidenceFor('x'), { render })).toEqual({ ok: false, reason: 'signature_data_missing', permanent: true })

    const changed = createFakeAdmin(seed({ contract_signings: [{ id: 's-1', signed_at: '2026-10-07T00:00:00.000Z', signature_data: 'data:x', signed_content_snapshot: null }] }))
    expect(await archiveEvidence(changed.admin, await evidenceFor('x'), { render })).toEqual({ ok: false, reason: 'signing_changed_after_evidence', permanent: true })

    const bad = createFakeAdmin(seed())
    const r = await archiveEvidence(bad.admin, await evidenceFor(BAKED_HTML), { render: async () => ({ pdf: new Uint8Array([1, 2, 3]) }) })
    expect(r).toEqual({ ok: false, reason: 'invalid_pdf_output', permanent: false })
    expect(bad.uploads).toHaveLength(0)
  })
})

const NOW = new Date('2026-10-07T12:00:00.000Z')
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('listPendingEvidence — 큐 조회(보관본 없는 건만, 처리 불가 건 제외, 재시도 대기)', () => {
  const ev = (id: string, contract = 'c-alive'): Row => ({ id, contract_id: contract, signing_id: `s-${id}`, captured_at: id })
  const fail = (id: string, minAgo: number, permanent = false, contract = 'c-alive'): Row => ({ contract_id: contract, event_type: 'evidence_failed', created_at: minutesAgo(minAgo), metadata: { stage: 'archive', evidence_id: id, permanent } })

  it('보관 완료·계약 삭제(원본 없음)·영구 실패로 기록된 증적을 제외하고 오래된 순으로 돌려준다', async () => {
    const f = createFakeAdmin({
      contract_signature_evidence: [ev('e1'), ev('e2', 'c-gone'), ev('e3'), ev('e4'), ev('e5')],
      contract_final_documents: [{ evidence_id: 'e4' }],
      contracts: [{ id: 'c-alive' }],
      contract_audit_log: [fail('e3', 600, true), { contract_id: 'c-alive', event_type: 'evidence_failed', created_at: minutesAgo(1), metadata: { stage: 'sign', error: 'x' } }],
    })
    const r = await listPendingEvidence(f.admin, 10, { now: NOW })
    expect(r.items.map((p) => p.id)).toEqual(['e1', 'e5'])
    expect(r).toMatchObject({ waiting: 0, stalled: 0 })
  })

  it('실패 이력이 있는 건은 재시도 대기가 지난 뒤에만 돌려주고, 실패가 적은 건을 앞으로 둔다(영구 정지 없음)', async () => {
    const f = createFakeAdmin({
      contract_signature_evidence: [ev('e1'), ev('e2'), ev('e3'), ev('e4')],
      contracts: [{ id: 'c-alive' }],
      contract_audit_log: [
        fail('e1', 5),                                   // 1회 실패, 10분 대기 중 → 건너뜀
        fail('e2', 30),                                  // 1회 실패, 10분 경과 → 재시도
        ...[400, 300, 200, 150, 130].map((m) => fail('e3', m)), // 5회 실패, 마지막 130분 전(상한 2시간 경과) → 재시도, 막힌 건으로 집계
      ],
    })
    const r = await listPendingEvidence(f.admin, 10, { now: NOW })
    expect(r.items.map((p) => p.id)).toEqual(['e4', 'e2', 'e3']) // 새 건 → 실패 1회 → 실패 5회
    expect(r.waiting).toBe(1)
    expect(r.stalled).toBe(1)
    // 운영자 수동 재시도(?retry=1)는 대기를 무시한다
    expect((await listPendingEvidence(f.admin, 10, { now: NOW, ignoreBackoff: true })).items.map((p) => p.id)).toContain('e1')
  })

  it('재시도 대기 시간은 10분부터 두 배씩 늘고 2시간에서 멈춘다', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(archiveRetryDelayMs)).toEqual([0, 10, 20, 40, 80, 120, 120].map((m) => m * 60_000))
  })

  it('조회는 한 번에 50건 단위로 이어서 끝까지 찾는다(.in()에 많은 id를 넣지 않음)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ev(`e${String(i).padStart(3, '0')}`))
    const f = createFakeAdmin({ contract_signature_evidence: many, contracts: [{ id: 'c-alive' }], contract_audit_log: [] })
    const r = await listPendingEvidence(f.admin, 100, { now: NOW })
    expect(r.items).toHaveLength(100)
    expect(r.items[0].id).toBe('e000')
  })

  it('recordArchiveFailure는 사유·영구 여부를 담은 실패 이벤트를 남기고 성공 여부를 돌려준다', async () => {
    const f = createFakeAdmin({})
    expect(await recordArchiveFailure(f.admin, (await evidenceFor(null)), 'invalid_pdf_output', false)).toBe(true)
    expect(f.inserts.contract_audit_log[0]).toMatchObject({ contract_id: 'c-1', event_type: 'evidence_failed', metadata: { stage: 'archive', evidence_id: 'ev-1', reason: 'invalid_pdf_output', permanent: false } })
  })
})

describe('listLegacySignings — 소급 대상(증적 없는 서명 완료 건)을 끝까지 훑는다', () => {
  it('50건 단위 페이지를 넘어 이어서 찾고, 이미 증적이 있는 건은 제외한다', async () => {
    const signings = Array.from({ length: 130 }, (_, i) => ({ id: `s${String(i).padStart(3, '0')}`, contract_id: `c${i}`, signed_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, ip_address: null, content_hash: null, signature_data: 'x' }))
    const evidence = [{ signing_id: 's000', signed_at: '2026-09-01T00:00:00.000Z' }, { signing_id: 's120', signed_at: '2026-09-01T00:00:00.000Z' }]
    const f = createFakeAdmin({ contract_signings: signings, contract_signature_evidence: evidence })
    const r = await listLegacySignings(f.admin, 200)
    expect(r).toHaveLength(128) // 130 - 증적 있는 2건
    expect(r.map((x) => x.id)).not.toContain('s000')
    expect(r.map((x) => x.id)).toContain('s129') // 3번째 페이지(100~129)까지 도달
  })
})
