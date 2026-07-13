-- Migration #104: code_mapping_groups.keywords 컬럼 보정
-- 원인: #86 초기 적용 시 구버전 스크립트로 keywords 컬럼 누락
--       Production SELECT 쿼리 오류 → 코드조합 목록 미표시

ALTER TABLE public.code_mapping_groups
  ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';
