-- Migration #164: get_customer_list 중복 함수 제거
-- 원인: 구버전(p_search 선두) + 신버전(p_page 선두) 동일 이름으로 공존
--       → PostgreSQL 42725 "function is not unique" 오류 → CMS 고객목록 0건 표시
-- 수정: 구버전(파라미터 순서: p_search, p_membership_grade, p_blacklisted, p_page, p_limit) DROP

DROP FUNCTION IF EXISTS public.get_customer_list(
  text, text, boolean, integer, integer
);
