import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSealMessage, loadSealKey, loadSealPublicKeys, signSeal, verifySealSignature } from '$lib/server/contractArchive/seal'
import { buildPageMap, canonicalJson, comparePageMaps, extractPageTexts, pageMapSha256, parsePageMap } from '$lib/server/contractArchive/pdfFingerprint'
import { checkSeal, sealFinalDocument } from '$lib/server/contractArchive/sealArchive'
import { SEAL_AUTO_WINDOW_MS, sealPendingDocuments } from '$lib/server/contractArchive/sealPending'

function pemKey(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
}

/** 줄 목록으로 쪽별 텍스트가 있는 최소 PDF를 만든다(Helvetica, 영문만) */
function miniPdf(pages: string[][]): Uint8Array {
  const objs: string[] = []
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 14 TL 50 700 Td ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(out)
}

describe('서명 봉인 — 키·서명', () => {
  it('PEM·\\n 이스케이프 PEM·base64 DER 형식 모두 읽는다', () => {
    const pem = pemKey()
    const a = loadSealKey(pem)
    const b = loadSealKey(pem.replace(/\n/g, '\\n'))
    const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64').toString('base64')
    const c = loadSealKey(der)
    expect(a && b && c).toBeTruthy()
    expect(a!.keyId).toBe(b!.keyId)
    expect(a!.keyId).toBe(c!.keyId)
    expect(a!.keyId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('없거나 잘못된 키·Ed25519가 아닌 키는 null(봉인 꺼짐)이다', () => {
    expect(loadSealKey(undefined)).toBeNull()
    expect(loadSealKey('  ')).toBeNull()
    expect(loadSealKey('not-a-key')).toBeNull()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(loadSealKey(rsa)).toBeNull()
  })

  it('서명은 원문이 한 글자만 달라도 검증에 실패하고, 다른 키로는 검증되지 않는다', () => {
    const key = loadSealKey(pemKey())!
    const other = loadSealKey(pemKey())!
    const msg = buildSealMessage({ contractId: 'c', evidenceId: 'e', signingId: 's', finalDocumentId: 'f', signedAt: '2026-10-08T00:00:00.000Z', pdfSha256: 'a'.repeat(64), pageMapSha256: 'b'.repeat(64), source: 'original' })
    const sig = signSeal(key, msg)
    expect(verifySealSignature(key.publicKey, msg, sig)).toBe(true)
    expect(verifySealSignature(key.publicKey, msg.replace('a'.repeat(64), 'a'.repeat(63) + 'c'), sig)).toBe(false)
    expect(verifySealSignature(other.publicKey, msg, sig)).toBe(false)
    expect(verifySealSignature(key.publicKey, msg, 'AAAA')).toBe(false)
  })

  it('이전 공개키(ARCHIVE_SEAL_PUBLIC_KEYS)도 검증 목록에 합쳐진다', () => {
    const cur = loadSealKey(pemKey())!
    const old = loadSealKey(pemKey())!
    const keys = loadSealPublicKeys(cur, JSON.stringify([old.publicKeyPem, 'garbage']))
    expect(keys.map((k) => k.keyId).sort()).toEqual([cur.keyId, old.keyId].sort())
    expect(loadSealPublicKeys(null, 'not json')).toEqual([])
  })
})

describe('쪽별 지문 지도', () => {
  it('canonicalJson은 키 순서와 무관하게 같은 문자열을 만든다(jsonb는 키 순서를 보존하지 않는다)', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }))
  })

  it('PDF에서 쪽별 줄을 뽑아 지도를 만들고, 같은 내용이면 같은 지도다', async () => {
    const pdf = miniPdf([['Rental fee 120000 won', 'Period 2026-10-08'], ['Equipment SONY FX3']])
    const texts = await extractPageTexts(pdf)
    expect(texts).toHaveLength(2)
    const a = await buildPageMap(texts)
    const b = await buildPageMap(await extractPageTexts(miniPdf([['Rental fee 120000 won', 'Period 2026-10-08'], ['Equipment SONY FX3']])))
    expect(await pageMapSha256(a)).toBe(await pageMapSha256(b))
    expect(parsePageMap(JSON.parse(JSON.stringify(a)))).toEqual(a)
  })

  it('금액이 바뀐 쪽만 changed로 찾고, 바뀐 줄 원문을 돌려준다(관리자 전용 분석)', async () => {
    const original = await buildPageMap(await extractPageTexts(miniPdf([['Rental fee 120000 won', 'Period 2026-10-08'], ['Equipment SONY FX3']])))
    const tamperedTexts = await extractPageTexts(miniPdf([['Rental fee 12000 won', 'Period 2026-10-08'], ['Equipment SONY FX3']]))
    const cmp = await comparePageMaps(original, await buildPageMap(tamperedTexts), tamperedTexts)
    expect(cmp.textIdentical).toBe(false)
    expect(cmp.pages.map((p) => p.status)).toEqual(['changed', 'same'])
    expect(cmp.pages[0].changedLines).toEqual(['Rental fee 12000 won'])
    expect(cmp.pages[0].missingLineCount).toBe(1)
  })

  it('쪽이 추가·삭제된 경우를 구분하고, 내용이 같으면 textIdentical이다', async () => {
    const base = await buildPageMap(await extractPageTexts(miniPdf([['A one'], ['B two']])))
    const fewerTexts = await extractPageTexts(miniPdf([['A one']]))
    const fewer = await comparePageMaps(base, await buildPageMap(fewerTexts), fewerTexts)
    expect(fewer.pages.map((p) => p.status)).toEqual(['same', 'missing'])
    const sameTexts = await extractPageTexts(miniPdf([['A one'], ['B two']]))
    const same = await comparePageMaps(base, await buildPageMap(sameTexts), sameTexts)
    expect(same.textIdentical).toBe(true)
  })
})

