/**
 * issuerSignatureCheck.ts — 발행자 서명 필수 여부 검증 헬퍼
 *
 * Phase 8-B-4: 계약서 양식의 requires_issuer_signature 플래그가 true이면
 * 발행(send-chat) 시점에 발행자 서명이 반드시 존재해야 함을 확인한다.
 *
 * 설계:
 * - contract.template_id → contract_templates.requires_issuer_signature 조회
 * - true이면 contract_issuer_signatures에 해당 계약 서명 존재 여부 확인
 * - template_id가 없거나 플래그가 false이면 즉시 통과
 */

// 최소한의 Supabase 클라이언트 타입 (PromiseLike로 PostgrestFilterBuilder 호환)
interface CheckAdminClient {
  from(table: string): {
    select(fields: string): {
      eq(k: string, v: string | null): {
        maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null }>
        limit(n: number): {
          maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null }>
        }
      }
    }
  }
}

export interface IssuerSignatureCheckResult {
  blocked: boolean
  reason?: string
}

/**
 * 발행자 서명 필수 여부를 확인한다.
 *
 * @param admin      - service_role 클라이언트
 * @param contractId - 확인할 계약 ID
 * @returns { blocked: true, reason } → 발송 차단 / { blocked: false } → 통과
 */
export async function checkIssuerSignatureRequired(
  admin: CheckAdminClient,
  contractId: string,
): Promise<IssuerSignatureCheckResult> {
  // 1. 계약의 template_id 조회
  const { data: contract } = await admin
    .from('contracts')
    .select('template_id')
    .eq('id', contractId)
    .maybeSingle()

  const templateId = (contract?.template_id as string | null | undefined) ?? null
  if (!templateId) {
    // 템플릿 없이 생성된 계약 → 플래그 체크 불가 → 통과
    return { blocked: false }
  }

  // 2. 양식의 requires_issuer_signature 조회
  const { data: template } = await admin
    .from('contract_templates')
    .select('requires_issuer_signature')
    .eq('id', templateId)
    .maybeSingle()

  const required = (template?.requires_issuer_signature as boolean | undefined) ?? false
  if (!required) return { blocked: false }

  // 3. 발행자 서명 존재 여부 확인
  const { data: existing } = await admin
    .from('contract_issuer_signatures')
    .select('id')
    .eq('contract_id', contractId)
    .limit(1)
    .maybeSingle()

  if (!existing) {
    return {
      blocked: true,
      reason: '이 계약서 양식은 발행자 서명이 필수입니다. 발행 전 서명/직인을 먼저 등록해 주세요.',
    }
  }

  return { blocked: false }
}
