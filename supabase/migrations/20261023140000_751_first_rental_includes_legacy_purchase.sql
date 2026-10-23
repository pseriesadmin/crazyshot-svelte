-- 751: "첫 렌탈" 판정에 레거시(원 서비스) 구매 이력 포함 (2026-10-23)
-- 배경: 기존 회원(레거시) 인증 계정은 크레이지샷 예약 기록이 0건이라 "첫 렌탈 전용" 쿠폰 대상으로 잡혔다.
--       user_profiles.legacy_purchase_count > 0 이면 첫 렌탈이 아니다.
-- 방식: 라이브 정의에서 정확히 1곳만 치환(불일치 시 예외 → 롤백). 권한(ACL)은 CREATE OR REPLACE가 보존.
DO $mig$
DECLARE
  v_def text;
  v_new text;
  v_old constant text := E'IF v_uc.is_first_rental_only THEN\n    IF EXISTS (';
  v_rep constant text := E'IF v_uc.is_first_rental_only THEN\n    IF EXISTS (\n      SELECT 1 FROM user_profiles\n      WHERE id = p_user_id AND COALESCE(legacy_purchase_count, 0) > 0\n    ) OR EXISTS (';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private' AND p.proname = '_validate_and_consume_coupon';
  IF v_def IS NULL THEN RAISE EXCEPTION '751: _validate_and_consume_coupon 없음'; END IF;
  IF v_def LIKE '%legacy_purchase_count%' THEN RETURN; END IF; -- 멱등
  IF (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) THEN
    RAISE EXCEPTION '751: 치환 대상이 정확히 1곳이 아님';
  END IF;
  v_new := replace(v_def, v_old, v_rep);
  EXECUTE v_new;
END
$mig$;
