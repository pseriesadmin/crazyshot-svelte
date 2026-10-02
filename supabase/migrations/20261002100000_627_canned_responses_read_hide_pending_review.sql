-- Migration #627: canned_responses 공개 조회에서 미검토(pending_review=true) 항목 제외
-- 배경: Migration 617로 CSV 일괄등록 항목에 pending_review=true를 두고 채팅 자동매칭에서는 제외했지만,
--   공개 조회 정책 cr_read가 USING (true)라 홈 FAQ·/help 도움말 페이지(anon 조회)에 미검토 원문이
--   그대로 노출됐다(2026-10-02 발견). 앱 쿼리마다 필터를 넣는 대신 RLS에서 근본 차단한다.
-- 관리자는 cr_admin_all(is_cms_user())로 계속 전체 조회·수정 가능.
DROP POLICY IF EXISTS cr_read ON canned_responses;
CREATE POLICY cr_read ON canned_responses
  FOR SELECT TO public
  USING (pending_review = false);

-- ROLLBACK: DROP POLICY cr_read ON canned_responses; CREATE POLICY cr_read ON canned_responses FOR SELECT TO public USING (true);
