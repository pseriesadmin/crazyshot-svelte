-- Migration 432: NLSearch B안 — 0건 검색어 갭 조회 RPC
--
-- 배경(2026-09-03): §G(재검색행동학습)는 "0건 검색 → 120초 내 재검색 → 성공"인 경우만
-- 동의어 후보로 학습한다. 재검색 없이 그냥 이탈한(완전히 놓친) 검색어는 어떤 학습 신호도
-- 남기지 않는다 — 관리자가 그 존재 자체를 알 방법이 없었다. 이 RPC는 search_logs에서
-- result_count=0인 검색어를 빈도순으로 집계해 /cms/chat QnA탭에 노출, 관리자가 직접
-- 동의어 매핑·상품 보완 여부를 판단할 수 있게 한다(순수 조회, 자동학습·자동승격 없음).
--
-- 이미 confirmed 동의어로 커버된 검색어는 과거 로그에 0건으로 남아있어도 지금 재검색하면
-- 정상적으로 결과가 나올 가능성이 높으므로 제외한다(오래된 갭을 이미 해결된 것으로
-- 착각하지 않도록).

CREATE OR REPLACE FUNCTION public.get_zero_result_search_terms(
  p_lookback_days INTEGER DEFAULT 30,
  p_limit         INTEGER DEFAULT 50
)
RETURNS TABLE(query TEXT, occurrence_count BIGINT, last_searched_at TIMESTAMPTZ)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    lower(trim(sl.query)) AS query,
    count(*)              AS occurrence_count,
    max(sl.created_at)    AS last_searched_at
  FROM public.search_logs sl
  WHERE sl.result_count = 0
    AND sl.created_at >= (now() - (p_lookback_days || ' days')::interval)
    AND char_length(trim(sl.query)) BETWEEN 2 AND 30
    AND NOT EXISTS (
      SELECT 1 FROM public.synonym_group_members sgm
      WHERE sgm.status = 'confirmed'
        AND lower(sgm.term) = lower(trim(sl.query))
    )
  GROUP BY lower(trim(sl.query))
  ORDER BY count(*) DESC, max(sl.created_at) DESC
  LIMIT p_limit
$function$;

-- service_role 전용 — search_logs가 user_id를 포함해 anon/authenticated에 직접 열어두지 않음
-- (반환 컬럼 자체는 집계된 검색어·건수뿐이라 PII는 없지만, 원천 테이블 접근 범위는 최소화 원칙 유지).
REVOKE ALL ON FUNCTION public.get_zero_result_search_terms(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_zero_result_search_terms(INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.get_zero_result_search_terms IS
  'NLSearch B안: search_logs에서 result_count=0 검색어를 빈도순 집계. confirmed 동의어로
  이미 커버된 검색어는 제외. /cms/chat QnA탭 "검색 갭" 표시용, service_role 전용 순수 조회.';
