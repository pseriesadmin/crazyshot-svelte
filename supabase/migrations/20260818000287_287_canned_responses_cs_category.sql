-- Migration #287: 빠른답변(canned_responses) 카테고리에 'cs' 값 추가
-- 목적: CannedResponsePanel "카테고리" 콤보 버튼에 'CS' 항목 추가
-- (기존 마이그레이션 파일 직접 수정 금지 원칙에 따라 #185의 CHECK 제약을 신규 마이그레이션으로 확장)

ALTER TABLE canned_responses DROP CONSTRAINT canned_responses_category_check;

ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_category_check
  CHECK (category IN ('return', 'payment', 'reservation', 'damage', 'general', 'cs'));
