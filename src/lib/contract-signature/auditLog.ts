/**
 * auditLog.ts — contract_audit_log 기록 헬퍼
 *
 * Phase 8-A-3: 전자계약 주요 이벤트를 append-only 감사로그 테이블에 기록.
 * 분쟁 발생 시 "누가, 언제, 어떤 이벤트를 발생시켰는가"를 증빙하는 용도.
 *
 * 설계 원칙:
 * - DB 오류가 발생해도 주 흐름을 막지 않는다 (silent fail — 로그 기록 실패가 서명 처리를 막으면 안 됨)
 * - actor_type: 'customer' | 'admin' | 'system'
 * - event_type: 'viewed' | 'signed' | 'sent' | 'issuer_signed'
 */

export type AuditEventType = 'viewed' | 'signed' | 'sent' | 'issuer_signed'
export type AuditActorType = 'customer' | 'admin' | 'system'

export interface AuditLogParams {
  contractId: string
  eventType: AuditEventType
  actorType: AuditActorType
  actorId: string | null
  ipAddress: string | null
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
    await admin.from('contract_audit_log').insert({
      contract_id: params.contractId,
      event_type:  params.eventType,
      actor_type:  params.actorType,
      actor_id:    params.actorId,
      ip_address:  params.ipAddress,
    })
  } catch {
    // silent fail — 감사로그 실패가 주 트랜잭션을 막으면 안 됨
    // 서버 로그(Vercel Function Logs)에서 사후 확인 가능
  }
}
