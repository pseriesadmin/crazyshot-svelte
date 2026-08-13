-- Migration #234: get_coupon_usage_report ORDER BY 컬럼 모호성(ambiguous) 버그 수정
--
-- 배경: CMS 대시보드 "오늘 통계" 탭(Migration #221)에서 get_coupon_usage_report를 처음으로
-- 정상 인증 컨텍스트(locals.supabase, auth.uid() 실제 채워짐)로 호출하자
-- `column reference "used_count" is ambiguous` 에러가 실사용 중 발견됨(2026-08-13).
--
-- 근본 원인: 원본 함수(마이그레이션 51)가 `RETURNS TABLE (..., used_count BIGINT, ...)`를
-- 선언하면 PL/pgSQL이 이 컬럼명과 동일한 이름의 암묵적 OUT 파라미터를 함수 본문 스코프에
-- 만든다. 본문 내 `ORDER BY period DESC, used_count DESC`의 `used_count`가 (a) SELECT 목록의
-- 컬럼 별칭과 (b) 이 암묵적 OUT 파라미터 사이에서 모호해져 매 호출마다 에러가 났을 것으로
-- 추정됨 — `/cms/promotion/coupon` 화면의 사용 리포트도 이 함수를 호출하므로 이번 발견 이전부터
-- 동일하게 실패하고 있었을 가능성이 높음(이 화면 자체는 이번 세션 범위 밖이라 별도 확인 안 함).
--
-- 수정1: ORDER BY의 별칭 참조를 실제 집계식으로 교체해 모호성 자체를 제거.
-- 수정2(1차 수정 적용 후 새로 드러난 2번째 결함): ambiguous 에러가 사라지자 그 다음 층에서
-- `structure of query does not match function result type` 에러가 발견됨 — `coupons.code`의
-- 실제 컬럼 타입이 `character varying`인데 RETURNS TABLE은 `coupon_code TEXT`로 선언돼 있어
-- PL/pgSQL RETURN QUERY의 엄격한 행타입 매칭에서 걸림(VARCHAR→TEXT 암묵적 캐스팅이 이 경로에선
-- 적용 안 됨). `c.type::TEXT`처럼 `c.code::TEXT`로 명시 캐스팅 추가.
-- 그 외 로직·반환타입·파라미터는 원본과 완전히 동일(ADD-only, 기존 마이그레이션 파일 미수정).

CREATE OR REPLACE FUNCTION public.get_coupon_usage_report(
  p_period TEXT DEFAULT 'day',   -- 'day' | 'month' | 'year'
  p_from   TIMESTAMPTZ DEFAULT NULL,
  p_to     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  period        TEXT,
  coupon_id     UUID,
  coupon_code   TEXT,
  coupon_type   TEXT,
  issued_count  BIGINT,
  used_count    BIGINT,
  conversion_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    CASE p_period
      WHEN 'month' THEN to_char(uc.used_at, 'YYYY-MM')
      WHEN 'year'  THEN to_char(uc.used_at, 'YYYY')
      ELSE              to_char(uc.used_at, 'YYYY-MM-DD')
    END AS period,
    c.id                                        AS coupon_id,
    c.code::TEXT                                AS coupon_code,
    c.type::TEXT                                AS coupon_type,
    COUNT(uc.id)                                AS issued_count,
    COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL) AS used_count,
    ROUND(
      COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL)::NUMERIC
        / NULLIF(COUNT(uc.id), 0) * 100, 1
    )                                           AS conversion_pct
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE c.deleted_at IS NULL
    AND (p_from IS NULL OR uc.created_at >= p_from)
    AND (p_to   IS NULL OR uc.created_at <= p_to)
  GROUP BY period, c.id, c.code, c.type
  ORDER BY period DESC, COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL) DESC;
END;
$$;
