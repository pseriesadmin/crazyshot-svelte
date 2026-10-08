import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateSubmittedHash, isSha256Hex, maskReservationCode, verifyOwnerFile, verifyPublicHash } from '$lib/server/contractArchive/verifyArchive'
import { sha256OfBytes } from '$lib/server/contractArchive/loadArchivedPdf'
import type { ArchivedPdf } from '$lib/server/contractArchive/loadArchivedPdf'

const H = (c: string) => c.repeat(64) // 64자리 가짜 해시

describe('evaluateSubmittedHash — 제출 파일 지문 판정', () => {
  it('현재 유효 보관본의 기록 지문과 같으면 진본(authentic)이다', () => {
    expect(evaluateSubmittedHash({ submitted: H('a'), current: { recorded: H('a'), actual: H('a') }, others: [] })).toEqual({ status: 'authentic', archiveIntact: true })
  })

  it('한 글자라도 다른 파일(수정·AI 재생성·재저장)은 modified다', () => {
    const almost = 'a'.repeat(63) + 'b'
    expect(evaluateSubmittedHash({ submitted: almost, current: { recorded: H('a'), actual: H('a') }, others: [] })).toEqual({ status: 'modified', archiveIntact: true })
  })

  it('취소·재서명 전의 이전 본은 진본이어도 superseded(효력 없는 이전 본)로 구분한다', () => {
    expect(evaluateSubmittedHash({ submitted: H('c'), current: { recorded: H('a'), actual: H('a') }, others: [H('c')] }).status).toBe('superseded')
    expect(evaluateSubmittedHash({ submitted: H('c'), current: null, others: [H('c')] }).status).toBe('superseded')
  })

  it('현재 유효 보관본이 없고 다른 본과도 다르면 not_found다', () => {
    expect(evaluateSubmittedHash({ submitted: H('d'), current: null, others: [] })).toEqual({ status: 'not_found', archiveIntact: null })
  })

  it('서버 보관 파일이 기록과 다르면(내부 훼손·교체 의심) archiveIntact=false로 알리고, 제출 파일 판정은 기록 기준을 유지한다', () => {
    // 고객 파일은 기록과 같은데 서버의 실제 파일이 다름 → 고객 파일은 진본, 서버는 이상
    expect(evaluateSubmittedHash({ submitted: H('a'), current: { recorded: H('a'), actual: H('z') }, others: [] })).toEqual({ status: 'authentic', archiveIntact: false })
    // 서버 파일이 바꿔치기돼도 그 바뀐 파일을 낸 쪽은 기록과 불일치 — 위조본이 진본으로 통과하지 못한다
    expect(evaluateSubmittedHash({ submitted: H('z'), current: { recorded: H('a'), actual: H('z') }, others: [] })).toEqual({ status: 'modified', archiveIntact: false })
  })

  it('기록 지문이 없는 보관본은 어떤 제출도 진본으로 인정하지 않는다', () => {
    expect(evaluateSubmittedHash({ submitted: H('a'), current: { recorded: null, actual: H('a') }, others: [] })).toEqual({ status: 'modified', archiveIntact: false })
  })
})

describe('보조 함수', () => {
  it('SHA-256 형식 검사는 소문자 64자 hex만 허용한다', () => {
    expect(isSha256Hex(H('a'))).toBe(true)
    expect(isSha256Hex(H('A'))).toBe(false)
    expect(isSha256Hex('a'.repeat(63))).toBe(false)
    expect(isSha256Hex('g'.repeat(64))).toBe(false)
    expect(isSha256Hex(null)).toBe(false)
  })

  it('예약코드는 앞 4자와 끝 2자만 보이게 가린다', () => {
    expect(maskReservationCode('CS26104426')).toBe('CS26****26')
    expect(maskReservationCode('CSRSV26100052')).toBe('CSRS*******52')
    expect(maskReservationCode('CS1')).toBe('CS****')
    expect(maskReservationCode(null)).toBeNull()
  })
})

