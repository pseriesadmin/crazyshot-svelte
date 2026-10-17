-- Migration #721: SMS 같은 날 중복 방지 인덱스 — 본인증명 등록요청(identity_request)도 예외로 추가 (2026-10-17, Stephen 확정 A안)
--
-- 배경: 본인증명 등록요청 문자가 sms_notification_logs에 기록되지 않아 예약 상세 '알림발송' 탭에 보이지 않았다. 이제 요청 때마다 예약에 연결해 기록한다.
--   Migration 622·677의 고유 인덱스는 "같은 KST 날짜에 같은 (예약, 알림 종류)의 status='sent' 로그는 1건"이라, 같은 날 재요청(관리자 [재요청]) 기록이 인덱스 위반으로 조용히 누락된다.
--   중복 발송 방지는 앱 코드(요청 24시간·재요청 5분)가 하므로 이 알림 종류는 로그 인덱스에서 제외한다.
-- 롤백: DROP INDEX public.sms_notification_logs_dedup_idx; 후 Migration 677 정의로 재생성.
--   ⚠️ 롤백 전에 같은 날 identity_request 'sent' 행이 2건 이상 쌓였으면 재생성이 실패하므로 해당 행을 먼저 정리해야 한다.

DROP INDEX IF EXISTS public.sms_notification_logs_dedup_idx;

CREATE UNIQUE INDEX sms_notification_logs_dedup_idx
  ON public.sms_notification_logs (reservation_id, notify_type, (DATE(created_at AT TIME ZONE 'Asia/Seoul')))
  WHERE status = 'sent' AND notify_type NOT IN ('contract_link', 'contract_reshare', 'identity_request');
