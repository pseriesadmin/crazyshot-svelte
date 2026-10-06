/**
 * loadArchivedPdf.ts — 보관된 최종본 PDF 조회(CMS·고객 다운로드 API 공용)
 * 계약(들)의 가장 최근 보관본을 비공개 버킷에서 읽어 바이트로 돌려준다. 접근 권한 판정은 호출부(API)가 먼저 한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ARCHIVE_BUCKET } from './generateArchive'

export interface ArchivedPdf {
  finalDocumentId: string
  contractId: string
  source: 'original' | 'regenerated'
  bytes: Uint8Array
}

export interface CurrentFinalDocument {
  id: string
  contract_id: string
  pdf_path: string
  source: 'original' | 'regenerated'
}

/**
 * 현재 유효한 서명에 해당하는 보관본만 고른다.
 * 서명 완료 건의 발행취소(cancel_issued_contract) 후 재서명하면 첫 서명의 증적·PDF는 추가 전용이라 남지만, 그것은 취소된
 * 서명본이다 — 계약의 현재 signed_at과 일치하는 서명 이벤트의 보관본이 있을 때만 돌려주고(가장 최근 생성본),
 * 없으면 null(재서명 대기·생성 전 = "준비 중")로 본다.
 */
export async function findCurrentFinalDocument(admin: SupabaseClient, contractIds: string[]): Promise<CurrentFinalDocument | null> {
  if (contractIds.length === 0) return null
  const [{ data: signings }, { data: docs }] = await Promise.all([
    admin.from('contract_signings').select('contract_id, signed_at').in('contract_id', contractIds).not('signed_at', 'is', null),
    admin.from('contract_final_documents').select('id, contract_id, evidence_id, pdf_path, source').in('contract_id', contractIds).order('generated_at', { ascending: false }).limit(50),
  ])
  const docRows = (docs ?? []) as (CurrentFinalDocument & { evidence_id: string })[]
  if (docRows.length === 0) return null
  const { data: evs } = await admin.from('contract_signature_evidence').select('id, signed_at').in('id', docRows.map((d) => d.evidence_id))
  const evSignedAt = new Map(((evs ?? []) as { id: string; signed_at: string }[]).map((e) => [e.id, new Date(e.signed_at).getTime()]))
  const current = new Set(((signings ?? []) as { contract_id: string; signed_at: string }[]).map((x) => `${x.contract_id}|${new Date(x.signed_at).getTime()}`))
  return docRows.find((d) => current.has(`${d.contract_id}|${evSignedAt.get(d.evidence_id)}`)) ?? null
}

export async function loadLatestArchivedPdf(admin: SupabaseClient, contractIds: string[]): Promise<ArchivedPdf | null> {
  const row = await findCurrentFinalDocument(admin, contractIds)
  if (!row) return null
  const dl = await admin.storage.from(ARCHIVE_BUCKET).download(row.pdf_path)
  if (dl.error || !dl.data) return null
  return { finalDocumentId: row.id, contractId: row.contract_id, source: row.source, bytes: new Uint8Array(await dl.data.arrayBuffer()) }
}

export function pdfResponse(pdf: ArchivedPdf, filename: string, disposition: 'inline' | 'attachment'): Response {
  return new Response(pdf.bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${disposition}; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
