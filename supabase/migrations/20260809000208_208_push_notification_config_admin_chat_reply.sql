-- 208: CMS 상담(/cms/chat) 관리자 답장 → 고객 FCM 푸시알림 유형 신규 등록
-- 배경: admin-reply/admin-attachment API가 push.ts 발신 허브에 연결돼 있지 않아 관리자가
-- 채팅으로 답장해도 고객에게 FCM 푸시가 전혀 발송되지 않았음(Stephen 리포트, 2026-08-09).
-- category='customer_lifecycle'로 등록해 기존 sendPushToUser()의 옵트인 컬럼 매핑
-- (allow_rental_alert)을 그대로 재사용 — 신규 옵트인 컬럼 추가 없이 기존 구조에 편입.
insert into push_notification_config (category, notify_type, label, push_enabled)
values ('customer_lifecycle', 'admin_chat_reply', '상담 답장 알림', true)
on conflict (notify_type) do nothing;

-- rollback:
-- delete from push_notification_config where notify_type = 'admin_chat_reply';
