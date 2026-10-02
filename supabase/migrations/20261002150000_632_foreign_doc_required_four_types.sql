-- Migration #632: 외국인증명 필수 조합을 "체류 유형별 4종 전부"로 변경 (2026-10-02, Stephen 확정 — B안)
-- 배경: Migration #495에 따라 외국인증명은 4종이 모두 등록돼야 제출 완료 시각(foreign_verified_at)이 기록되고
--   CMS "승인" 버튼이 나타난다. #630의 2~3종 조합으로는 예약 차단이 "승인 대기"를 띄우지만 관리자가 승인할 수 없는
--   교착이 생기므로 예약 필수 조건을 4종 전부로 맞춘다(단기: 여권사진면·숙소예약확인서·입국/출국 E-Ticket,
--   장기: 외국인등록증 앞·뒷면·여권사진면·외국인사실증명서). 본인증명 조건·면제·권한은 #630 그대로.
-- 롤백: #630 본문의 trg_require_approved_identity_doc()로 되돌린다.

CREATE OR REPLACE FUNCTION public.trg_require_approved_identity_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row user_profiles%ROWTYPE;
  v_identity_ok BOOLEAN;
  v_foreign_ok  BOOLEAN;
  v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR public.is_cms_user() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_row FROM user_profiles WHERE user_id = NEW.user_id;

  v_identity_ok := COALESCE(array_length(v_row.identity_doc_url, 1), 0) > 0
    AND (v_row.identity_type @> ARRAY['resident'] OR v_row.identity_type @> ARRAY['driver'])
    AND v_row.identity_type @> ARRAY['resident_copy'];

  v_foreign_ok := (COALESCE(array_length(v_row.foreign_doc_urls, 1), 0) > 0 OR v_row.foreign_doc_url IS NOT NULL)
    AND (v_row.foreign_type @> ARRAY['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket']
         OR v_row.foreign_type @> ARRAY['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert']);

  IF v_identity_ok AND v_row.identity_approved_at IS NOT NULL
     AND (v_row.identity_verified_at IS NULL OR v_row.identity_approved_at >= v_row.identity_verified_at) THEN
    v_ok := TRUE;
  ELSIF v_foreign_ok AND v_row.foreign_approved_at IS NOT NULL
     AND (v_row.foreign_verified_at IS NULL OR v_row.foreign_approved_at >= v_row.foreign_verified_at) THEN
    v_ok := TRUE;
  END IF;

  IF NOT v_ok THEN
    IF v_identity_ok OR v_foreign_ok THEN
      RAISE EXCEPTION 'DOC_NOT_APPROVED: 본인증명정보 승인을 기다려주세요.' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'DOC_NOT_APPROVED: 본인증명정보를 등록해주세요.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_require_approved_identity_doc() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_require_approved_identity_doc() FROM anon, authenticated;
