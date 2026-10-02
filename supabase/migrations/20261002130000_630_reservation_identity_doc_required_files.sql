-- Migration #630: 예약 차단 트리거에 "필수 파일 조합" 조건 추가 (2026-10-02, Stephen 확정)
-- #629는 서류가 1개라도 있고 승인되면 통과시켰다. 필수 파일 중 하나라도 누락이면 "등록되지 않음"으로 보아
-- 승인 여부와 무관하게 차단한다(메시지: 본인증명정보를 등록해주세요).
--   본인증명: (resident 또는 driver) + resident_copy
--   외국인증명: passport_photo + (accommodation_reservation 또는 arc_front+arc_back)
-- 필수 조합을 갖춘 증명 중 하나라도 승인(#526 판정식)되면 통과. 면제·권한·트리거 구성은 #629 그대로.
-- 롤백: #629 본문의 trg_require_approved_identity_doc()로 되돌린다.

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
    AND v_row.foreign_type @> ARRAY['passport_photo']
    AND (v_row.foreign_type @> ARRAY['accommodation_reservation']
         OR v_row.foreign_type @> ARRAY['arc_front', 'arc_back']);

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
