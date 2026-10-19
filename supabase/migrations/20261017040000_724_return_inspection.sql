-- Migration #724: 반납 검수 승인 체계 (2단계, 2026-10-17)
--   · 별도 컬럼 inspection_status(pending/issue/pass/resolved)로 검수 상태를 표현한다 — 예약 status(returned)는 그대로라 전환 맵·QR·두발히어로·집계는 무변경.
--   · returned 진입 시 자동 초기화: has_prior_issue ? 'issue' : 'pending' (CMS·QR·두발히어로 어느 경로든 한 곳에서).
--   · 검수 승인 없이 returned→completed 로 가는 경로는 DB 트리거가 막는다(INSPECTION_REQUIRED). 완료는 아래 RPC만.
--   · RPC 3종은 service_role 전용, 같은 주문(order_items)의 returned 형제 예약을 함께 처리한다.
--   · get_rental_list 에 p_inspection_scope('pending'|'issue') 추가 — 라이브 정의 앵커 치환(전체 재작성 금지).
-- ROLLBACK: DROP TRIGGER trg_rental_inspection_status; DROP FUNCTION 신규 4종; get_rental_list 는 p_inspection_scope 줄 3곳(-- inspection-724)만 제거 후 재생성; 컬럼·테이블은 데이터 확인 후 제거.

-- 1) 컬럼
ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS inspection_status text CHECK (inspection_status IN ('pending', 'issue', 'pass', 'resolved')),
  ADD COLUMN IF NOT EXISTS inspected_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspected_by uuid,
  ADD COLUMN IF NOT EXISTS has_prior_issue boolean NOT NULL DEFAULT false;

-- 2) 이슈 기록(같은 예약에 여러 번 가능 — 열린 이슈 = resolved_at IS NULL). 증빙은 비공개 버킷 return-evidence 경로(jsonb).
CREATE TABLE IF NOT EXISTS public.reservation_inspection_issues (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id  bigint NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  issue_types     text[] NOT NULL CHECK (cardinality(issue_types) > 0),
  detail          text,
  media           jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_admin  uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution_note text
);
CREATE INDEX IF NOT EXISTS reservation_inspection_issues_res_idx ON public.reservation_inspection_issues (reservation_id);
ALTER TABLE public.reservation_inspection_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_inspection_issues FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_inspection_issues TO service_role;

-- 3) returned 진입 초기화 + 검수 없는 완료 차단
CREATE OR REPLACE FUNCTION public.rental_inspection_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
    NEW.inspection_status := CASE WHEN NEW.has_prior_issue THEN 'issue' ELSE 'pending' END;
  END IF;
  IF NEW.status = 'completed' AND OLD.status = 'returned'
     AND COALESCE(NEW.inspection_status, '') NOT IN ('pass', 'resolved') THEN
    RAISE EXCEPTION 'INSPECTION_REQUIRED: 반납 검수 승인 없이는 완료 처리할 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_inspection_status ON public.rental_reservations;
CREATE TRIGGER trg_rental_inspection_status
  BEFORE UPDATE OF status ON public.rental_reservations
  FOR EACH ROW EXECUTE FUNCTION public.rental_inspection_status_guard();

-- 4) 같은 주문의 returned 형제 예약 id (요청 예약 포함). 주문에 묶이지 않은 예약은 자기 자신만.
CREATE OR REPLACE FUNCTION public.inspection_target_ids(p_reservation_id bigint)
RETURNS bigint[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT r.id ORDER BY r.id), ARRAY[]::bigint[])
    FROM rental_reservations r
   WHERE r.status = 'returned'
     AND (r.id = p_reservation_id
          OR r.id IN (SELECT oi2.reservation_id FROM order_items oi2
                       WHERE oi2.order_id = (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1)));
$$;

