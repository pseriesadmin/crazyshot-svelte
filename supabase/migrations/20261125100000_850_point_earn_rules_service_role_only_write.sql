-- Migration #850: 포인트 적립 규칙 쓰기를 서버(service_role) 전용으로 제한 + 값 범위 검사 (2026-11-25, CRITICAL)
--
-- 배경: 적립 규칙(point_earn_rules)은 고객 포인트 지급액에 직접 영향을 주고, 설정 변경은 manager 이상(security-auth.md)인데
--   ① update_point_earn_rule 이 authenticated 에 EXECUTE 가 열려 있고 내부 검사가 is_cms_user()(cms_role 이 있기만 하면 partner 포함)뿐
--   ② 표 자체에도 UPDATE 정책(cms_update_earn_rules = is_cms_user())과 authenticated 쓰기 권한이 열려 있어
--   partner 가 브라우저에서 직접 적립 금액·적립률·활성 여부를 바꿀 수 있었다(앱 서버 액션의 manager 이상 확인을 우회).
--   또 함수가 값 범위를 검사하지 않아 적립률 3(=300%)·음수 금액도 저장됐다.
-- 변경: ① 표의 CMS UPDATE 정책 제거 + anon/authenticated 쓰기 권한 회수(읽기 정책 cms_select_earn_rules 유지)
--   ② update_point_earn_rule 을 service_role 전용으로 재정의(내부 is_cms_user() 검사 제거 — 호출자는 manager 이상 게이트를 통과한 앱 서버 액션뿐),
--      금액은 0 이상, 적립률은 0 이상 1 이하(소수, 1=100%)만 허용. referrer/referee 준비중 고정(Migration #599)은 그대로 유지.
--
-- ROLLBACK (필요 시 수동 실행):
--   CREATE POLICY cms_update_earn_rules ON public.point_earn_rules FOR UPDATE USING (is_cms_user()) WITH CHECK (is_cms_user());
--   GRANT INSERT, UPDATE, DELETE ON public.point_earn_rules TO authenticated;
--   update_point_earn_rule 을 Migration #599 정의(내부 is_cms_user() 검사 포함)로 CREATE OR REPLACE 복원 후
--   GRANT EXECUTE ON FUNCTION public.update_point_earn_rule(VARCHAR, INT, NUMERIC, BOOLEAN, JSONB) TO authenticated;

DROP POLICY IF EXISTS cms_update_earn_rules ON public.point_earn_rules;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.point_earn_rules FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_point_earn_rule(
  p_event_type        VARCHAR(30),
  p_amount            INT DEFAULT NULL,
  p_rate              NUMERIC(5,4) DEFAULT NULL,
  p_is_active         BOOLEAN DEFAULT NULL,
  p_grade_multipliers JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_active BOOLEAN := p_is_active;
BEGIN
  -- 값 범위: 금액 0 이상, 적립률 0~1(소수 — 0.03 = 3%). 화면 검증을 우회한 직접 호출도 여기서 막는다.
  IF p_amount IS NOT NULL AND p_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_RATE');
  END IF;

  -- 추천인/피추천인: 추천 시스템 미구축 — 활성화 요청을 항상 강제로 거부(준비중 고정, Migration #599)
  IF p_event_type IN ('referrer', 'referee') THEN
    v_is_active := false;
  END IF;

  UPDATE point_earn_rules
  SET
    amount            = COALESCE(p_amount, amount),
    rate              = COALESCE(p_rate, rate),
    is_active         = COALESCE(v_is_active, is_active),
    grade_multipliers = COALESCE(p_grade_multipliers, grade_multipliers),
    updated_at        = now()
  WHERE event_type = p_event_type;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RULE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_point_earn_rule(VARCHAR, INT, NUMERIC, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_point_earn_rule(VARCHAR, INT, NUMERIC, BOOLEAN, JSONB) TO service_role;
