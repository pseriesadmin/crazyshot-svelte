-- Migration 294: cms_create_coupon 구 시그니처(25-param) 오버로드 제거
-- 배경: migration 293이 p_code_series/p_code_mode 2개 파라미터를 끝에 추가한 채
--   CREATE OR REPLACE FUNCTION을 실행했는데, Postgres는 파라미터 목록(타입 시퀀스)이
--   다르면 기존 함수를 "교체"하지 않고 별도 오버로드로 "추가"한다 — 그 결과 stage DB에
--   cms_create_coupon이 25-param(구)과 27-param(신) 두 개로 동시에 존재하게 됐다
--   (Supabase 보안 어드바이저로 확인, products.md §2-3의 PGRST203 오버로드 모호성 경고와
--   동일한 근본 원인). 이 상태로 두면 PostgREST가 어느 오버로드를 호출할지 모호해지거나,
--   클라이언트가 신규 파라미터를 생략한 호출 시 구 시그니처로 조용히 라우팅되어
--   code_series/code_mode가 아예 반영되지 않는 silent bug가 재발할 수 있다.
-- 조치: 구 시그니처(25-param, p_code_series/p_code_mode 없는 버전)만 명시적으로 DROP.
--   신규 시그니처(27-param)는 migration 293에서 이미 생성 완료 상태로 유지.
-- 2026-08-18

DROP FUNCTION IF EXISTS public.cms_create_coupon(
  p_code                  TEXT,
  p_type                  TEXT,
  p_discount_type         TEXT,
  p_discount_value        NUMERIC,
  p_usage_limit           INTEGER,
  p_min_purchase_amount   NUMERIC,
  p_valid_from            TIMESTAMPTZ,
  p_valid_until           TIMESTAMPTZ,
  p_description           TEXT,
  p_min_rental_amount     INTEGER,
  p_min_rental_days       INTEGER,
  p_max_discount_amount   NUMERIC,
  p_applicable_categories JSONB,
  p_user_grade_required   TEXT,
  p_is_first_rental_only  BOOLEAN,
  p_per_user_limit        INTEGER,
  p_total_usage_limit     INTEGER,
  p_is_student_only       BOOLEAN,
  p_is_walk_in_only       BOOLEAN,
  p_is_subscription_only  BOOLEAN,
  p_auto_issue_enabled    BOOLEAN,
  p_auto_issue_schedule   JSONB,
  p_distribution_target   JSONB,
  p_validity_type         TEXT,
  p_allow_with_points     BOOLEAN,
  p_allow_stacking        BOOLEAN
);

-- ─────────────────────────────────────────────────────────
-- ROLLBACK (필요 시 — migration 262 원본 25-param 버전 재생성)
-- ─────────────────────────────────────────────────────────
-- migration 262의 CREATE FUNCTION 블록을 그대로 재실행
