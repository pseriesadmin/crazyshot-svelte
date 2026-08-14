import type { SupabaseClient } from '@supabase/supabase-js'

export type ClearResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: 400 | 500 }

/**
 * 계약서 콘텐츠 초기화 — 서명완료/발송됨 상태 서버측 재검증 후 content_blocks를 []로 초기화.
 * contract.md "계약서 양식 편집 제한 정책"과 동일 원칙:
 *   - 고객 서명 완료(signed_at) → 거부
 *   - 발송됨(sent_at) → 거부
 *   - 그 외 → content_blocks: [], title: null 로 초기화
 */
export async function clearIssuedContractContent(
  contractId: string,
  admin: SupabaseClient,
): Promise<ClearResult> {
  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .select('signed_at, sent_at')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (signingErr) {
    return { ok: false, error: signingErr.message, httpStatus: 500 }
  }

  if (signing?.signed_at) {
    return { ok: false, error: '고객이 서명 완료한 계약서는 삭제할 수 없습니다.', httpStatus: 400 }
  }
  if (signing?.sent_at) {
    return { ok: false, error: '이미 발송된 계약서는 삭제할 수 없습니다.', httpStatus: 400 }
  }

  const { error } = await admin
    .from('contracts')
    .update({
      content_blocks:  [],
      canvas_document: null,   // canvas 계약의 orphan 데이터 방지 — authoring_mode는 다음 발행 시 재설정됨
      title:           null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', contractId)

  if (error) return { ok: false, error: error.message, httpStatus: 500 }
  return { ok: true }
}
