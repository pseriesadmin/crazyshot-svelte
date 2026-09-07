-- Migration #456: cancel_issued_contract — 전자계약 발행 취소(이미 서명 완료된 건 포함)
--
-- 배경(2026-09-07, Stephen 확정): 기존 discard_sent_contract(#405)는 "발송됐지만 아직
-- 미서명"인 계약만 폐기 가능하고, 고객이 이미 서명 완료한 계약은 앱코드(discardSentContract
-- helper)가 명시적으로 차단한다(RSV-C-C3 원칙 — 서명 완료 계약은 불변). Stephen이 새로
-- 요청한 기능은 그 차단을 우회하는 게 아니라, "이미 서명 완료된 건도 관리자가 명시적으로
-- 발행 자체를 취소할 수 있어야 한다"는 별개의 상위 액션이다("회수처리"가 아니라 "발행취소"
-- — 서명 데이터 보관 없이 완전히 초기화, Stephen 확정).
--
-- discard_sent_contract와의 차이:
--   ① signed_at 가드 없음 — 서명 완료 상태에서도 호출 가능(이 함수의 존재 목적 자체가 그것)
--   ② content_blocks 외에 canvas_document/spreadsheet_document/html_document/title도
--      함께 초기화 — discard_sent_contract는 content_blocks만 비워 flow 모드 외 계약
--      (canvas/spreadsheet/html)에서는 hasExistingContractContent()가 여전히 "발행됨"으로
--      오판하는 기존 결함이 있었음(CMS "발행 목록"이 취소 후에도 사라지지 않는 문제로 이어짐).
--      이번 신규 함수는 전체 authoring_mode를 대상으로 정확히 초기화한다.
--
-- 호출: service_role 전용 (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.cancel_issued_contract(
  p_contract_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signing_id UUID;
BEGIN
  -- 1. contract_signings 초기화 (sent_at, signed_at, expires_at, token 재생성)
  UPDATE contract_signings
  SET
    sent_at    = NULL,
    signed_at  = NULL,
    expires_at = NULL,
    token      = gen_random_uuid()
  WHERE contract_id = p_contract_id
  RETURNING id INTO v_signing_id;

  -- 2. contracts 내용 전체 초기화 (모든 authoring_mode 대상)
  UPDATE contracts
  SET
    content_blocks       = '[]'::jsonb,
    canvas_document       = NULL,
    spreadsheet_document  = NULL,
    html_document         = NULL,
    title                 = NULL,
    updated_at            = NOW()
  WHERE id = p_contract_id;

  RETURN jsonb_build_object('ok', true, 'signing_id', v_signing_id);
END;
$$;

-- service_role만 실행 가능 (브라우저 직접 호출 불가)
REVOKE ALL ON FUNCTION public.cancel_issued_contract(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_issued_contract(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_issued_contract(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_issued_contract(UUID) TO service_role;
