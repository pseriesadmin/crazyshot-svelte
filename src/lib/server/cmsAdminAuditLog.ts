import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * cms_admin_audit_log 신설 대상 이벤트 (Migration #353, Stage 7 / Q8 확정).
 */
export type CmsAdminAuditActionType =
  | 'role_change'
  | 'create'
  | 'delete'
  | 'suspend'
  | 'menu_permission_change'
  | 'concurrent_login_change'
  | 'session_limit_change'
  | 'name_change'
  | 'password_recovery_issued'
  | 'password_recovery_completed'
  | 'doc_view' // 고객 본인증명·외국인증명 서류 열람(서명 URL 발급) — DB CHECK 확장은 서류 비공개 전환 마이그레이션(B2)에서 함께 적용

export interface CmsAdminAuditLogEntry {
  actorId: string | null
  actionType: CmsAdminAuditActionType
  targetUserId: string | null
  beforeValue?: Record<string, unknown> | null
  afterValue?: Record<string, unknown> | null
}

/**
 * cms_admin_audit_log INSERT — fail-soft(감사로그 기록 실패가 실제 관리 액션 실패로
 * 이어지면 안 됨, cms_login_logs와 동일 원칙). append-only 전용 — UPDATE/DELETE 없음.
 */
export async function insertCmsAdminAuditLog(
  admin: SupabaseClient,
  entry: CmsAdminAuditLogEntry
): Promise<void> {
  try {
    // supabase-js의 insert는 예외를 던지지 않고 { error }를 반환한다 — 제약 위반 등 실패가 흔적 없이 사라지지 않도록 로그를 남긴다
    const { error } = await admin.from('cms_admin_audit_log').insert({
      user_id: entry.actorId,
      action_type: entry.actionType,
      target_user_id: entry.targetUserId,
      before_value: entry.beforeValue ?? null,
      after_value: entry.afterValue ?? null,
    })
    if (error) console.error(`[cmsAdminAuditLog] ${entry.actionType} 기록 실패:`, error.message)
  } catch {
    // 감사로그 실패는 무시 — 관리 액션 자체는 이미 성공한 상태를 되돌리지 않는다.
  }
}
