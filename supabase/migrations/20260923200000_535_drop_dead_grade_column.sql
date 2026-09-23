-- Migration 535: user_profiles.grade(GENERATED, 죽은 컬럼) 삭제
--
-- 배경: Migration 03(20260529000003)에서 membership_grade를 그대로 복제하는
-- `grade membership_grade_enum GENERATED ALWAYS AS (membership_grade) STORED` 컬럼이
-- 함께 생성됐으나, 앱 코드(RPC/서버 액션/프론트) 어디에서도 이 컬럼을 SELECT하거나
-- 참조하지 않는다는 것을 전수 grep으로 확인(2026-09-23) — CSS의 `.grade-*` 클래스명·
-- LegacyMemberVerifyModal의 `grade` 필드는 전부 membership_grade 값 또는 API 응답의
-- 하드코딩 문자열('NONE')일 뿐, 이 GENERATED 컬럼과 무관함.
--
-- "회원 등급" 개념 자체는 membership_grade(구독상품 EASY/POP/CRAZY 구독 상태)만 존재하며
-- 계정 고정 등급이라는 별도 개념은 이 프로젝트에 없음(Stephen 확인) — 이 죽은 컬럼은
-- 그 혼동의 여지만 남기고 있어 제거한다.

ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS grade;
