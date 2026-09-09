-- CMS 전역 전수검증(2026-09-09) — admin_invite_tokens RLS 하이재킹 방지
--
-- 기존 admin_manage_tokens 정책(Migration #34)은 `cms_role IS NOT NULL`이면
-- 등급 무관(partner 포함)으로 FOR ALL(SELECT/INSERT/UPDATE/DELETE)을 허용했다.
-- 같은 마이그레이션의 cms_login_otps는 이미 FOR ALL USING (false)(service_role 전용)로
-- 올바르게 잠겨 있었으나 admin_invite_tokens에는 동일 원칙이 적용되지 않았음.
--
-- 앱 코드(src/routes/cms/login/+page.server.ts, src/routes/cms/accounts/+page.server.ts)는
-- 이 테이블을 전부 service_role 클라이언트로만 다루므로, service_role 전용으로 잠가도
-- 기존 초대 발송·비밀번호 설정 흐름에는 영향이 없다(service_role은 RLS를 우회함).
--
-- 회귀 검증: src/__tests__/services/adminInviteTokensRlsGuard.test.ts

DROP POLICY IF EXISTS "admin_manage_tokens" ON admin_invite_tokens;

CREATE POLICY "admin_invite_tokens_service_role_only" ON admin_invite_tokens
  FOR ALL USING (false);
