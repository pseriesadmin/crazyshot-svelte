-- Migration #820: '무인보관함 이용안내'(locker_assign_notice) — 무인함 [배정 확정] 저장 즉시 푸시+문자 사전 고지 (2026-11-12, Stephen 지시)
--
-- 동작: 관리자가 예약 패널 '대여' 탭 무인함 정보에서 [배정 확정]을 저장하는 즉시, 푸시알림 설정에 등록한 안내문장(100자 이내)을
--       그 예약 고객에게 푸시+문자로 1회 보낸다. 번호·비밀번호는 넣지 않는다(기존 '수령이용 안내'가 수령 1시간 전에 보냄).
--       등록한 문장이 없거나 이 알림을 끈 상태면 보내지 않는다(코드가 확인).
-- 변경:
--   1) rental_reservations.locker_assign_notice_sent_at — 이 안내를 보낸 시각(예약당 1회 선점 표식). NULL = 아직 안 보냄.
--   2) push_notification_config 에 알림 행 등록(수령·배송 서류철, '무인보관함 수령이용 안내' 바로 아래). 처음에는 문장이 비어 있어 발송되지 않는다.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DELETE FROM push_notification_config WHERE notify_type='locker_assign_notice'; ALTER TABLE rental_reservations DROP COLUMN IF EXISTS locker_assign_notice_sent_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS locker_assign_notice_sent_at timestamptz;

COMMENT ON COLUMN public.rental_reservations.locker_assign_notice_sent_at IS '무인보관함 이용안내(locker_assign_notice, #820) 발송 시각 — 예약당 1회 선점 표식. NULL = 미발송';

INSERT INTO public.push_notification_config (category, notify_type, label, push_enabled, sort_order)
VALUES ('customer_lifecycle', 'locker_assign_notice', '무인보관함 이용안내', true, 155)
ON CONFLICT (notify_type) DO NOTHING;
