/**
 * verifyArchive.ts — 제출된 PDF 파일의 진위 판정 (서버 판정, 해시 대조)
 *
 * 위협: 고객·제3자가 내려받은 계약서 PDF를 편집 도구나 AI로 수정하거나 같은 모양으로 다시 만들어 "원본"이라며 제시한다.
 * 방어 원칙:
 *   1) 판정은 오직 서버의 보관 기록과의 대조로만 한다 — 브라우저가 계산한 파일 지문(SHA-256)을 받아 서버가 비교한다.
 *      PDF 안에 적힌 해시 글자는 위조자가 함께 고쳐 쓸 수 있으므로 판단 근거로 쓰지 않는다.
 *   2) 한 글자라도 다른 파일(수정·재생성·재저장)은 모두 "불일치"다. 해시 충돌 없이 같은 지문을 만들 수 없다.
 *   3) 서버 보관 파일 자체가 기록과 다르면(내부 훼손·교체 의심) 별도로 알린다(archiveIntact=false).
 *   4) 취소·재서명 전의 이전 서명본은 진본이어도 "효력 없는 이전 본"(superseded)으로 구분한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatKstDateTimeDot } from '$lib/utils/kstDate'
import { recordAuditLog } from '$lib/contract-signature/auditLog'
import { ARCHIVE_BUCKET } from './generateArchive'
import { findCurrentFinalDocument, sha256OfBytes, type ArchivedPdf } from './loadArchivedPdf'
import { checkSeal, type SealStatus } from './sealArchive'
import type { SealPublicKey } from './seal'

export type VerifyStatus =
  | 'authentic'   // 현재 유효한 서명본과 한 글자도 다르지 않다
  | 'superseded'  // 서명 당시 발급된 진본이지만 발행 취소·재서명으로 효력이 없는 이전 본이다
  | 'modified'    // 계약의 어떤 보관본과도 일치하지 않는다(수정·재생성·다른 파일)
  | 'not_found'   // (공개 확인) 일치하는 보관 기록이 없다

export interface VerifyResult {
  status: VerifyStatus
  /** 서버 보관 파일이 기록된 지문과 같은가 — false면 내부 훼손 의심(운영 경보 대상). 판단 불가면 null */
  archiveIntact: boolean | null
  /** 서명 봉인 점검 결과(공개키 목록을 넘긴 경우에만). 'invalid'는 내부 기록 변조 의심 — 운영 경보 대상 */
  seal?: SealStatus
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * 순수 판정. submitted = 제출 파일 지문, current = 현재 유효 보관본의 기록 지문과 보관 파일의 실제 지문,
 * others = 같은 계약의 다른(취소된 이전) 보관본 기록 지문들.
 */
export function evaluateSubmittedHash(args: {
  submitted: string
  current: { recorded: string | null; actual: string } | null
  others: string[]
}): VerifyResult {
  const { submitted, current, others } = args
  const archiveIntact = current ? current.recorded != null && current.actual === current.recorded : null
  if (current?.recorded && submitted === current.recorded) return { status: 'authentic', archiveIntact }
  if (others.includes(submitted)) return { status: 'superseded', archiveIntact }
  return { status: current ? 'modified' : 'not_found', archiveIntact }
}

/** 로그인한 계약 당사자 — 이미 불러온 현재 보관본(pdf)과 제출 지문을 대조한다(보관 파일을 다시 내려받지 않는다). */
export async function verifyOwnerFile(admin: SupabaseClient, pdf: ArchivedPdf, contractIds: string[], submittedSha256: string, sealKeys?: SealPublicKey[]): Promise<VerifyResult> {
  const { data } = await admin
    .from('contract_final_documents')
    .select('id, pdf_sha256')
    .in('contract_id', contractIds.length > 0 ? contractIds : ['00000000-0000-0000-0000-000000000000'])
  const others = ((data ?? []) as { id: string; pdf_sha256: string | null }[])
    .filter((d) => d.id !== pdf.finalDocumentId && d.pdf_sha256)
    .map((d) => d.pdf_sha256 as string)
  const result = evaluateSubmittedHash({
    submitted: submittedSha256,
    current: { recorded: pdf.recordedSha256, actual: await sha256OfBytes(pdf.bytes) },
    others,
  })
  if (sealKeys) result.seal = (await checkSeal(admin, pdf.finalDocumentId, sealKeys)).status
  return result
}

/** 예약코드 일부만 보이도록 가린다(공개 확인 화면용): CS26104426 → CS26****26 */
export function maskReservationCode(code: string | null | undefined): string | null {
  if (!code) return null
  if (code.length <= 6) return `${code.slice(0, 2)}****`
  return `${code.slice(0, 4)}${'*'.repeat(Math.max(code.length - 6, 2))}${code.slice(-2)}`
}

