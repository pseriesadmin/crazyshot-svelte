-- Migration 507: get_return_remind_targets() — p_limit 파라미터 추가
--
-- 목적: Migration 506에서 신설한 get_return_remind_targets()는 파라미터 없이
--   전체 결과를 한 번에 반환했다. 대상이 BATCH_SIZE를 초과하면 앱 코드에서
--   slice(0, BATCH_SIZE)로 자르는 구조라 101번째부터 영구 누락되는 결함이 있었다.
--   이 마이그레이션에서 p_limit 파라미터를 추가해 RPC가 직접 건수를 제한하도록 변경하고,
--   앱 코드에서 BATCH_SIZE+MAX_BATCHES 다중 배치 루프를 사용할 수 있게 한다.
--
-- 수정 내용:
--   1. 기존 파라미터 없는 get_return_remind_targets() DROP
--      (PostgreSQL은 시그니처가 다르면 별도 함수로 취급 — 오버로드 중복 방지를 위해 명시적 DROP)
--   2. p_limit INT DEFAULT 100 파라미터를 포함한 신버전 CREATE
--      (기존 호출부(p_limit 생략)도 DEFAULT 값으로 계속 동작)
--
-- 배치 반복 원리:
--   ③ 채팅카드(send_rental_chat_notification)가 먼저 발송된 예약은 이 RPC의 NOT EXISTS
--   dedup 조건에 걸려 다음 배치 호출에서 자동 제외된다 — claim_reservations_due_for_locker_guide
--   의 원자 선점 방식과 동일한 효과를 dedup 조건으로 구현.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-09-16

-- ① 기존 파라미터 없는 함수 DROP (시그니처 충돌 방지)
DROP FUNCTION IF EXISTS public.get_return_remind_targets();

-- ② p_limit 파라미터 포함 신버전
CREATE OR REPLACE FUNCTION public.get_return_remind_targets(p_limit INT DEFAULT 100)
RETURNS TABLE (
  reservation_id BIGINT,
  user_id        UUID,
  phone          TEXT,
  product_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rr.id             AS reservation_id,
    rr.user_id,
    up.phone,
    p.name            AS product_name
  FROM rental_reservations rr
  LEFT JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN products        p  ON p.id  = rr.product_id
  WHERE rr.end_date = CURRENT_DATE
    AND rr.status IN ('in_use', 'return_requested')
    -- Migration 256 auto_send_return_remind()와 동일한 당일 중복 발송 방지:
    -- return_remind 채팅카드(action_url 기준)가 오늘 이미 발송된 예약은 제외한다.
    -- 배치 루프 원리: ③ 채팅카드 발송 직후 다음 배치를 조회하면 방금 처리된 건은
    -- 이 NOT EXISTS 조건에 걸려 자동으로 다음 배치 후보에서 빠진다.
    AND NOT EXISTS (
      SELECT 1
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.user_id  = rr.user_id
        AND cm.action_payload->>'type'       = 'return_remind'
        AND cm.action_payload->>'action_url' = '/account/rental/' || rr.id::TEXT || '/history'
        AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
        AND cm.created_at <  (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ
    )
  LIMIT p_limit;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_return_remind_targets(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_return_remind_targets(INT) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.get_return_remind_targets(INT);
-- -- Migration 506의 원본 함수 복원:
-- CREATE OR REPLACE FUNCTION public.get_return_remind_targets()
-- RETURNS TABLE (reservation_id BIGINT, user_id UUID, phone TEXT, product_name TEXT)
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $$
-- BEGIN
--   RETURN QUERY
--   SELECT rr.id, rr.user_id, up.phone, p.name
--   FROM rental_reservations rr
--   LEFT JOIN user_profiles up ON up.id = rr.user_id
--   LEFT JOIN products p ON p.id = rr.product_id
--   WHERE rr.end_date = CURRENT_DATE
--     AND rr.status IN ('in_use', 'return_requested')
--     AND NOT EXISTS (
--       SELECT 1 FROM chat_sessions cs JOIN chat_messages cm ON cm.session_id = cs.id
--       WHERE cs.user_id = rr.user_id
--         AND cm.action_payload->>'type' = 'return_remind'
--         AND cm.action_payload->>'action_url' = '/account/rental/' || rr.id::TEXT || '/history'
--         AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
--         AND cm.created_at < (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ
--     );
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.get_return_remind_targets() FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_return_remind_targets() TO service_role;
-- ============================================================
