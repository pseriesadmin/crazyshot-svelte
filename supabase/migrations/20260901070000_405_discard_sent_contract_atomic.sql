-- Migration #405: discard_sent_contract — 계약서 재발행(폐기) 원자적 RPC
-- RSV-A-B2: 기존 clearIssuedContractHelper.ts의 discardSentContract()는 두 단계 DML을
-- 순차 실행했으나 트랜잭션으로 묶여있지 않아, 첫 번째 UPDATE(contract_signings) 성공 후
-- 두 번째 UPDATE(contracts) 실패 시 데이터 불일치가 발생할 수 있었다.
-- 이 RPC는 두 UPDATE를 단일 트랜잭션에서 원자적으로 실행한다.
--
-- 사전 조건: contracts·contract_signings 테이블이 존재하고 RLS가 활성화돼 있어야 한다.
-- 호출: service_role 전용 (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.discard_sent_contract(
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
  -- token은 DEFAULT gen_random_uuid()로 자동 재생성되도록 UPDATE로 재설정
  UPDATE contract_signings
  SET
    sent_at    = NULL,
    signed_at  = NULL,
    expires_at = NULL,
    token      = gen_random_uuid()
  WHERE contract_id = p_contract_id
  RETURNING id INTO v_signing_id;

  -- 2. contracts 내용 초기화 (content_blocks 비움)
  UPDATE contracts
  SET
    content_blocks = '[]'::jsonb,
    updated_at     = NOW()
  WHERE id = p_contract_id;

  RETURN jsonb_build_object('ok', true, 'signing_id', v_signing_id);
END;
$$;

-- service_role만 실행 가능 (브라우저 직접 호출 불가)
REVOKE ALL ON FUNCTION public.discard_sent_contract(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discard_sent_contract(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.discard_sent_contract(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.discard_sent_contract(UUID) TO service_role;
