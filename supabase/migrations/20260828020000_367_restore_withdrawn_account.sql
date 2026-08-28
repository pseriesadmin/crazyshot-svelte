-- Migration #367: restore_withdrawn_account RPC
-- 탈퇴 유예기간 내 자동복구 함수
-- plan_source: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-②
-- 의존: Migration #365(withdrawal 컬럼) 적용 완료 필수
--
-- 호출 경로: src/routes/+layout.server.ts (루트 레이아웃 서버 로드)
-- 보안 패턴: SECURITY DEFINER + REVOKE/GRANT (Migration #366 동일 패턴, 예외 없음)
--
-- 동작:
--   1. auth.uid() 없으면 {ok:false, error:'로그인이 필요합니다.'}
--   2. withdrawal_status <> 'requested' → {ok:true, restored:false} (idempotent no-op)
--   3. withdrawal_status='requested' AND now() < withdrawal_purge_at
--      → 전체 컬럼 초기화(status='none', 4컬럼 NULL) → {ok:true, restored:true}
--   4. withdrawal_status='requested' AND now() >= withdrawal_purge_at (경계 레이스)
--      → 복구 안 함 → {ok:true, restored:false, expired:true}

CREATE OR REPLACE FUNCTION public.restore_withdrawn_account()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid       UUID;
  v_status    TEXT;
  v_purge_at  TIMESTAMPTZ;
BEGIN
  -- 1. 인증 확인
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  -- 2. 현재 탈퇴 상태 조회
  SELECT withdrawal_status, withdrawal_purge_at
    INTO v_status, v_purge_at
    FROM user_profiles
   WHERE id = v_uid;

  -- 3. 탈퇴 신청 상태가 아니면 no-op (idempotent)
  --    (정상 회원이거나 이미 purged된 계정 포함)
  IF v_status IS DISTINCT FROM 'requested' THEN
    RETURN jsonb_build_object('ok', true, 'restored', false);
  END IF;

  -- 4. 유예기간 경과 여부 확인
  IF now() >= v_purge_at THEN
    -- 경계 레이스: cron이 아직 실행되지 않은 상태 — 복구하지 않음
    RETURN jsonb_build_object('ok', true, 'restored', false, 'expired', true);
  END IF;

  -- 5. 유예기간 내 → 전체 초기화 (자동복구)
  UPDATE user_profiles
     SET withdrawal_status       = 'none',
         withdrawal_requested_at = NULL,
         withdrawal_purge_at     = NULL,
         withdrawal_reasons      = NULL,
         withdrawal_reason_etc   = NULL,
         updated_at              = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'restored', true);
END;
$$;

-- 보안: REVOKE 후 authenticated에만 GRANT (anon 제외 — request_account_withdrawal 동일 패턴)
REVOKE ALL ON FUNCTION public.restore_withdrawn_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_withdrawn_account() TO authenticated;