-- 5) 반납 검수 승인 — 이슈가 없는 건만. 승인(pass) 기록 후 completed 로 전환한다.
CREATE OR REPLACE FUNCTION public.approve_return_inspection(p_reservation_id bigint, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_insp   text;
  v_ids    bigint[];
  v_id     bigint;
  v_res    jsonb;
BEGIN
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납완료 상태에서만 검수 승인을 할 수 있습니다.');
  END IF;
  IF COALESCE(v_insp, 'pending') = 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 건이에요. 이슈를 처리한 뒤 완료할 수 있습니다.');
  END IF;

  v_ids := public.inspection_target_ids(p_reservation_id);
  FOREACH v_id IN ARRAY v_ids LOOP
    -- 이슈가 있는 형제는 건드리지 않는다(요청 예약은 위에서 이슈 아님을 확인)
    UPDATE rental_reservations
       SET inspection_status = 'pass', inspected_at = now(), inspected_by = p_admin_id
     WHERE id = v_id AND COALESCE(inspection_status, 'pending') <> 'issue';
    IF FOUND THEN
      v_res := public.update_reservation_status(v_id, 'completed');
      IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
        RAISE EXCEPTION '%', COALESCE(v_res->>'error', '완료 처리에 실패했습니다.');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'completed_ids', to_jsonb(v_ids));
END;
$$;

