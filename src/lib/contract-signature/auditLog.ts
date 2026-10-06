/**
 * auditLog.ts — contract_audit_log 기록 헬퍼
 *
 * Phase 8-A-3: 전자계약 주요 이벤트를 append-only 감사로그 테이블에 기록.
 * 분쟁 발생 시 "누가, 언제, 어떤 이벤트를 발생시켰는가"를 증빙하는 용도.
 *
 * 설계 원칙:
 * - DB 오류가 발생해도 주 흐름을 막지 않는다 (silent fail — 로그 기록 실패가 서명 처리를 막으면 안 됨)
 * - actor_type: 'customer' | 'admin' | 'system'
 * - event_type: 'viewed' | 'signed' | 'sent' | 'issuer_signed' | 'cancelled'
 *   ('cancelled' = 2026-09-07 Migration #457 추가 — 전자계약 발행취소(서명완료건 포함,
 *    cancel_issued_contract RPC) 기록용. 서명 데이터를 비가역적으로 완전 삭제하는 액션이라
 *    "누가·언제 취소했는가"를 남길 유일한 증빙 지점이다.)
 *   + 2026-10-06 Migration #651: 'consented' | 'evidence_saved' | 'evidence_failed' |
 *     'archive_created' | 'copy_sent' | 'copy_downloaded' (서명 증적·PDF 보관·사본 교부)
 *   ⚠️ DB에 event_type CHECK 제약이 있어 목록에 없는 값은 silent fail로 조용히 거부된다 —
 *      새 이벤트를 추가할 때는 마이그레이션으로 CHECK를 먼저 넓힐 것.
 * - metadata: 2026-10-06 Migration #650 — 해시·건수 등 부가정보(선택). 개인정보 원문은 넣지 않는다.
 */

export type AuditEventType =
  | 'viewed' | 'signed' | 'sent' | 'issuer_signed' | 'cancelled'
  | 'consented' | 'evidence_saved' | 'evidence_failed' | 'archive_created' | 'copy_sent' | 'copy_downloaded'
export type AuditActorType = 'customer' | 'admin' | 'system'

export interface AuditLogParams {
  contractId: string
  eventType: AuditEventType
  actorType: AuditActorType
  actorId: string | null
  ipAddress: string | null
  metadata?: Record<string, unknown> | null
}

// Supabase admin client 타입을 최소한으로 정의 (제네릭 충돌 방지 — core-rules.md 패턴 준수)
// PromiseLike<...>로 정의해 PostgrestFilterBuilder(thenable)와도 호환
interface MinimalAdminClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>
  }
}

/**
 * contract_audit_log에 이벤트를 기록한다.
 *
 * @param admin  - Supabase service_role 클라이언트
 * @param params - 기록할 이벤트 파라미터
 */
export async function recordAuditLog(
  admin: MinimalAdminClient,
  params: AuditLogParams,
): Promise<void> {
  try {
    const { error } = await admin.from('contract_audit_log').insert({
      contract_id: params.contractId,
      event_type:  params.eventType,
      actor_type:  params.actorType,
      actor_id:    params.actorId,
      ip_address:  params.ipAddress,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    })
    // supabase-js는 DB 오류를 예외가 아니라 { error }로 돌려준다 — 흔적이라도 서버 로그에 남긴다(주 흐름은 계속)
    if (error) console.error('[auditLog] contract_audit_log insert 실패(fail-soft):', params.eventType, (error as { message?: string }).message ?? error)
  } catch {
    // silent fail — 감사로그 실패가 주 트랜잭션을 막으면 안 됨
    // 서버 로그(Vercel Function Logs)에서 사후 확인 가능
  }
}
