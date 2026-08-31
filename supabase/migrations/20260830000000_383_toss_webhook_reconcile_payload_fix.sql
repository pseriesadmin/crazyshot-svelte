-- Migration 383 — process_pending_toss_webhooks 페이로드 파싱 수정 (2026-08-30)
-- 문제: Migration 380이 최상위에서 payload->>'orderId' / ->>'status' 로 읽었으나
--       실제 Toss 웹훅 구조는 { eventType, data: { orderId, status, paymentKey, ... } }
--       → data 안에 중첩. 항상 no_matching_payment_transaction 반환 (no-op 버그)
-- 수정: payload -> 'data' ->> 'orderId' / payload -> 'data' ->> 'status' 로 변경
--
-- 기존 마이그레이션(380) 직접 수정 금지 원칙(core-rules.md) 준수 — CREATE OR REPLACE로 재정의

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
      -- 실제 Toss 웹훅 구조: { eventType, data: { orderId, status, paymentKey, ... } }
      -- data 중첩 경로로 추출 (Migration 380의 최상위 추출 버그 수정)
      v_order_id  := v_log.payload -> 'data' ->> 'orderId';
      v_wh_status := v_log.payload -> 'data' ->> 'status';

      -- payment_transactions 대사 (orderId 기준 — payment_transactions.order_id = Toss 문자열 orderId)
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

-- 권한 재적용 (CREATE OR REPLACE가 기존 권한 보존할 수 있으므로 명시적으로 재설정)
REVOKE ALL ON FUNCTION public.process_pending_toss_webhooks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_pending_toss_webhooks() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pending_toss_webhooks() TO service_role;