-- 6) 검수 이슈 등록 — returned 상태의 예약(+ 같은 주문 returned 형제)을 'issue' 로 두고 이슈를 기록한다.
CREATE OR REPLACE FUNCTION public.register_return_inspection_issue(
  p_reservation_id bigint, p_admin_id uuid, p_types text[], p_detail text, p_media jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_insp   text;
  v_issue  bigint;
BEGIN
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이슈 항목을 1개 이상 선택해 주세요.');
  END IF;
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' THEN
    RETURN jsonb_build_object('ok', false, 'error', '반납완료 상태에서만 검수 이슈를 등록할 수 있습니다.');
  END IF;

  UPDATE rental_reservations
     SET inspection_status = 'issue', inspected_at = now(), inspected_by = p_admin_id
   WHERE id = ANY(public.inspection_target_ids(p_reservation_id));

  INSERT INTO reservation_inspection_issues (reservation_id, issue_types, detail, media, assigned_admin, created_by)
  VALUES (p_reservation_id, p_types, NULLIF(btrim(COALESCE(p_detail, '')), ''), COALESCE(p_media, '[]'::jsonb), p_admin_id, p_admin_id)
  RETURNING id INTO v_issue;

  RETURN jsonb_build_object('ok', true, 'issue_id', v_issue, 'first', COALESCE(v_insp, 'pending') <> 'issue');
END;
$$;

-- 7) 이슈 해소(추가청구·협의 완료) — 'issue' 건을 resolved 로 마감하고 completed 로 전환한다.
CREATE OR REPLACE FUNCTION public.resolve_return_inspection_issue(p_reservation_id bigint, p_admin_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_insp   text;
  v_ids    bigint[];
  v_id     bigint;
  v_res    jsonb;
BEGIN
  SELECT status, inspection_status INTO v_status, v_insp
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.'); END IF;
  IF v_status <> 'returned' OR COALESCE(v_insp, 'pending') <> 'issue' THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 반납완료 건만 해소할 수 있습니다.');
  END IF;

  UPDATE reservation_inspection_issues
     SET resolved_at = now(), resolved_by = p_admin_id, resolution_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE reservation_id = p_reservation_id AND resolved_at IS NULL;

  v_ids := public.inspection_target_ids(p_reservation_id);
  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE rental_reservations
       SET inspection_status = 'resolved', inspected_at = now(), inspected_by = p_admin_id
     WHERE id = v_id AND inspection_status = 'issue';
    IF FOUND THEN
      v_res := public.update_reservation_status(v_id, 'completed');
      IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
        RAISE EXCEPTION '%', COALESCE(v_res->>'error', '완료 처리에 실패했습니다.');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.inspection_target_ids(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_return_inspection(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspection_target_ids(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_return_inspection(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_return_inspection_issue(bigint, uuid, text[], text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_return_inspection_issue(bigint, uuid, text) TO service_role;

-- 8) get_rental_list: p_inspection_scope('pending'|'issue') — 라이브 정의의 앵커 줄만 치환한다(시그니처가 바뀌어 DROP 후 재생성, 권한 재설정).
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('inspection-724' in v_def) > 0 THEN
    RAISE NOTICE '#724 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  -- ① 시그니처
  v_cnt := (length(v_new) - length(replace(v_new, 'p_cancel_payment_scope text DEFAULT NULL::text)', ''))) / length('p_cancel_payment_scope text DEFAULT NULL::text)');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#724 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, 'p_cancel_payment_scope text DEFAULT NULL::text)', 'p_cancel_payment_scope text DEFAULT NULL::text, p_inspection_scope text DEFAULT NULL::text)');

  -- ② 묶음 모드 base: 검수 상태 컬럼
  v_cnt := (SELECT count(*) FROM regexp_matches(v_new, 'rr\.status\s+AS b_own_status,', 'g'));
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#724 patch2 mismatch (%)', v_cnt; END IF;
  v_new := regexp_replace(v_new, '(rr\.status\s+AS b_own_status,)', E'\\1\n        rr.inspection_status                        AS b_insp, -- inspection-724');

  -- ③ 묶음 모드 g: 주문 내 이슈 여부
  v_cnt := (SELECT count(*) FROM regexp_matches(v_new, 'MAX\(base\.b_payment_confirmed_at\) OVER \(PARTITION BY base\.gk\) AS g_paid_at', 'g'));
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#724 patch3 mismatch (%)', v_cnt; END IF;
  v_new := regexp_replace(v_new, '(MAX\(base\.b_payment_confirmed_at\) OVER \(PARTITION BY base\.gk\) AS g_paid_at)',
    E'\\1,\n        BOOL_OR(COALESCE(base.b_insp, ''pending'') = ''issue'') OVER (PARTITION BY base.gk) AS g_insp_issue');

  -- ④ 단건 모드 WHERE
  v_cnt := (length(v_new) - length(replace(v_new, E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (rr.payment_confirmed_at IS NOT NULL))\n', ''))) / length(E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (rr.payment_confirmed_at IS NOT NULL))\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#724 patch4 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (rr.payment_confirmed_at IS NOT NULL))\n',
    E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (rr.payment_confirmed_at IS NOT NULL))\n      AND (p_inspection_scope IS NULL OR (rr.status = ''returned'' AND (p_inspection_scope = ''issue'') = (COALESCE(rr.inspection_status, ''pending'') = ''issue''))) -- inspection-724\n');

  -- ⑤ 묶음 모드 최종 WHERE
  v_cnt := (length(v_new) - length(replace(v_new, E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (g.g_paid_at IS NOT NULL))\n', ''))) / length(E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (g.g_paid_at IS NOT NULL))\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#724 patch5 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (g.g_paid_at IS NOT NULL))\n',
    E'AND (p_cancel_payment_scope IS NULL OR (p_cancel_payment_scope = ''paid'') = (g.g_paid_at IS NOT NULL))\n      AND (p_inspection_scope IS NULL OR (g.g_status = ''returned'' AND (p_inspection_scope = ''issue'') = g.g_insp_issue)) -- inspection-724\n');

  DROP FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text);
  EXECUTE v_new;
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text) TO service_role;
END
$patch$;

-- 9) CMS 푸시알림 설정에 검수 결과 알림 2종 등록(켜짐 기본, 기존 행 미변경)
INSERT INTO push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'inspection_pass',  '검수 통과(대여 완료 안내)', true),
  ('customer_lifecycle', 'inspection_issue', '검수 이슈 안내',           true)
ON CONFLICT (notify_type) DO NOTHING;
