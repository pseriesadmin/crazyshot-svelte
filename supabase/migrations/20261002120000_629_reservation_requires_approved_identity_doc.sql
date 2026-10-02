-- Migration #629: 본인증명/외국인증명 관리자 승인 전 예약신청 서버 차단 (2026-10-02, Stephen 확정)
--
-- 정책: 본인증명 또는 외국인증명 서류가 "등록 + 관리자 승인"되기 전에는 고객이 예약(hold)·임시예약(draft)을
--   만들거나 draft→hold로 승격할 수 없다. 레거시 회원 포함 예외 없음. 승인 판정식은 migration #526과 동일
--   (승인시각이 있고 제출시각 이후 — 승인 후 재제출되면 다시 대기).
-- 집행 지점: 예약 생성 RPC 4종(create_hold_reservation·create_draft_reservation·
--   create_hold_reservation_with_shipment·promote_draft_reservation)을 각각 고치지 않고, 이들이 모두
--   거치는 rental_reservations 테이블 트리거 한 곳에서 집행한다(INSERT + draft→hold 승격).
-- 면제: auth.uid()가 NULL(service_role·cron·서버 관리 경로)이거나 CMS 직원(is_cms_user())인 경우 — 관리자가
--   고객 대신 만드는 예약·시스템 처리는 막지 않는다. 고객 JWT로 호출되는 SECURITY DEFINER RPC 내부에서도
--   auth.uid()는 호출자 고객 id를 유지하므로 그대로 집행된다.
-- 롤백: DROP TRIGGER trg_require_approved_identity_doc_ins/_upd ON public.rental_reservations;
--       DROP FUNCTION public.trg_require_approved_identity_doc();

CREATE OR REPLACE FUNCTION public.trg_require_approved_identity_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row user_profiles%ROWTYPE;
  v_has_identity BOOLEAN;
  v_has_foreign  BOOLEAN;
  v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR public.is_cms_user() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_row FROM user_profiles WHERE user_id = NEW.user_id;

  v_has_identity := COALESCE(array_length(v_row.identity_doc_url, 1), 0) > 0;
  v_has_foreign  := COALESCE(array_length(v_row.foreign_doc_urls, 1), 0) > 0 OR v_row.foreign_doc_url IS NOT NULL;

  IF v_has_identity AND v_row.identity_approved_at IS NOT NULL
     AND (v_row.identity_verified_at IS NULL OR v_row.identity_approved_at >= v_row.identity_verified_at) THEN
    v_ok := TRUE;
  ELSIF v_has_foreign AND v_row.foreign_approved_at IS NOT NULL
     AND (v_row.foreign_verified_at IS NULL OR v_row.foreign_approved_at >= v_row.foreign_verified_at) THEN
    v_ok := TRUE;
  END IF;

  IF NOT v_ok THEN
    IF v_has_identity OR v_has_foreign THEN
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

DROP TRIGGER IF EXISTS trg_require_approved_identity_doc_ins ON public.rental_reservations;
CREATE TRIGGER trg_require_approved_identity_doc_ins
  BEFORE INSERT ON public.rental_reservations
  FOR EACH ROW
  WHEN (NEW.status IN ('hold', 'draft'))
  EXECUTE FUNCTION public.trg_require_approved_identity_doc();

DROP TRIGGER IF EXISTS trg_require_approved_identity_doc_upd ON public.rental_reservations;
CREATE TRIGGER trg_require_approved_identity_doc_upd
  BEFORE UPDATE OF status ON public.rental_reservations
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'hold')
  EXECUTE FUNCTION public.trg_require_approved_identity_doc();
