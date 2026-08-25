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
    await admin.from('cms_admin_audit_log').insert({
      user_id: entry.actorId,
      action_type: entry.actionType,
      target_user_id: entry.targetUserId,
      before_value: entry.beforeValue ?? null,
      after_value: entry.afterValue ?? null,
    })
  } catch {
    // 감사로그 실패는 무시 — 관리 액션 자체는 이미 성공한 상태를 되돌리지 않는다.
  }
}
