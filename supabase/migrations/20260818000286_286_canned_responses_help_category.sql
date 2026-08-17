-- Migration #286: 빠른답변(canned_responses)에 "도움말 분류" 상위 분류 추가
-- 목적: /help 고객센터 Order Faq 목록이 canned_responses를 재사용해 자동 반영되도록
--       카테고리(반납/결제/예약/파손/일반) 위에 3개 값(basic/members/etc)짜리 필수 분류 추가
-- (원래 #285로 생성됐으나 동시 진행 중이던 다른 세션의 hold_expiration_restore 마이그레이션과
--  번호 충돌 확인되어 #286으로 재번호 — 내용 변경 없음, Migration #185와 동일한 재번호 관례)

ALTER TABLE canned_responses
  ADD COLUMN help_category VARCHAR(20) CHECK (help_category IN ('basic', 'members', 'etc'));

-- 기존 행 백필: shortcut이 아니라 항상 채워져 있는 category(5값)를 기준으로 매핑
-- (shortcut은 관리자가 자유 입력하는 값이라 형식이 제각각 — 실측 결과 production 38건 중
--  '/반납','/연장','/예약' 정확매칭 2건 외 전부 매칭 실패해 전량 기타로 몰리는 문제 확인,
--  category 기준으로 전환해 해소. Stephen이 이후 CMS에서 개별 재조정 가능)
UPDATE canned_responses SET help_category = 'basic'   WHERE category IN ('return', 'reservation');
UPDATE canned_responses SET help_category = 'members' WHERE category = 'payment';
UPDATE canned_responses SET help_category = 'etc'      WHERE category IN ('damage', 'general');

-- 백필 누락분 방어(category마저 NULL인 행이 있을 경우 기타로 폴백) 후 NOT NULL 확정
UPDATE canned_responses SET help_category = 'etc' WHERE help_category IS NULL;

ALTER TABLE canned_responses ALTER COLUMN help_category SET NOT NULL;
