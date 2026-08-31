-- Migration 380 — process_pending_toss_webhooks + pg_cron (2026-08-29)
-- 웹훅 후속처리 안전망: raw_webhook_logs processed=false 행을 2분마다 대사·마킹
--
-- 1차 범위(안전망): payment_transactions와 대사 후 불일치 로그 + processed=true 마킹만.
--   예약 상태 자동 취소 등 능동적 자동화는 이번 범위 밖 — 후속 아젠다에서 확장.
--
-- plan_source: /Users/stevenmac/.claude/plans/cart-cms-reservation-status-selected-30-merry-fiddle.md Phase 2-3

CREATE OR REPLACE FUNCTION public.process_pending_toss_webhooks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log          RECORD;
  v_order_id     TEXT;
  v_wh_status    TEXT;
  v_pt_status    TEXT;
  v_result       JSONB;
BEGIN
  -- processed=false 행을 배치로 처리 (최대 50건 — 크론 주기 내 처리량 제한)
  FOR v_log IN
    SELECT id, payload, event_type
    FROM raw_webhook_logs
    WHERE processed = false
    ORDER BY received_at ASC
    LIMIT 50
    FOR UPDATE SKIP LOCKED  -- 동시 실행 안전
  LOOP
    BEGIN
      -- 웹훅 페이로드에서 orderId·status 추출
      v_order_id  := v_log.payload ->> 'orderId';
      v_wh_status := v_log.payload ->> 'status';

      -- payment_transactions 대사 (orderId 기준)
      SELECT status INTO v_pt_status
      FROM payment_transactions
      WHERE order_id = v_order_id
      LIMIT 1;

      -- 대사 결과 판정
      IF v_pt_status IS NULL THEN
        -- payment_transactions 행 없음 (미확정 결제 or 다른 경로 웹훅)
        v_result := jsonb_build_object(
          'note',        'no_matching_payment_transaction',
          'order_id',    v_order_id,
          'wh_status',   v_wh_status,
          'processed_at', now()
        );
      ELSIF v_pt_status = 'cancelled' AND v_wh_status = 'DONE' THEN
        -- 불일치 탐지: DB는 cancelled인데 웹훅은 DONE
        v_result := jsonb_build_object(
          'note',       'STATUS_MISMATCH_WARN',
          'order_id',   v_order_id,
          'pt_status',  v_pt_status,
          'wh_status',  v_wh_status,
          'processed_at', now()
        );
      ELSE
        -- 정상 대사 완료
        v_result := jsonb_build_object(
          'note',       'reconciled',
          'order_id',   v_order_id,
          'pt_status',  v_pt_status,
          'wh_status',  v_wh_status,
          'processed_at', now()
        );
      END IF;

      -- processed=true 마킹
      UPDATE raw_webhook_logs
      SET
        processed      = true,
        processed_at   = now(),
        process_result = v_result
      WHERE id = v_log.id;

    EXCEPTION WHEN OTHERS THEN
      -- 개별 행 처리 실패 시 로그만 남기고 다음 행 계속 처리
      UPDATE raw_webhook_logs
      SET
        processed      = true,
        processed_at   = now(),
        process_result = jsonb_build_object(
          'note',       'PROCESS_ERROR',
          'error',      SQLERRM,
          'error_code', SQLSTATE,
          'processed_at', now()
        )
      WHERE id = v_log.id;
    END;
  END LOOP;
END;
$function$;

-- 이 함수는 pg_cron(superuser 컨텍스트)에서만 호출 — anon/authenticated 차단
REVOKE ALL ON FUNCTION public.process_pending_toss_webhooks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_pending_toss_webhooks() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pending_toss_webhooks() TO service_role;

-- pg_cron 잡 등록: 2분마다 실행
-- (이미 동일 이름 잡이 있으면 중복 등록 방지)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'toss-webhook-reconcile'
  ) THEN
    PERFORM cron.schedule(
      'toss-webhook-reconcile',
      '*/2 * * * *',
      $BODY$SELECT public.process_pending_toss_webhooks();$BODY$
    );
  END IF;
END;
$$;