// ── 가짜 저장소로 봉인 생성·검증 흐름 확인 ──
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, failTables: string[] = []) {
  const inserted: Record<string, unknown>[] = []
  const admin = {
    from(table: string) {
      const rows = tables[table] ?? []
      const filters: [string, unknown][] = []
      const api = {
        select: () => api,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return api },
        limit: () => api,
        maybeSingle: async () => failTables.includes(table) ? ({ data: null, error: { message: 'db down' } }) : ({ data: rows.find((r) => filters.every(([c, v]) => (c.includes('->>') ? (r.metadata as Record<string, unknown> | undefined)?.[c.split('->>')[1]] === v : r[c] === v))) ?? null, error: null }),
        insert: async (row: Record<string, unknown>) => { inserted.push(row); tables[table] = [...rows, row]; return { error: null } },
      }
      return api
    },
  }
  return { admin: admin as unknown as SupabaseClient, inserted }
}

describe('봉인 생성·점검(checkSeal)', () => {
  const key = loadSealKey(pemKey())!
  const pdf = miniPdf([['Rental fee 120000 won']])
  const target = { finalDocumentId: 'fd1', contractId: 'c1', evidenceId: 'ev1', signingId: 's1', signedAt: '2026-10-08T01:02:03.000Z', pdfSha256: 'a'.repeat(64), source: 'original' as const }
  const docRow = { id: 'fd1', contract_id: 'c1', signing_id: 's1', evidence_id: 'ev1', pdf_sha256: 'a'.repeat(64), source: 'original' }
  const evRow = { id: 'ev1', signed_at: '2026-10-08T01:02:03+00:00' }

  async function sealed() {
    const tables: Record<string, Record<string, unknown>[]> = { contract_final_documents: [{ ...docRow }], contract_signature_evidence: [{ ...evRow }], contract_final_document_seals: [], contract_audit_log: [] }
    const { admin, inserted } = fakeAdmin(tables)
    const r = await sealFinalDocument(admin, target, pdf, key)
    return { tables, admin, inserted, r }
  }

  it('봉인을 만들면 서명이 DB 기록과 일치해 valid다', async () => {
    const { admin, r } = await sealed()
    expect(r).toEqual({ ok: true, alreadySealed: false, markerRecorded: true })
    expect((await checkSeal(admin, 'fd1', loadSealPublicKeys(key, null))).status).toBe('valid')
  })

  it('같은 보관본을 다시 봉인해도 중복을 만들지 않는다(멱등)', async () => {
    const { admin, inserted } = await sealed()
    expect(await sealFinalDocument(admin, target, pdf, key)).toEqual({ ok: true, alreadySealed: true })
    expect(inserted.filter((r) => 'signature' in r)).toHaveLength(1)
  })

  it('DB의 PDF 지문을 새로 써 바꾸면(내부자 변조) 비밀키 없이는 봉인을 다시 못 만들어 invalid로 드러난다', async () => {
    const { tables, admin } = await sealed()
    tables.contract_final_documents[0].pdf_sha256 = 'f'.repeat(64)
    expect((await checkSeal(admin, 'fd1', loadSealPublicKeys(key, null))).status).toBe('invalid')
  })

  it('저장된 쪽별 지도를 바꿔도 invalid다', async () => {
    const { tables, admin } = await sealed()
    const seal = tables.contract_final_document_seals[0] as { page_map: { pages: { compactSha: string }[] } }
    seal.page_map = { ...seal.page_map, pages: [{ ...seal.page_map.pages[0], compactSha: '0'.repeat(64) }] }
    expect((await checkSeal(admin, 'fd1', loadSealPublicKeys(key, null))).status).toBe('invalid')
  })

  it('봉인 표식(감사로그)이 함께 남는다', async () => {
    const { tables } = await sealed()
    expect(tables.contract_audit_log).toHaveLength(1)
    expect(tables.contract_audit_log[0]).toMatchObject({ contract_id: 'c1', event_type: 'archive_created', metadata: { kind: 'sealed', final_document_id: 'fd1', key_id: key.keyId } })
  })

  it('봉인된 적이 있는데 봉인 행이 지워졌으면 invalid로 판정하고, 새 서명도 찍어 주지 않는다(A안)', async () => {
    const { tables, admin } = await sealed()
    tables.contract_final_document_seals.length = 0 // 내부자가 봉인 행을 삭제했다고 가정
    expect((await checkSeal(admin, 'fd1', loadSealPublicKeys(key, null))).status).toBe('invalid')
    expect(await sealFinalDocument(admin, target, pdf, key)).toEqual({ ok: false, reason: 'seal_missing_after_sealed' })
    expect(tables.contract_final_document_seals).toHaveLength(0)
  })

  it('조회 오류는 "없음"이 아니라 unknown이다 — 봉인 행·문서·증적·표식 어느 조회가 실패해도 invalid 오경보가 나지 않는다', async () => {
    const { tables } = await sealed()
    const keys = loadSealPublicKeys(key, null)
    for (const failing of ['contract_final_document_seals', 'contract_final_documents', 'contract_signature_evidence']) {
      const { admin } = fakeAdmin(tables, [failing])
      expect((await checkSeal(admin, 'fd1', keys)).status, failing).toBe('unknown')
    }
    // 봉인 행이 없고(삭제 가정) 표식 조회가 실패하는 경우도 invalid가 아니라 unknown
    const noSeal = { ...tables, contract_final_document_seals: [] }
    expect((await checkSeal(fakeAdmin(noSeal, ['contract_audit_log']).admin, 'fd1', keys)).status).toBe('unknown')
  })

  it('봉인이 없으면 unsealed, 공개키가 없으면 no_key다', async () => {
    const { admin } = await sealed()
    expect((await checkSeal(fakeAdmin({ contract_final_documents: [docRow], contract_signature_evidence: [evRow], contract_final_document_seals: [], contract_audit_log: [] }).admin, 'fd1', [])).status).toBe('unsealed')
    expect((await checkSeal(admin, 'fd1', [])).status).toBe('no_key')
  })
})

