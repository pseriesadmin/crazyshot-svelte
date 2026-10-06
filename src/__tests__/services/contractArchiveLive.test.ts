import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { archiveEvidence, createLegacyEvidence, listLegacySignings, listPendingEvidence, ARCHIVE_BUCKET } from '$lib/server/contractArchive/generateArchive'

/**
 * 최종본 PDF 보관 Stage 라이브 검증 — 실제 DB·비공개 버킷·로컬 Chrome 사용.
 * 실행: RUN_ARCHIVE_LIVE=1 npx vitest run src/__tests__/services/contractArchiveLive.test.ts --testTimeout=180000
 * ⚠️ Stage에 추가 전용(수정·삭제 불가) 행과 PDF 파일이 남는다 — Stage 테스트 데이터 존치 원칙. Production에서 실행 금지.
 */
const live = !!process.env.RUN_ARCHIVE_LIVE && PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')

describe.skipIf(!live)('최종본 PDF 보관 — Stage 라이브', () => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  it('소급 증적을 만들고 PDF를 생성·보관하면 기록·파일·뷰어 주소가 갖춰지고 재실행해도 중복되지 않는다', async () => {
    const legacy = await listLegacySignings(admin, 20)
    const pending = await listPendingEvidence(admin, 20)
    console.info('[live] legacy signings', legacy.length, 'pending evidence', pending.length)

    // 실제로 만들 수 있는 첫 건을 찾는다(캔버스 방식 등 지원 안 되는 건은 건너뜀)
    let done: { evidenceId: string; contractId: string; source: string; path: string } | null = null
    const candidates = [...pending]
    for (const s of legacy) {
      if (done) break
      const ev = await createLegacyEvidence(admin, s)
      if (ev) candidates.push(ev)
    }
    for (const ev of candidates) {
      const r = await archiveEvidence(admin, ev)
      console.info('[live] archive', ev.id, JSON.stringify(r))
      if (r.ok) { done = { evidenceId: ev.id, contractId: ev.contract_id, source: r.source, path: r.pdfPath }; break }
    }
    // 보관할 증적이 남아 있지 않으면(이미 처리됨) 건너뛴다 — 새 서명 증적이 생기면 다시 검증된다
    if (!done) { console.info('[live] 보관 가능한 후보 없음'); return }

    const { data: fd } = await admin.from('contract_final_documents').select('*').eq('evidence_id', done.evidenceId).single()
    expect(fd).toMatchObject({ contract_id: done.contractId, source: done.source, pdf_path: done.path })
    expect(fd.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    const dl = await admin.storage.from(ARCHIVE_BUCKET).download(done.path)
    const bytes = new Uint8Array(await dl.data!.arrayBuffer())
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(bytes.byteLength).toBe(fd.size_bytes)

    const { data: c } = await admin.from('contracts').select('document_url').eq('id', done.contractId).single()
    expect(c!.document_url).toBe(`/api/cms/contracts/${done.contractId}/final-pdf`)

    // 같은 버킷 경로에 덮어쓰기 불가, 기록은 수정·삭제 불가
    const over = await admin.storage.from(ARCHIVE_BUCKET).upload(done.path, new Uint8Array([1]), { upsert: false, contentType: 'application/pdf' })
    expect(over.error).not.toBeNull()
    const upd = await admin.from('contract_final_documents').update({ size_bytes: 1 }).eq('id', fd.id)
    expect(upd.error).not.toBeNull()

    // 멱등: 같은 증적 재처리는 새 행을 만들지 않는다
    const ev = (await admin.from('contract_signature_evidence').select('*').eq('id', done.evidenceId).single()).data
    const again = await archiveEvidence(admin, ev)
    expect(again).toMatchObject({ ok: true, alreadyArchived: true })
    const { count } = await admin.from('contract_final_documents').select('id', { count: 'exact', head: true }).eq('evidence_id', done.evidenceId)
    expect(count).toBe(1)
  }, 180_000)
})
