-- 617_canned_responses_pending_review.sql
-- CSV 상담로그 일괄등록(bulk-import) 등 "관리자 검토 전" 빠른답변이 실시간 고객채팅
-- 자동매칭(title/content 유사도 포함) 후보에서 제외되도록 하는 플래그.
--
-- 배경: shortcut/match_keywords를 비워도 matchCannedResponse()가 title/content를 항상
-- 함께 검색 대상에 포함시키므로(cannedResponseSearchIndex.ts searchFields), 미검토 원문
-- (타 고객 개인정보가 섞여 있을 수 있는 CSV 원문)이 생성 즉시 자동매칭 후보가 되는 결함이
-- sp3-qa-agent 검수(2026-10-02)에서 발견됨 — 이 컬럼으로 해소.

ALTER TABLE canned_responses
  ADD COLUMN pending_review BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN canned_responses.pending_review IS
  'true면 관리자 검토 전 — 실시간 고객채팅 자동매칭 후보 조회(api/chat/message)에서 제외됨. CSV 일괄등록(bulk-import)만 true로 생성하고 수기 등록(단건 생성)은 기본 false. 관리자가 CannedResponsePanel에서 저장(PATCH)하면 자동으로 false로 전환됨.';
