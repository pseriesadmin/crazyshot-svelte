-- Migration #729: #728 사전 접수 보완 (sp3 검수, 2026-10-18)
--   M1: 공개 증빙 폼의 업로드 서명·제출에 횟수 상한(서명 30회 / 제출 5회 per 토큰)을 둬 저장소 소진·관리자 푸시 폭주를 막는다.
--   M2: 사전 접수 해제 시 제출된 요청(submitted)도 닫는다 — 해제 뒤 같은 링크로 다시 제출·재사용되지 않게.
--   M3: 증빙 제출·서명은 반납 전(계약완료~반납요청) 예약에서만 — 반납완료(검수 중)·완료·취소 후에는 내용이 바뀌지 않는다.
-- ROLLBACK: #728 본문으로 cancel/submit 을 CREATE OR REPLACE, DROP FUNCTION issue_report_take_upload_slot, 컬럼 2개 제거.

ALTER TABLE public.reservation_issue_reports
  ADD COLUMN IF NOT EXISTS sign_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submit_count integer NOT NULL DEFAULT 0;

-- 업로드 서명 1회 소진 — 열린 요청·기한·예약 단계·횟수를 한 번에 확인하고 성공하면 카운트를 올린다.
CREATE OR REPLACE FUNCTION public.issue_report_take_upload_slot(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_report public.reservation_issue_reports%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_report FROM reservation_issue_reports WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'error', '유효하지 않은 링크예요.'); END IF;
  IF v_report.status = 'cancelled' OR v_report.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'closed', 'error', '만료되었거나 취소된 요청이에요. 상담채팅으로 문의해 주세요.');
  END IF;
  SELECT status INTO v_status FROM rental_reservations WHERE id = v_report.reservation_id;
  IF v_status IS NULL OR v_status NOT IN ('confirmed', 'shipped', 'in_use', 'return_requested') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'closed', 'error', '반납 이후에는 증빙을 올릴 수 없어요. 상담채팅으로 문의해 주세요.');
  END IF;
  IF v_report.sign_count >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'limit', 'error', '업로드 횟수를 초과했어요. 상담채팅으로 문의해 주세요.');
  END IF;
  UPDATE reservation_issue_reports SET sign_count = sign_count + 1 WHERE id = v_report.id;
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_report.reservation_id);
END;
$$;

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
  -- 제출된 요청까지 닫아 해제 뒤 같은 링크로 다시 제출하거나 재사용되지 않게 한다(제출 내용은 행에 기록으로 남는다)
  UPDATE reservation_issue_reports SET status = 'cancelled'
   WHERE reservation_id = p_reservation_id AND status IN ('requested', 'submitted');
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_prior_issue_report(p_token text, p_types text[], p_detail text, p_media jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_report public.reservation_issue_reports%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_report FROM reservation_issue_reports WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 링크예요.'); END IF;
  IF v_report.status = 'cancelled' OR v_report.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', '만료되었거나 취소된 요청이에요. 상담채팅으로 문의해 주세요.');
  END IF;
  SELECT status INTO v_status FROM rental_reservations WHERE id = v_report.reservation_id;
  IF v_status IS NULL OR v_status NOT IN ('confirmed', 'shipped', 'in_use', 'return_requested') THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납 이후에는 증빙을 바꿀 수 없어요. 상담채팅으로 문의해 주세요.');
  END IF;
  IF v_report.submit_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', '제출 횟수를 초과했어요. 상담채팅으로 문의해 주세요.');
  END IF;
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이상 유형을 1개 이상 선택해 주세요.');
  END IF;

  UPDATE reservation_issue_reports
     SET status = 'submitted', issue_types = p_types, detail = NULLIF(btrim(COALESCE(p_detail, '')), ''),
         media = COALESCE(p_media, '[]'::jsonb), submitted_at = now(), submit_count = submit_count + 1
   WHERE id = v_report.id;
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_report.reservation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_report_take_upload_slot(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_prior_issue(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_prior_issue_report(text, text[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_report_take_upload_slot(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_prior_issue(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_prior_issue_report(text, text[], text, jsonb) TO service_role;
