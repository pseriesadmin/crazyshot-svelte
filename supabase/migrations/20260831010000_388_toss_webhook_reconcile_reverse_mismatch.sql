-- Migration 388 — process_pending_toss_webhooks 편도 판정 보완 (2026-08-31)
--
-- 문제(toss_payments_pg_integration_2026-08-30.md F3): Migration 380/383의 대사 로직은
-- pt_status='cancelled' AND wh_status='DONE' 방향의 불일치만 STATUS_MISMATCH_WARN으로
-- 잡는다. 반대 방향 — 우리 DB는 pt_status='done'(결제완료로 알고 있음)인데 Toss 웹훅은
-- 'CANCELED'/'PARTIAL_CANCELED'/'ABORTED'/'EXPIRED' 등 실제로는 완료되지 않았거나 이후
-- 취소·역전된 상태를 보내는 경우는 ELSE 분기로 떨어져 'reconciled'(정상 대사 완료)로 잘못
-- 표기된다 — 카드사 이의제기 등으로 PG단에서 결제가 역전된 경우를 놓칠 수 있는 잠재 갭
-- (실트래픽 71건은 전부 Toss 대시보드 웹훅 테스트 발송 핑이라 아직 실제로 발현된 적은 없음).
--
-- 수정: pt_status='done'인데 wh_status가 완료 상태가 아닌 경우도 STATUS_MISMATCH_WARN으로
-- 분리 — 두 방향 모두 편도 없이 잡는다. 1차 범위(안전망) 원칙은 그대로 유지 — 여전히 로그만
-- 남기고 예약 상태를 자동으로 되돌리는 능동적 처리는 하지 않는다.
--
-- 롤백: 이 파일 이전 버전(Migration 383)의 함수 본문으로 CREATE OR REPLACE 재실행.

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
      v_order_id  := v_log.payload -> 'data' ->> 'orderId';
      v_wh_status := v_log.payload -> 'data' ->> 'status';

      -- payment_transactions 대사 (orderId 기준 — payment_transactions.order_id = Toss 문자열 orderId)
      SELECT status INTO v_pt_status
      FROM payment_transactions
      WHERE order_id = v_order_id
      LIMIT 1;

      -- 대사 결과 판정 — 양방향 불일치 모두 탐지
      IF v_pt_status IS NULL THEN
        -- payment_transactions 행 없음 (미확정 결제 or 다른 경로 웹훅 — 예: 빌링/테스트 핑)
        v_result := jsonb_build_object(
          'note',        'no_matching_payment_transaction',
          'order_id',    v_order_id,
          'wh_status',   v_wh_status,
          'processed_at', now()
        );
      ELSIF v_pt_status = 'cancelled' AND v_wh_status = 'DONE' THEN
        -- 불일치 탐지(방향 A): DB는 cancelled인데 웹훅은 DONE
        v_result := jsonb_build_object(
          'note',       'STATUS_MISMATCH_WARN',
          'order_id',   v_order_id,
          'pt_status',  v_pt_status,
          'wh_status',  v_wh_status,
          'processed_at', now()
        );
      ELSIF v_pt_status = 'done' AND v_wh_status IN ('CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED') THEN
        -- 불일치 탐지(방향 B, 신규): DB는 done인데 웹훅은 실제로 완료되지 않았거나 이후
        -- 역전된 상태(카드사 이의제기 등 PG단 단독 취소 포함) — 방향 A만 잡던 편도 갭 보완
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
