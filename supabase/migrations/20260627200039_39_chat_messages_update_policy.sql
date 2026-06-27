-- Migration 39: NO-OP
-- participant_update_read 정책이 이미 chat_messages에 존재함 (migration 31에서 생성)
-- is_cms_user() SECURITY DEFINER 함수로 관리자 검증 우회 처리됨
-- 추가 UPDATE 정책 불필요 → 이 마이그레이션은 빈 파일로 유지
SELECT 1;
