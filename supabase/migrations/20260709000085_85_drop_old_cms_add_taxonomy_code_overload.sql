-- 85: 구버전 cms_add_taxonomy_code(8-param) DROP
-- 원인: 마이그레이션 81에서 9-param 버전(meta_keywords 추가)을 CREATE OR REPLACE로 추가했으나
--       기존 8-param 오버로드를 DROP하지 않아 PostgREST 함수 호출 시 "ambiguous overload" 오류 발생
--       → addCode 액션에서 항상 실패

DROP FUNCTION IF EXISTS public.cms_add_taxonomy_code(TEXT, TEXT, UUID, INT, TEXT[], TEXT, TEXT, INT);
