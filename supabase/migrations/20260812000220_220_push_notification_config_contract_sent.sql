-- 220: 전자계약 발송(send-chat) → 고객 FCM 푸시알림 유형 신규 등록
-- 배경: /api/cms/contracts/[id]/send-chat가 채팅 action_card는 보내지만 고객 FCM 푸시는
-- 전혀 호출하지 않았음(AUDIT 갭#4, Stephen 리포트 2026-08-09). category='customer_lifecycle'로
-- 등록해 기존 sendPushToUser()의 옵트인 컬럼 매핑(allow_rental_alert)을 그대로 재사용.
insert into push_notification_config (category, notify_type, label, push_enabled)
values ('customer_lifecycle', 'contract_sent', '전자계약 발송', true)
on conflict (notify_type) do nothing;

-- rollback:
-- delete from push_notification_config where notify_type = 'contract_sent';
