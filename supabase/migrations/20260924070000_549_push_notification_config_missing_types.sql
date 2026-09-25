-- Migration #549: push_notification_config — 코드가 실제로 발송하지만 마스터 스위치가 없던 고객 푸시 유형 등록
--
-- 배경(2026-09-24 /cms/set/push 전역 재검증): sendPushToUser()는 push_notification_config 행이 없으면
-- "켜짐"으로 간주(fail-open)해 발송한다. 아래 유형들은 코드에서 이미 발송 중이나 설정 행이 없어
-- CMS 푸시알림 화면에서 끌 방법이 없었다(Production 로그에도 발송 이력 존재).
--
-- category는 전부 'customer_lifecycle' — 설정 행이 없을 때의 기존 수신동의 판정(allow_rental_alert)을
-- 그대로 유지하기 위함(customer_marketing으로 등록하면 allow_benefit_alert로 바뀌어 동작이 달라짐).
-- push_enabled=true 기본 — 등록만으로 기존 발송 동작은 변하지 않는다(멱등, 기존 행 미변경).
--
-- 제외: hold_expired — release_reservation_hold()가 순수 SQL(pg_cron)에서만 실행돼 앱코드 푸시 발송
-- 경로 자체가 없다(push.ts 주석). 스위치를 등록해도 효과가 없어 등록하지 않는다.

INSERT INTO push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'reservation_cancelled',      '예약 취소',                     true),
  ('customer_lifecycle', 'damage_claimed',             '파손 신고 접수',                 true),
  ('customer_lifecycle', 'tracking_notify',            '운송장 번호 등록',               true),
  ('customer_lifecycle', 'locker_guide',               '무인보관함 이용 안내',           true),
  ('customer_lifecycle', 'dhero_place_guide',          '두발히어로 수령 위치 등록 안내', true),
  ('customer_lifecycle', 'payment_cancelled_reissue',  '예약변경(결제취소 후 재발송)',   true),
  ('customer_lifecycle', 'contract_signed_customer',   '전자계약 서명 완료',             true),
  ('customer_lifecycle', 'identity_request',           '본인증명 서류 요청',             true),
  ('customer_lifecycle', 'late_fee_paid',              '연체료 결제 완료',               true),
  ('customer_lifecycle', 'ai_auto_reply',              '상담 AI 자동응답',               true),
  ('customer_lifecycle', 'canned_auto_reply',          '상담 빠른답변 자동응답',         true)
ON CONFLICT (notify_type) DO NOTHING;

-- 쿠폰 선물(coupon_gift)은 등록하지 않는다 — 발송 코드(coupon-gift/direct-send)가 기존 마케팅 스위치
-- event_coupon_issued("이벤트·쿠폰 발행")를 notify_type으로 사용하도록 연결(2026-09-25). 최초 적용본에는
-- coupon_gift 행이 포함돼 있었으나 같은 날 죽은 스위치가 되어 Stage·Production에서 삭제함.

-- rollback:
-- DELETE FROM push_notification_config WHERE notify_type IN (
--   'reservation_cancelled','damage_claimed','tracking_notify','locker_guide','dhero_place_guide',
--   'payment_cancelled_reissue','contract_signed_customer','identity_request','late_fee_paid',
--   'ai_auto_reply','canned_auto_reply');