describe('크론 소급 봉인 — 최근 보관본만(A안)', () => {
  it('생성 시각 기준 최근 구간(6시간)만 조회하고, 시간 예산이 지나면 남은 건을 미룬다', async () => {
    const key = loadSealKey(pemKey())!
    const calls: { gte?: unknown } = {}
    const docs = [{ id: 'd1', contract_id: 'c', signing_id: 's', evidence_id: 'e', pdf_path: 'p', pdf_sha256: 'a'.repeat(64), source: 'original' }]
    const q = { select: () => q, is: () => q, gte: (_c: string, v: unknown) => { calls.gte = v; return q }, order: () => q, in: async () => ({ data: [{ id: 'c' }], error: null }), limit: async () => ({ data: docs, error: null }) }
    const admin = { from: () => q } as unknown as SupabaseClient
    const now = new Date('2026-10-08T12:00:00Z')
    const r = await sealPendingDocuments(admin, key, 20, { now, deadlineMs: Date.now() - 1 })
    expect(calls.gte).toBe(new Date(now.getTime() - SEAL_AUTO_WINDOW_MS).toISOString())
    expect(SEAL_AUTO_WINDOW_MS).toBe(6 * 60 * 60_000)
    expect(r).toMatchObject({ sealed: 0, deferred: 1 })
  })
})

describe('변경 위치는 관리자 전용', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  it('고객·공개 경로의 소스는 쪽별 대조(변경 위치)를 쓰지 않는다', () => {
    for (const p of ['src/routes/api/contracts/verify-file/+server.ts', 'src/routes/api/account/rental/[id]/contract-pdf/+server.ts', 'src/lib/server/contractArchive/verifyArchive.ts']) {
      const src = read(p)
      expect(src, p).not.toMatch(/comparePageMaps|changedLines|extractPageTexts/)
    }
  })

  it('쪽별 대조 엔드포인트는 관리자 메뉴 게이트와 CMS 역할 확인을 거친다', () => {
    const src = read('src/routes/api/cms/contracts/[id]/compare-file/+server.ts')
    expect(src).toContain("requireMenuAccessApi(locals, 'rental.reservation')")
    expect(src).toContain('getCmsRoleForAction')
    expect(read('src/lib/server/menuAccessMap.ts')).toContain("'src/routes/api/cms/contracts/[id]/compare-file'")
  })

  it('공개 응답에는 봉인 내부 이상(invalid)을 싣지 않고 정상 여부(sealed)만 싣는다', () => {
    const src = read('src/routes/api/contracts/verify-file/+server.ts')
    expect(src).toContain("sealed: result.seal === 'valid'")
    expect(src).not.toMatch(/seal:\s*result\.seal/)
  })
})
