import type { SupabaseClient } from '@supabase/supabase-js'

export type ClearResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: 400 | 500 }

export type DiscardResult =
  | { ok: true }
  | { ok: false; error: string; httpStatus: 400 | 500 }

export type CancelIssuedResult =
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
      content_blocks:      [],
      canvas_document:     null,   // canvas 계약의 orphan 데이터 방지 — authoring_mode는 다음 발행 시 재설정됨
      spreadsheet_document: null,  // spreadsheet 계약도 동일 — 2026-09-08 추가(누락 발견)
      html_document:        null,  // html 계약도 동일 — 2026-09-08 추가(누락 발견)
      title:                null,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', contractId)

  if (error) return { ok: false, error: error.message, httpStatus: 500 }
  return { ok: true }
}

/**
 * 발송된(sent_at) 계약서 폐기 — 발송됐지만 미서명 상태의 계약서를 폐기한다.
 * Stage 5 (EC-6: 재발송/폐기 버튼 추가, GATE B Q7).
 *
 * 1. contract_signings.expires_at 를 과거로 설정해 고객 서명 링크를 즉시 만료
 * 2. contract_signings.sent_at 를 null 로 초기화해 "발송됨" 상태 해제
 * 3. contracts 콘텐츠(content_blocks·canvas_document·title) 초기화
 *
 * 고객이 이미 서명 완료한 계약서는 폐기 불가 — 400 반환.
 */
export async function discardSentContract(
  contractId: string,
  admin: SupabaseClient,
): Promise<DiscardResult> {
  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .select('id, signed_at, sent_at')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (signingErr) {
    return { ok: false, error: signingErr.message, httpStatus: 500 }
  }

  if (signing?.signed_at) {
    return { ok: false, error: '고객이 서명 완료한 계약서는 폐기할 수 없습니다.', httpStatus: 400 }
  }

  if (!signing?.sent_at) {
    return { ok: false, error: '발송된 계약서가 없습니다. 일반 삭제 버튼을 사용하세요.', httpStatus: 400 }
  }

  // RSV-A-B2: 두 UPDATE를 atomic RPC(discard_sent_contract, Migration 405)로 래핑한다.
  // 기존: contract_signings UPDATE → contracts UPDATE (비원자적 — 중간 실패 시 데이터 불일치)
  // 현재: 단일 RPC 트랜잭션 내에서 atomic 처리 (한 쪽만 성공하는 경우 원천 차단)
  const { error: rpcErr } = await admin.rpc('discard_sent_contract', {
    p_contract_id: contractId,
  })

  if (rpcErr) {
    return { ok: false, error: rpcErr.message, httpStatus: 500 }
  }

  return { ok: true }
}

/**
 * 전자계약 발행 취소 — 고객이 이미 서명 완료한 계약서도 대상(2026-09-07, Stephen 확정).
 *
 * discardSentContract()와 근본적으로 다른 점: "발송됐지만 미서명"인 계약만 다루는 게
 * 아니라, **서명이 이미 완료된 계약도 관리자가 명시적으로 발행 자체를 취소**할 수 있다 —
 * "회수처리"(서명 데이터 보관)가 아니라 "발행취소"(완전 초기화, 서명 데이터도 함께 삭제).
 * signed_at 가드가 없는 것이 이 함수의 존재 목적이므로, discardSentContract의 그 가드를
 * 완화하는 게 아니라 별개의 상위 액션으로 신설했다.
 *
 * 발행된 적 자체가 없는 계약(contract_signings 행 없음)에는 적용 대상이 아님 — 그 경우는
 * clearIssuedContractContent()(초기화 버튼)가 담당.
 */
export async function cancelIssuedContract(
  contractId: string,
  admin: SupabaseClient,
): Promise<CancelIssuedResult> {
  const { data: signing, error: signingErr } = await admin
    .from('contract_signings')
    .select('id, sent_at, signed_at')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (signingErr) {
    return { ok: false, error: signingErr.message, httpStatus: 500 }
  }

  if (!signing?.sent_at && !signing?.signed_at) {
    return { ok: false, error: '발행(발송)된 계약서가 없습니다.', httpStatus: 400 }
  }

  const { error: rpcErr } = await admin.rpc('cancel_issued_contract', {
    p_contract_id: contractId,
  })

  if (rpcErr) {
    return { ok: false, error: rpcErr.message, httpStatus: 500 }
  }

  return { ok: true }
}
