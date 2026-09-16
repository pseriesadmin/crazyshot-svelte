-- Migration 506: auto-return-remind pg_cron → Vercel Cron 전환 (SMS 동시 발송 추가)
--
-- 목적: 기존 auto-return-remind pg_cron은 send_rental_chat_notification RPC(채팅카드)만
--   발송하고 앱코드(push/SMS)를 호출할 수 없는 구조적 한계(service-operations.md §15 참조).
--   이 제약을 해소하기 위해 pg_cron을 해제하고, Vercel Cron(/api/cron/return-remind)으로
--   완전히 대체 — 채팅카드 + 브라우저 푸시(sendReservationLifecyclePush) + SMS(sendSms 직접)을
--   같은 앱코드 요청 안에서 원자적으로 처리한다.
--
-- 변경 내용:
--   1. auto-return-remind pg_cron job 해제 (cron.unschedule)
--   2. get_return_remind_targets() RPC 신설 — Vercel Cron이 호출하는 대상 조회 전용 함수
--      (Migration 256의 auto_send_return_remind()와 동일한 당일 중복 발송 방지 로직 재사용)
--
-- ⚠️ auto_send_return_remind() 함수 자체는 DROP하지 않는다 — 롤백 시 pg_cron 재등록으로
--   재사용 가능하도록 보존.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-09-16

-- ① 기존 pg_cron 해제 (Vercel Cron이 이후 단독 발송 트리거 역할)
SELECT cron.unschedule('auto-return-remind')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-return-remind'
);

-- ② Vercel Cron 전용 대상 조회 RPC
--    반환: 오늘 반납 예정 + 중복 미발송 예약의 reservation_id · user_id · phone · product_name
CREATE OR REPLACE FUNCTION public.get_return_remind_targets()
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
    AND NOT EXISTS (
      SELECT 1
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.user_id  = rr.user_id
        AND cm.action_payload->>'type'       = 'return_remind'
        AND cm.action_payload->>'action_url' = '/account/rental/' || rr.id::TEXT || '/history'
        AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
        AND cm.created_at <  (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ
    );
END;
$$;

REVOKE ALL     ON FUNCTION public.get_return_remind_targets() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_return_remind_targets() TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.get_return_remind_targets();
-- SELECT cron.schedule(
--   'auto-return-remind',
--   '0 0 * * *',
--   $$SELECT public.auto_send_return_remind();$$
-- );
-- ============================================================
