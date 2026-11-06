-- Migration #788: 연체료 알림 — 관리자 결제 확인 + 결제 요청 푸시·문자 발송 대상 선점
--
-- 배경(2026-11-02, Stephen 지시):
--  · 연체 감지(auto_detect_late_fees, #269)는 순수 SQL(pg_cron)이라 채팅 요청카드만 만들고 푸시·문자를 보낼 수 없다
--    → 앱 크론(/api/cron/late-fee-notice)이 "요청 알림 미발송" 연체료를 가져가 푸시·문자를 보낸다(claim_late_fees_for_notice).
--  · 고객 모의결제(pay_late_fee_mock) 외에 현장·계좌이체 등은 관리자가 [결제 확인]으로 완료 처리한다(admin_confirm_late_fee_paid).
--
-- 변경:
--  1) late_fees.request_notified_at  — 결제 요청 푸시·문자를 보낸(선점한) 시각. 기존 행은 created_at 으로 채워 첫 실행 때 옛 연체료에 문자가 쏟아지지 않게 한다.
--  2) late_fees.confirmed_by         — 관리자가 결제 확인한 경우 그 관리자 id(NULL = 고객 본인 결제 또는 미결제).
--  3) claim_late_fees_for_notice / release_late_fee_notice / admin_confirm_late_fee_paid — 서버 전용(service_role)
--  4) push_notification_config 'late_fee_request'(연체료 결제 요청) 스위치 행
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.

ALTER TABLE public.late_fees
  ADD COLUMN IF NOT EXISTS request_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid;

COMMENT ON COLUMN public.late_fees.request_notified_at IS '결제 요청 푸시·문자를 선점해 발송한 시각(크론 late-fee-notice). NULL = 아직 안 보냄';
COMMENT ON COLUMN public.late_fees.confirmed_by IS '관리자가 [결제 확인]으로 완료 처리한 경우의 관리자 id. NULL = 고객 본인 결제 또는 미결제';

-- 기존 행은 이미 요청 카드가 나간 것으로 보고 채운다(첫 크론 실행 때 문자 폭주 방지)
UPDATE public.late_fees SET request_notified_at = created_at WHERE request_notified_at IS NULL;

-- ── 1) 결제 요청 알림 대상 선점 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_late_fees_for_notice(p_limit integer DEFAULT 100)
RETURNS TABLE(late_fee_id uuid, rsv_id bigint, amount numeric, hours integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT lf.id
    FROM   public.late_fees lf
    WHERE  lf.is_paid = false
      AND  lf.request_notified_at IS NULL
    ORDER BY lf.created_at
    LIMIT  GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.late_fees lf
  SET    request_notified_at = now(),
         updated_at          = now()
  FROM   picked
  WHERE  lf.id = picked.id
  RETURNING lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late;
$$;

-- 발송 실패 건을 다음 크론이 다시 집을 수 있게 되돌린다
CREATE OR REPLACE FUNCTION public.release_late_fee_notice(p_late_fee_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.late_fees
  SET    request_notified_at = NULL,
         updated_at          = now()
  WHERE  id = p_late_fee_id
    AND  is_paid = false;
$$;

-- ── 2) 관리자 결제 확인 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_confirm_late_fee_paid(p_late_fee_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee RECORD;
BEGIN
  IF p_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자 정보가 없습니다.', 'status', 400);
  END IF;

  SELECT lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late, lf.is_paid
  INTO   v_fee
  FROM   public.late_fees lf
  WHERE  lf.id = p_late_fee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '연체료를 찾을 수 없습니다.', 'status', 404);
  END IF;

  IF v_fee.is_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 결제 완료된 연체료입니다.', 'status', 409);
  END IF;

  UPDATE public.late_fees
  SET    is_paid      = true,
         paid_at      = now(),
         confirmed_by = p_admin_id,
         updated_at   = now()
  WHERE  id = p_late_fee_id;

  RETURN jsonb_build_object('ok', true, 'reservation_id', v_fee.reservation_id, 'fee_amount', v_fee.fee_amount);
END;
$$;

-- 서버 전용: PUBLIC·anon·authenticated 모두 회수 + service_role 명시 부여(rules: service-operations.md §23)
REVOKE ALL ON FUNCTION public.claim_late_fees_for_notice(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_late_fee_notice(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_confirm_late_fee_paid(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_late_fees_for_notice(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_late_fee_notice(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_late_fee_paid(uuid, uuid) TO service_role;

-- ── 3) 푸시알림 설정 스위치 ─────────────────────────────────────────────
INSERT INTO public.push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'late_fee_request', '연체료 결제 요청', true)
ON CONFLICT (notify_type) DO NOTHING;

-- rollback(코드를 먼저 되돌린 뒤 DB를 되돌릴 것):
-- DELETE FROM public.push_notification_config WHERE notify_type = 'late_fee_request';
-- DROP FUNCTION IF EXISTS public.admin_confirm_late_fee_paid(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.release_late_fee_notice(uuid);
-- DROP FUNCTION IF EXISTS public.claim_late_fees_for_notice(integer);
-- ALTER TABLE public.late_fees DROP COLUMN IF EXISTS confirmed_by, DROP COLUMN IF EXISTS request_notified_at;
