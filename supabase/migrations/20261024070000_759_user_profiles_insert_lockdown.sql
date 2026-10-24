-- Migration #759: user_profiles 직접 INSERT 차단 — 익명 방문자의 관리자 등급 스스로 부여 경로 제거 (CRITICAL, 2026-10-24 권한 감사 중 발견)
--
-- 배경: 운영 DB 에 정책 "user_profiles_insert" (INSERT, 대상 public, WITH CHECK auth.uid() = id)가 있고, anon·authenticated 에 이 표의 INSERT 권한이
--       모든 컬럼(cms_role·points·credit_score 포함)에 부여돼 있었다(#289 는 UPDATE 만 회수했다).
--       익명 로그인(signInAnonymously)은 공개 anon 키만 있으면 누구나 할 수 있고, 익명 계정은 가입 트리거(handle_new_user)가 프로필 행을 만들지 않아(IF NEW.is_anonymous THEN RETURN NEW)
--       프로필이 없다(운영 익명 77명 중 72명) → 그 계정이 자기 id 로 프로필 행을 직접 INSERT 하면서 cms_role('superadmin' 등)·points 를 스스로 정할 수 있었다.
--       is_cms_user() 는 "user_profiles 에 내 행이 있고 cms_role 이 NULL 이 아님"만 보므로, 성공하면 그 즉시 CMS 관리자(RLS·함수·서버 역할 확인 모두 통과)가 된다.
--       Stage 에서 같은 정책을 재현해 실제로 INSERT 가 통과함을 확인했다(필수 컬럼 email 을 넣으면 성공 — 시험 userProfilesInsertLockdownDb.test.ts RED).
--       운영 현황 조회(읽기 전용): cms_role 보유 프로필 5건(manager 3·superadmin 2) 모두 이메일 있는 실제 계정, 익명 계정 중 cms_role 보유 0건 — 악용 흔적은 확인되지 않았다.
-- 변경: ① 정책 user_profiles_insert 삭제 ② anon·authenticated·PUBLIC 의 INSERT·TRUNCATE·REFERENCES·TRIGGER 권한 회수.
-- 영향 없음 확인: 프로필 생성의 정식 경로는 SECURITY DEFINER 인 handle_new_user()(가입 트리거)·ensure_user_profile()(가입 전환 안전망) 둘뿐이고(운영 정의 조회), src/·scripts/ 에 user_profiles 직접 INSERT/UPSERT 코드가 없다.
--       서버(service_role)는 영향 없음. 읽기(SELECT)·본인 수정 RPC(update_user_profile)도 변경 없음.

DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;

REVOKE INSERT, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles FROM PUBLIC, anon, authenticated;

-- ROLLBACK (되돌리면 익명 방문자가 관리자 등급을 스스로 만들 수 있는 구멍이 다시 열린다 — 하지 말 것):
-- CREATE POLICY user_profiles_insert ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
-- GRANT INSERT, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles TO anon, authenticated;
