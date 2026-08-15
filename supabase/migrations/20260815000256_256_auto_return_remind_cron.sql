-- Migration 256: 반납일 자동 return_remind pg_cron
--
-- 목적: 매일 한국시간(KST) 오전 9시(=UTC 00:00)에 end_date = CURRENT_DATE이면서
--   status IN ('in_use', 'return_requested')인 예약에 return_remind 자동 발송.
--   당일 중복 발송 방지 포함 (action_url 기준 오늘 이미 발송된 예약 제외).
--
-- 배경: 관리자가 수동으로 "반납 예정 알림 💬" 버튼을 누르는 수동 경로와 공존.
--   rental-lifecycle.md: return_remind = 자동(이 cron) + 수동(버튼) 겸용으로 변경.
-- 2026-08-15
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

CREATE OR REPLACE FUNCTION public.auto_send_return_remind()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  FOR v_reservation IN
    SELECT rr.id
    FROM rental_reservations rr
    WHERE rr.end_date = CURRENT_DATE
      AND rr.status IN ('in_use', 'return_requested')
      -- rental_reservations에는 deleted_at 컬럼이 없음(소프트삭제 미지원) — 존재하지 않는
      -- 컬럼 필터로 이 cron이 실행될 때마다 에러가 나던 버그, 2026-08-16 재검증 시 발견·제거
      -- 당일 중복 발송 방지:
      -- action_url = '/account/rental/{id}/history' 가 오늘 이미 발송된 예약 제외
      -- (migration 255에서 return_remind에 action_url이 추가됨)
      AND NOT EXISTS (
        SELECT 1
        FROM chat_sessions cs
        JOIN chat_messages cm ON cm.session_id = cs.id
        WHERE cs.user_id = rr.user_id
          AND cm.action_payload->>'type' = 'return_remind'
          AND cm.action_payload->>'action_url' = '/account/rental/' || rr.id::TEXT || '/history'
          AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
          AND cm.created_at <  (CURRENT_DATE + 1)::TIMESTAMPTZ
      )
  LOOP
    PERFORM public.send_rental_chat_notification(v_reservation.id, 'return_remind');
  END LOOP;
END;
$$;

REVOKE ALL     ON FUNCTION public.auto_send_return_remind() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_send_return_remind() TO service_role;

-- 기존 job 제거 후 재등록 (idempotent)
SELECT cron.unschedule('auto-return-remind')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-return-remind'
);

-- Stephen 확정: 반납예정일 당일 "오전 9시"(KST) 발송.
-- pg_cron은 UTC 기준으로 실행되므로 KST(UTC+9) 09:00 = UTC 00:00 — 매일 00:00 UTC 스케줄.
-- ⚠️ 이전 초안(09:00 UTC)은 KST 18:00(저녁)이 되어 요구사항과 어긋나는 버그였음 — 수정됨.
SELECT cron.schedule(
  'auto-return-remind',
  '0 0 * * *',
  $$SELECT public.auto_send_return_remind();$$
);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- SELECT cron.unschedule('auto-return-remind');
-- DROP FUNCTION IF EXISTS public.auto_send_return_remind();
-- ============================================================
