/**
 * autoIssueOnDocApproval.ts — 고객 본인증명 서류 승인 직후, '예약승인'을 눌렀던 예약만 전자계약 자동 발행·발송 (2026-10-15, Stephen 확정)
 *
 * 흐름: 관리자가 예약목록에서 '예약승인'을 눌렀는데 고객 서류가 미승인이라 계약서를 못 보낸 예약은 rental_reservations.approve_requested_at 에 시각이 남는다(Migration #718).
 *       관리자가 고객 서류를 승인하면(/api/cms/approve-doc) 이 함수가 그 표식이 있는 신청대기(hold) 예약에 대해서만 자동발행(autoIssueContractOnApproval)을 실행하고 표식을 비운다.
 *  · 예약승인을 누르지 않은 예약에는 아무것도 보내지 않는다.
 *  · 자동발행 표준양식이 없으면(토글 OFF) 발행하지 않는다 — 표식을 비우고 '예약승인 완료'(approved_at)로 기록해, 관리자가 계약서 탭에서 수동 발행·발송한다.
 *  · 같은 주문의 형제 예약은 계약서가 주문당 1건이라 첫 예약에서 발행되면 나머지는 'contract_exists'로 건너뛴다(정상).
 *  · 표식은 발행 전에 먼저 가져가며(claim) 비운다 — 동시 중복 실행 방지. 발행 실패·건너뜀도 표식은 비운다(영구 '승인대기' 방지) — 사유는 호출부가 관리자에게 안내한다.
 *  · 표식 컬럼이 아직 없는 환경(마이그레이션 미적용)에서는 조회 오류를 '대상 없음'으로 본다(fail-soft).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDocGateStatus, type DocGateRow } from '$lib/utils/docApproval'
import { autoIssueContractOnApproval, hasAutoIssueTemplate, type AutoIssueResult } from '$lib/server/contractAutoIssue'

export interface DocApprovalAutoIssueSummary {
  /** 계약서를 새로 발행·발송한 주문 수 */
  sent: number
  /** 자동발행하지 못한 사유(관리자 안내용) — 같은 주문 형제의 'contract_exists'는 제외 */
  skippedMessages: string[]
}

export async function autoIssueAfterDocApproval(
  deps: { admin: SupabaseClient; fetch: typeof fetch },
  userId: string,
): Promise<DocApprovalAutoIssueSummary> {
  const summary: DocApprovalAutoIssueSummary = { sent: 0, skippedMessages: [] }
  const { admin } = deps

  // 승인 직후 서류 상태를 다시 읽어 실제로 승인(approved)인지 확인한다
  const { data: prof } = await admin
    .from('user_profiles')
    .select(
      'identity_doc_url, identity_type, identity_verified_at, identity_approved_at, ' +
        'foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at',
    )
    .eq('id', userId)
    .maybeSingle()
  if (getDocGateStatus(prof as DocGateRow | null) !== 'approved') return summary

  // 표식을 '먼저 가져간다'(claim) — 갱신과 동시에 대상 id를 돌려받아, 서류 승인이 동시에 두 번 처리돼도 같은 예약을 한 번만 발행한다(QA M-1).
  // 발행 실패·건너뜀 때도 표식은 비우는 정책이라 이 순서로 바꿔도 의미가 같다.
  const { data: claimed, error } = await admin
    .from('rental_reservations')
    // 서류가 승인됐으므로 이 예약들은 '예약승인 완료'(approved_at, Migration #719)가 된다 — 자동발행 여부와 무관하게 계약서 탭 수동 발행이 가능해지고 '계약대기' 칩으로 옮겨진다
    .update({ approve_requested_at: null, approved_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'hold')
    .not('approve_requested_at', 'is', null)
    .select('id')
  if (error || !claimed || claimed.length === 0) return summary
  const ids = (claimed as Array<{ id: number }>).map((r) => r.id).sort((a, b) => a - b)

  if (await hasAutoIssueTemplate(admin)) {
    for (const id of ids) {
      let r: AutoIssueResult
      try {
        r = await autoIssueContractOnApproval(deps, id)
      } catch {
        r = { status: 'skipped', reason: 'issue_failed', message: '계약서 자동발행 중 오류가 발생했어요.' }
      }
      if (r.status === 'sent') summary.sent += 1
      else if (r.status === 'skipped' && r.reason !== 'contract_exists') summary.skippedMessages.push(r.message)
    }
  }

  return summary
}
