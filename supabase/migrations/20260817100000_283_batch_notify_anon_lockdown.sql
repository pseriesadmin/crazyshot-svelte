-- Migration 283: send_rental_chat_notification_batch — anon 실행권한 잠금(CRITICAL 보안)
--
-- 배경(2026-08-17, Migration 282 production 배포 후 읽기전용 재확인 중 발견):
-- Migration 275가 이 함수를 신설하며 REVOKE EXECUTE ... FROM PUBLIC, authenticated만
-- 실행하고 anon을 빠뜨려, 비로그인 사용자(anon 키)가 이 예약알림 배치 RPC를 직접 호출할
-- 수 있는 상태였다(stage 실제 anon 키로 RPC 직접 호출해 정상 실행됨을 재현·확인).
--
-- 이 함수는 SECURITY DEFINER로 상담채팅 세션에 임의 예약ID를 조회해 알림 메시지를
-- INSERT할 수 있어, 비로그인 사용자가 남의 예약ID를 추측/스캔해 원치 않는 채팅 메시지를
-- 주입시키거나 예약 존재 여부를 오라클(oracle)처럼 확인하는 데 악용될 수 있다.
--
-- 수정: send_rental_chat_notification(단건)·notify_late_fee_payment_request와 동일하게
-- anon도 명시적으로 REVOKE — 함수 로직·다른 권한(postgres·service_role)은 변경 없음.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

REVOKE EXECUTE ON FUNCTION public.send_rental_chat_notification_batch(bigint[], text) FROM anon;

-- ============================================================
-- ROLLBACK:
-- GRANT EXECUTE ON FUNCTION public.send_rental_chat_notification_batch(bigint[], text) TO anon;
-- ============================================================
