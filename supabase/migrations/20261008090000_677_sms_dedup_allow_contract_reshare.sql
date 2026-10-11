-- Migration #677: SMS 같은 날 중복 방지 인덱스 — 완료 계약서 재공유(contract_reshare)도 예외로 추가 (2026-10-08, Stephen 지시)
--
-- 배경: Migration 622의 sms_notification_logs_dedup_idx는 "같은 KST 날짜에 같은 (예약, 알림 종류)의 status='sent' 로그는 1건만" 이라는 고유 인덱스이고
--   contract_link(계약서 재발송)만 예외다. 완료 계약서 재공유(share-chat, notify_type='contract_reshare')는 관리자가 직접 누르는 재발송이라
--   앱 코드가 force=true로 같은 날에도 문자를 다시 보내는데, 두 번째부터 로그 insert가 이 인덱스 위반으로 조용히 실패해
--   관리자 상담 화면 카드의 "SMS 발송 성공" 표시(sms-status)가 실제 발송과 어긋났다(sp3 검수 MINOR).
--
-- 변경: 인덱스를 "status='sent' AND notify_type NOT IN ('contract_link','contract_reshare')"로 다시 만든다. 다른 알림 종류의 같은 날 중복 방지는 그대로.
-- 적용 중 인덱스를 지우고 다시 만드는 사이(한 트랜잭션, 로그 테이블이 작아 즉시 끝남)에는 다른 insert가 대기하므로 중복 방지 공백이 생기지 않는다.
-- 롤백: DROP INDEX public.sms_notification_logs_dedup_idx; 후 Migration 622 정의로 재생성(WHERE status='sent' AND notify_type <> 'contract_link').
--   ⚠️ 롤백 전에 같은 날 contract_reshare 'sent' 행이 2건 이상 쌓였으면 고유 인덱스 재생성이 실패하므로 해당 행을 먼저 정리해야 한다.

DROP INDEX IF EXISTS public.sms_notification_logs_dedup_idx;

CREATE UNIQUE INDEX sms_notification_logs_dedup_idx
  ON public.sms_notification_logs (reservation_id, notify_type, (DATE(created_at AT TIME ZONE 'Asia/Seoul')))
  WHERE status = 'sent' AND notify_type NOT IN ('contract_link', 'contract_reshare');  -- 계약서 재발송·재공유는 같은 날 여러 번 허용