export interface PublicVerifyResult extends VerifyResult {
  /** 일치하는 기록이 있을 때만 — 개인정보 없이 최소 정보만 */
  info: { signedAtKst: string; source: 'original' | 'regenerated'; reservationCode: string | null } | null
  contractId: string | null
  finalDocumentId: string | null
}

/**
 * 로그인 없는 공개 확인 — 제출된 지문과 정확히 일치하는 보관 기록이 있는지만 본다.
 * 일치할 때만 보관 파일을 내려받아 보관 상태(archiveIntact)를 점검한다(불일치 요청은 스토리지를 건드리지 않는다).
 */
export async function verifyPublicHash(admin: SupabaseClient, submittedSha256: string, sealKeys?: SealPublicKey[]): Promise<PublicVerifyResult> {
  const { data } = await admin
    .from('contract_final_documents')
    .select('id, contract_id, evidence_id, pdf_path, pdf_sha256, source')
    .eq('pdf_sha256', submittedSha256)
    .limit(1)
    .maybeSingle()
  const doc = data as { id: string; contract_id: string; evidence_id: string; pdf_path: string; pdf_sha256: string; source: 'original' | 'regenerated' } | null
  if (!doc) return { status: 'not_found', archiveIntact: null, info: null, contractId: null, finalDocumentId: null }

  const [{ data: ev }, current, dl] = await Promise.all([
    admin.from('contract_signature_evidence').select('signed_at, reservation_id').eq('id', doc.evidence_id).maybeSingle(),
    findCurrentFinalDocument(admin, [doc.contract_id]),
    admin.storage.from(ARCHIVE_BUCKET).download(doc.pdf_path),
  ])
  const evidence = ev as { signed_at: string; reservation_id: number | string | null } | null
  let reservationCode: string | null = null
  if (evidence?.reservation_id != null) {
    const { data: r } = await admin.from('rental_reservations').select('reservation_code').eq('id', evidence.reservation_id).maybeSingle()
    reservationCode = (r as { reservation_code: string | null } | null)?.reservation_code ?? null
  }
  const actual = dl.data ? await sha256OfBytes(new Uint8Array(await dl.data.arrayBuffer())) : null
  const seal = sealKeys ? (await checkSeal(admin, doc.id, sealKeys)).status : undefined
  return {
    status: current?.id === doc.id ? 'authentic' : 'superseded',
    archiveIntact: actual == null ? null : actual === doc.pdf_sha256,
    ...(seal ? { seal } : {}),
    contractId: doc.contract_id,
    finalDocumentId: doc.id,
    info: evidence
      ? { signedAtKst: formatKstDateTimeDot(new Date(evidence.signed_at)), source: doc.source, reservationCode: maskReservationCode(reservationCode) }
      : null,
  }
}

/**
 * 확인 결과를 감사로그에 남긴다 — 누가(당사자/익명) 언제 어떤 결과를 확인했는지, 서버 보관 파일 이상(archiveIntact=false)은 별도 경보 이벤트로.
 * 경보는 evidence_failed(stage='verify')로 남겨 PDF 생성 대기열(stage='archive')에는 영향이 없다.
 */
export async function recordVerifyOutcome(
  admin: SupabaseClient,
  args: { contractId: string | null; finalDocumentId?: string | null; result: VerifyResult; via: 'owner' | 'public'; actorId: string | null; ip: string | null },
): Promise<void> {
  if (!args.contractId) return // 일치하는 기록이 없는 공개 확인은 남길 계약이 없다
  const audit = admin as Parameters<typeof recordAuditLog>[0]
  await recordAuditLog(audit, {
    contractId: args.contractId,
    eventType: 'viewed',
    actorType: args.via === 'owner' ? 'customer' : 'system',
    actorId: args.actorId,
    ipAddress: args.ip,
    metadata: { kind: 'verify_file', via: args.via, status: args.result.status, archive_intact: args.result.archiveIntact, final_document_id: args.finalDocumentId ?? null },
  })
  if (args.result.archiveIntact === false) {
    await recordAuditLog(audit, {
      contractId: args.contractId,
      eventType: 'evidence_failed',
      actorType: 'system',
      actorId: null,
      ipAddress: null,
      metadata: { stage: 'verify', reason: 'archive_hash_mismatch', final_document_id: args.finalDocumentId ?? null, via: args.via },
    })
  }
  // 서명 봉인이 현재 DB 기록과 맞지 않으면 봉인 이후 기록이 바뀐 것 — 내부 변조 의심 경보
  if (args.result.seal === 'invalid') {
    await recordAuditLog(audit, {
      contractId: args.contractId,
      eventType: 'evidence_failed',
      actorType: 'system',
      actorId: null,
      ipAddress: null,
      metadata: { stage: 'verify', reason: 'seal_invalid', final_document_id: args.finalDocumentId ?? null, via: args.via },
    })
  }
}
