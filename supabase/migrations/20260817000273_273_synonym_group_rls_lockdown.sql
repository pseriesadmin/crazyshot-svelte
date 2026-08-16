-- Migration 273: synonym_groups / synonym_group_members RLS 잠금
-- CMS 백오피스 전역 정밀 검증(AUDIT v2) Track B에서 발견된 CRITICAL 보안 결함 수정
-- 2026-08-17
--
-- 배경: Migration 199(synonym_groups.sql)가 두 테이블을 생성하면서 RLS 활성화를
-- 누락함 — Supabase 기본 GRANT로 인해 anon(비로그인 익명키)에게까지
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE 권한이 전부 열려 있었다(get_advisors
-- ERROR: rls_disabled_in_public, stage·production 양쪽 확인됨).
--
-- 코드 조사 결과(2026-08-17): 이 두 테이블에 접근하는 모든 경로
-- (src/routes/cms/chat/qna/+page.server.ts, src/lib/server/synonymLearning.ts,
-- searchReformulationScan.ts, crossLingualSynonymScan.ts)가 전부
-- SUPABASE_SERVICE_ROLE_KEY 기반 admin 클라이언트만 사용 — anon/authenticated
-- 세션 클라이언트(locals.supabase)로 직접 접근하는 코드는 0건.
-- find_or_create_synonym_group / upsert_synonym_member RPC도 이미
-- service_role 전용으로 EXECUTE 권한이 제한돼 있음(Migration 263과 일치).
--
-- 따라서 chat_intent_logs(Migration 31)와 동일한 "service_role 전용" 패턴을
-- 그대로 적용한다 — service_role은 RLS를 우회하므로 정책은 anon/authenticated만
-- 차단하면 된다. TRUNCATE는 RLS로 막을 수 없는 테이블 레벨 권한이므로 REVOKE로
-- 별도 차단 필수.

REVOKE ALL ON public.synonym_groups        FROM anon, authenticated;
REVOKE ALL ON public.synonym_group_members FROM anon, authenticated;

ALTER TABLE public.synonym_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synonym_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_synonym_groups" ON public.synonym_groups
  FOR ALL USING (false);  -- service_role bypasses RLS

CREATE POLICY "service_role_only_synonym_group_members" ON public.synonym_group_members
  FOR ALL USING (false);  -- service_role bypasses RLS
