-- Migration #728: CS 사전 이슈 접수 + 고객 증빙 폼 토큰 (3단계, 2026-10-18)
--   · 크레이지챗/전화로 장비 이상·파손·분실이 접수되면 운영자가 예약에 [이슈 사전 접수]를 눌러 has_prior_issue 를 켠다(#724 컬럼).
--     그 예약이 반납완료(returned)가 되면 #724 트리거가 자동으로 inspection_status='issue' 로 시작해 검수 칩으로 간다.
--   · 고객에게는 증빙 입력 폼(토큰 링크)을 보낸다 — reservation_issue_reports 가 토큰·제출 내용을 가진다.
--   · RPC 는 service_role 전용. 사전 접수는 반납 전(계약완료~반납요청) 예약에만 가능하다(이미 반납완료면 검수 탭에서 직접 이슈 등록).
-- ROLLBACK: DROP FUNCTION 3종; DROP TABLE reservation_issue_reports; has_prior_issue 컬럼은 #724 소관.

CREATE TABLE IF NOT EXISTS public.reservation_issue_reports (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  token          text   NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status         text   NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'submitted', 'cancelled')),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '14 days',
  issue_types    text[] NOT NULL DEFAULT ARRAY[]::text[],
  detail         text,
  media          jsonb  NOT NULL DEFAULT '[]'::jsonb,
  requested_by   uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS reservation_issue_reports_res_idx ON public.reservation_issue_reports (reservation_id);
ALTER TABLE public.reservation_issue_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_issue_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_issue_reports TO service_role;

-- 사전 접수 — has_prior_issue 를 켜고 증빙 폼 토큰을 발급한다(이미 열린 요청이 있으면 재사용하고 기한만 연장).
CREATE OR REPLACE FUNCTION public.register_prior_issue(p_reservation_id bigint, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_report public.reservation_issue_reports%ROWTYPE;
  v_reused boolean := false;
BEGIN
  SELECT status INTO v_status FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status = 'returned' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 반납완료된 예약이에요. 검수 탭에서 이슈를 직접 등록해 주세요.');
  END IF;
  IF v_status NOT IN ('confirmed', 'shipped', 'in_use', 'return_requested') THEN
    RETURN jsonb_build_object('ok', false, 'error', '계약완료부터 반납요청 단계의 예약에만 사전 접수를 할 수 있어요.');
  END IF;

  UPDATE rental_reservations SET has_prior_issue = true WHERE id = p_reservation_id;

  SELECT * INTO v_report FROM reservation_issue_reports
   WHERE reservation_id = p_reservation_id AND status IN ('requested', 'submitted')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    v_reused := true;
    UPDATE reservation_issue_reports SET expires_at = now() + interval '14 days' WHERE id = v_report.id
    RETURNING * INTO v_report;
  ELSE
    INSERT INTO reservation_issue_reports (reservation_id, requested_by)
    VALUES (p_reservation_id, p_admin_id) RETURNING * INTO v_report;
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', v_report.id, 'token', v_report.token, 'reused', v_reused, 'status', v_report.status);
END;
$$;

-- 사전 접수 해제 — 반납 전 예약에서만. 열린 요청은 취소 처리(제출 내용은 기록으로 남는다).
CREATE OR REPLACE FUNCTION public.cancel_prior_issue(p_reservation_id bigint, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status NOT IN ('confirmed', 'shipped', 'in_use', 'return_requested') THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납 전 예약에서만 사전 접수를 해제할 수 있어요.');
  END IF;

  UPDATE rental_reservations SET has_prior_issue = false WHERE id = p_reservation_id;
  UPDATE reservation_issue_reports SET status = 'cancelled'
   WHERE reservation_id = p_reservation_id AND status = 'requested';
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 고객 증빙 제출 — 토큰으로만. 열린(requested/submitted) 요청이고 기한 안일 때 내용을 저장한다(제출 후에도 기한 안에는 다시 제출해 교체 가능).
CREATE OR REPLACE FUNCTION public.submit_prior_issue_report(p_token text, p_types text[], p_detail text, p_media jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_report public.reservation_issue_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_report FROM reservation_issue_reports WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 링크예요.'); END IF;
  IF v_report.status = 'cancelled' OR v_report.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', '만료되었거나 취소된 요청이에요. 상담채팅으로 문의해 주세요.');
  END IF;
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이상 유형을 1개 이상 선택해 주세요.');
  END IF;

  UPDATE reservation_issue_reports
     SET status = 'submitted', issue_types = p_types, detail = NULLIF(btrim(COALESCE(p_detail, '')), ''),
         media = COALESCE(p_media, '[]'::jsonb), submitted_at = now()
   WHERE id = v_report.id;
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_report.reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.register_prior_issue(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_prior_issue(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_prior_issue_report(text, text[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_prior_issue(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_prior_issue(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_prior_issue_report(text, text[], text, jsonb) TO service_role;

INSERT INTO push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'issue_report_request', '이상·파손 증빙 등록 요청', true)
ON CONFLICT (notify_type) DO NOTHING;