// 최소 대역 DB — 이 모듈이 쓰는 질의 형태만 지원
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, storage: Record<string, Uint8Array>) {
  function query(t: string) {
    const eqs: [string, unknown][] = []
    const ins: [string, unknown[]][] = []
    const run = () => (tables[t] ?? []).filter((r) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])))
    const api: Record<string, unknown> = {
      select: () => api, not: () => api, order: () => api, limit: () => api,
      eq: (k: string, v: unknown) => { eqs.push([k, v]); return api },
      in: (k: string, vs: unknown[]) => { ins.push([k, vs]); return api },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return {
    from: (t: string) => query(t),
    storage: { from: () => ({ download: async (p: string) => (storage[p] ? { data: new Blob([storage[p] as BlobPart]), error: null } : { data: null, error: { message: 'x' } }) }) },
  } as unknown as SupabaseClient
}

describe('verifyPublicHash — 로그인 없는 공개 확인', () => {
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 1, 2, 3])

  async function setup(over: { storageBytes?: Uint8Array; currentSigned?: boolean } = {}) {
    const sha = await sha256OfBytes(pdfBytes)
    const admin = fakeAdmin(
      {
        contract_final_documents: [{ id: 'fd-1', contract_id: 'c-1', evidence_id: 'ev-1', pdf_path: 'c-1/ev-1.pdf', pdf_sha256: sha, source: 'original', generated_at: '2026-10-07T04:21:00Z' }],
        contract_signature_evidence: [{ id: 'ev-1', signed_at: '2026-10-07T04:20:44.152Z', reservation_id: 7 }],
        rental_reservations: [{ id: 7, reservation_code: 'CSRSV26100052' }],
        contract_signings: over.currentSigned === false ? [] : [{ contract_id: 'c-1', signed_at: '2026-10-07T04:20:44.152Z' }],
      },
      { 'c-1/ev-1.pdf': over.storageBytes ?? pdfBytes },
    )
    return { admin, sha }
  }

  it('보관 기록과 정확히 일치하면 authentic + 개인정보 없는 최소 정보(서명 일시·보관본 구분·가린 예약코드)만 돌려준다', async () => {
    const { admin, sha } = await setup()
    const r = await verifyPublicHash(admin, sha)
    expect(r).toMatchObject({ status: 'authentic', archiveIntact: true, contractId: 'c-1', finalDocumentId: 'fd-1' })
    expect(r.info).toEqual({ signedAtKst: '2026.10.07 13:20', source: 'original', reservationCode: 'CSRS*******52' })
    expect(JSON.stringify(r)).not.toContain('CSRSV26100052') // 전체 예약코드는 노출하지 않는다
  })

  it('기록에 없는 지문(수정·재생성된 파일)은 not_found이고 보관 파일을 읽지 않는다', async () => {
    const { admin } = await setup()
    const r = await verifyPublicHash(admin, H('f'))
    expect(r).toEqual({ status: 'not_found', archiveIntact: null, info: null, contractId: null, finalDocumentId: null })
  })

  it('취소·재서명으로 현재 유효하지 않은 보관본은 superseded다', async () => {
    const { admin, sha } = await setup({ currentSigned: false })
    expect((await verifyPublicHash(admin, sha)).status).toBe('superseded')
  })

  it('서버의 보관 파일이 기록과 다르면 archiveIntact=false로 알린다', async () => {
    const { admin, sha } = await setup({ storageBytes: new Uint8Array([9, 9, 9]) })
    const r = await verifyPublicHash(admin, sha)
    expect(r.archiveIntact).toBe(false)
  })
})

describe('verifyOwnerFile — 로그인 당사자 확인', () => {
  it('현재 보관본·이전 보관본 지문을 구분해 판정한다', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const cur = await sha256OfBytes(bytes)
    const pdf: ArchivedPdf = { finalDocumentId: 'fd-new', contractId: 'c-1', source: 'original', recordedSha256: cur, bytes }
    const admin = fakeAdmin({ contract_final_documents: [{ id: 'fd-new', contract_id: 'c-1', pdf_sha256: cur }, { id: 'fd-old', contract_id: 'c-1', pdf_sha256: H('9') }] }, {})
    expect((await verifyOwnerFile(admin, pdf, ['c-1'], cur)).status).toBe('authentic')
    expect((await verifyOwnerFile(admin, pdf, ['c-1'], H('9'))).status).toBe('superseded')
    expect((await verifyOwnerFile(admin, pdf, ['c-1'], H('8'))).status).toBe('modified')
  })
})
