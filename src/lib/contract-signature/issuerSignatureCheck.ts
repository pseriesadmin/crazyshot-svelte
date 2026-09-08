/**
 * issuerSignatureCheck.ts — 발행자 서명 필수 여부 검증 헬퍼
 *
 * Phase 8-B-4: 계약서 양식의 requires_issuer_signature 플래그가 true이면
 * 발행(send-chat) 시점에 발행자 서명이 반드시 존재해야 함을 확인한다.
 *
 * 설계:
 * - contract.template_id → contract_templates.requires_issuer_signature 조회
 * - true이면 발행자 서명 존재 여부 확인 — authoring_mode별로 확인 위치가 다르다:
 *   · html 모드   : contracts.html_issuer_signature_url (템플릿 단위로 한 번 등록하면
 *     발행 시 계약서 html_document에 그대로 복사되는 방식, ContractTemplatePanel.svelte —
 *     최근 신규 기능) 존재 여부로 판정.
 *   · canvas 등 그 외 모드 : contract_issuer_signatures 테이블(계약 건별 개별 등록 방식,
 *     Phase 8-B-3 /api/cms/contracts/[id]/issuer-sign) 존재 여부로 판정 — 기존 동작 그대로.
 * - template_id가 없거나 플래그가 false이면 즉시 통과
 *
 * 2026-09-08 수정: html 모드는 애초에 contract_issuer_signatures에 행을 남기는 경로가
 * 없어(그 테이블은 canvas 전용 개별 서명 흐름), html 발행자 서명을 정상 등록해도 항상
 * "서명 없음"으로 오판되어 발송이 막히는 결함이 있었다(실사용 중 발견) — authoring_mode
 * 분기를 추가해 html 모드만 별도 컬럼을 보도록 수정. canvas 등 기존 모드의 판정 로직·
 * 질의는 한 글자도 바꾸지 않았다(회귀 없음).
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
  // 1. 계약의 template_id + authoring_mode + html_issuer_signature_url 조회
  const { data: contract } = await admin
    .from('contracts')
    .select('template_id, authoring_mode, html_issuer_signature_url')
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

  // 2-1. html 모드 — contract_issuer_signatures(canvas 전용 개별 등록 테이블)에는 애초에
  // 값이 채워지지 않으므로, 발행 시 그대로 복사되는 html_issuer_signature_url로 판정한다.
  const authoringMode = (contract?.authoring_mode as string | null | undefined) ?? null
  if (authoringMode === 'html') {
    const htmlSignatureUrl = (contract?.html_issuer_signature_url as string | null | undefined) ?? null
    if (!htmlSignatureUrl) {
      return {
        blocked: true,
        reason: '이 계약서 양식은 발행자 서명이 필수입니다. 발행 전 서명/직인을 먼저 등록해 주세요.',
      }
    }
    return { blocked: false }
  }

  // 3. (canvas 등 그 외 모드) 발행자 서명 존재 여부 확인 — 기존 동작 그대로 유지
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
