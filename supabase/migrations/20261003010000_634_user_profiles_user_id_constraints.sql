-- Migration 634: user_profiles.user_id 무결성 제약 2건 추가 (Production을 Stage와 동일 구조로 정렬)
--
-- 배경(2026-10-03 Stage↔Production 구조 점검): Stage에는 user_profiles.user_id에
--   · user_profiles_user_id_unique UNIQUE (user_id)
--   · user_profiles_user_id_fkey   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- 가 있으나 Production에는 없었다(Migration 164 Production 전용 보정으로 user_id 컬럼만 추가된 이력).
--
-- Production 사전 점검(읽기 전용, 2026-10-03): 31행 전부 user_id NOT NULL, 중복 0건,
-- user_id ≠ id 0건, auth.users에 없는 계정 0건. 신규 가입 경로 2곳(handle_new_user·ensure_user_profile)은
-- 모두 user_id에 회원 id를 직접 넣는다(VALUES (id, id, …)) — 즉 기존 동작과 충돌할 수 없는 제약이다
-- (id는 이미 PK + auth.users FK).
--
-- 범위 한정: Stage에 있는 trg_sync_user_id(BEFORE INSERT로 user_id := id 자동 채움) 트리거는
-- Production 가입 경로를 변경하게 되고 이미 두 함수가 직접 채우므로 이번에 추가하지 않는다.
--
-- 안전장치(운영 중 DB 대상):
--   · lock_timeout 3초 — 잠금을 못 잡으면 대기열을 만들지 않고 즉시 실패(아무것도 바뀌지 않음, 재시도 가능)
--   · FK는 NOT VALID로 먼저 추가한 뒤 VALIDATE (auth.users 잠금 시간 최소화)
--   · 이미 같은 이름 제약이 있으면 건너뜀(Stage는 no-op, 재실행 안전)

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '20s', true);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_user_id_unique'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_unique UNIQUE (user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_user_id_fkey;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (필요할 때만 수동 실행 — 데이터 변경 없음)
-- ============================================================
-- ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_fkey;
-- ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_unique;
-- ============================================================
