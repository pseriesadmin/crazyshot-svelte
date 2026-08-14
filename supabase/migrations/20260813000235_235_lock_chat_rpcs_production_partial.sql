-- Migration 235: 233의 production 부분 적용 기록 (get_chat_customer_detail 제외)
-- (2026-08-13 파일명 234→235로 정정 — 동시간대 무관한 다른 세션의 234_fix_coupon_usage_report와
--  로컬 파일명 충돌 발견, DB에는 이미 "233_lock_chat_rpcs_to_service_role_partial" 이름으로
--  기록되어 있어 실제 적용에는 영향 없음)
--
-- 배경: migration 229(get_chat_customer_detail)는 user_subscriptions.next_billing_date 컬럼을
--   참조하는데, production(vnbpmvxruyciuuaermyh)의 user_subscriptions는 stage와 스키마가 달라
--   (id/user_id/plan_id/status/started_at/expires_at/cancelled_at/created_at/updated_at만 존재,
--   next_billing_date 없음 — stage 전용 구독 기능 마이그레이션 223/224/227/228이 아직 production에
--   적용되지 않은 상태) 그대로 적용하면 CREATE FUNCTION 자체가 실패한다.
--   이 구독 스키마 갭은 이번 상담(채팅) 작업과 무관한 별도 진행 중인 기능이라 임의로 production에
--   함께 반영하지 않고, 229는 production 미적용 상태로 보류(Stephen 결정 대기).
--
-- 233(전체 4개 RPC 잠금)은 get_chat_customer_detail을 포함하므로 그 함수가 없는 production에서는
--   그대로 실행 불가 — 대신 229와 무관한 나머지 3개 RPC(manual_mode/bookmark 계열)만 이 파일로
--   잠갔다. get_chat_customer_detail의 PUBLIC 권한 회수는 229가 production에 적용되는 시점에
--   함께 처리한다(후속 마이그레이션 예정).
--
-- stage(ezyvffjvuwmtuhpxdjrw)에는 229·233이 모두 정상 적용되어 4개 전부 잠겨 있음 — 이 파일은
--   production 전용이며 stage에는 적용하지 않는다.

REVOKE EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_session_manual_mode(uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_message_bookmark(uuid, uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_bookmarks(uuid, uuid) TO service_role;
