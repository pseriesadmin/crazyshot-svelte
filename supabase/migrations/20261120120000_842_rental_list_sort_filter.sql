-- #842 예약대여현황 탭별 정렬·필터 (2026-11-20, Stephen 확정: 문서 '예약대여현황 탭별 정렬·필터 정리 v1')
--   1) rental_reservations.status_changed_at — 현재 상태로 들어온 시각. 상태가 바뀔 때마다 트리거가 now() 로 기록(수동 버튼·QR·두발히어로 자동 전환 모두 포함).
--      과거 건은 완료=검수승인 시각, 신청대기=예약승인 시각, 그 외=액션 로그의 마지막 해당 시각 → 마지막 갱신 시각 순으로 채움.
--   2) 보조 함수(private): 시각 문자열→분, 수령 일시 도래 판정, 방식 순서(크레이지배송 0 → 방문·무인함 1 → 퀵 2 → 기타 3)
--   3) get_rental_list 에 p_sort / p_pickup_filter / p_return_filter / p_payment_stage 추가 — 라이브 정의 앵커 치환(전체 재작성 금지).
--      p_sort NULL = 기존 동작(신청일 최신순) 그대로 → 모바일 CMS 등 기존 호출자 불변.
-- ROLLBACK: get_rental_list 는 이 마이그레이션의 'sort-842' 줄을 제거해 재생성(시그니처 4개 인자 제거), 트리거·함수·컬럼은 데이터 확인 후 제거.

-- 1) 컬럼 + 백필 + 트리거 -----------------------------------------------------------------
ALTER TABLE public.rental_reservations ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

UPDATE public.rental_reservations rr
   SET status_changed_at = COALESCE(
         CASE rr.status WHEN 'completed' THEN rr.inspected_at WHEN 'hold' THEN rr.approved_at END,
         (SELECT max(l.performed_at) FROM public.rental_action_logs l
           WHERE l.reservation_id = rr.id AND l.action_type = rr.status),
         rr.updated_at, rr.created_at, now())
 WHERE rr.status_changed_at IS NULL;

ALTER TABLE public.rental_reservations ALTER COLUMN status_changed_at SET DEFAULT now();
ALTER TABLE public.rental_reservations ALTER COLUMN status_changed_at SET NOT NULL;

CREATE OR REPLACE FUNCTION private.set_rental_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.set_rental_status_changed_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rental_status_changed_at ON public.rental_reservations;
CREATE TRIGGER trg_rental_status_changed_at
  BEFORE UPDATE OF status ON public.rental_reservations
  FOR EACH ROW EXECUTE FUNCTION private.set_rental_status_changed_at();

-- 2) 보조 함수 -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.rental_time_minutes(t text, dflt integer)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE WHEN t ~ '^\s*\d{1,2}:\d{2}'
              THEN substring(t from '^\s*(\d{1,2}):')::int * 60 + substring(t from '^\s*\d{1,2}:(\d{2})')::int
              ELSE dflt END
$fn$;

-- 수령 예정 일시(KST)가 지났는가 — 시각이 없으면 그날이 끝난 뒤(1440분)에만 지연으로 본다.
CREATE OR REPLACE FUNCTION private.rental_pickup_due(d date, t text)
RETURNS boolean LANGUAGE sql STABLE
AS $fn$
  SELECT d IS NOT NULL
     AND (d::timestamp + make_interval(mins => private.rental_time_minutes(t, 1440))) <= (now() AT TIME ZONE 'Asia/Seoul')
$fn$;

CREATE OR REPLACE FUNCTION private.rental_method_rank(m text)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE m WHEN 'crazydelivery' THEN 0 WHEN 'visit' THEN 1 WHEN 'locker' THEN 1 WHEN 'quick' THEN 2 ELSE 3 END
$fn$;

REVOKE ALL ON FUNCTION private.rental_time_minutes(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rental_pickup_due(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rental_method_rank(text) FROM PUBLIC, anon, authenticated;

-- 3) get_rental_list 패치 -------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
  v_order text;
  v_where text;
  v_single_order text;
  v_group_order text;
  v_single_where text;
  v_group_where text;
  v_anchor_s text := E'    ORDER BY rr.submitted_at DESC, rr.id DESC\n';
  v_anchor_g text := E'    ORDER BY g.b_created_at DESC, g.b_rid DESC\n';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_rental_list';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_rental_list not found'; END IF;
  IF position('sort-842' in v_def) > 0 THEN
    RAISE NOTICE '#842 get_rental_list already patched — skip';
    RETURN;
  END IF;
  v_new := v_def;

  -- ① 시그니처
  v_cnt := (length(v_new) - length(replace(v_new, 'p_inspection_scope text DEFAULT NULL::text)', ''))) / length('p_inspection_scope text DEFAULT NULL::text)');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#842 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, 'p_inspection_scope text DEFAULT NULL::text)',
    'p_inspection_scope text DEFAULT NULL::text, p_sort text DEFAULT NULL::text, p_pickup_filter text[] DEFAULT NULL::text[], p_return_filter text[] DEFAULT NULL::text[], p_payment_stage text DEFAULT NULL::text)');

  -- ② 묶음 모드 base: 상태 전환 시각 컬럼
  v_cnt := (length(v_new) - length(replace(v_new, 'AS b_insp, -- inspection-724', ''))) / length('AS b_insp, -- inspection-724');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#842 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, 'AS b_insp, -- inspection-724',
    E'AS b_insp, -- inspection-724\n        rr.status_changed_at                        AS b_changed_at, -- sort-842');

  -- ③ ORDER BY·필터 — 토큰을 단건/묶음 모드 표현으로 치환해 두 곳에 넣는다.
  v_where :=
    E'      AND (p_pickup_filter IS NULL OR {pmethod} = ANY(p_pickup_filter)) -- sort-842\n' ||
    E'      AND (p_return_filter IS NULL OR {rmethod} = ANY(p_return_filter))\n' ||
    E'      AND (p_payment_stage IS NULL OR CASE p_payment_stage WHEN ''unissued'' THEN {sent} IS NULL WHEN ''signed'' THEN ({signed} IS NOT NULL AND {paid} IS NULL) WHEN ''paying'' THEN ({sent} IS NOT NULL AND {signed} IS NULL) ELSE TRUE END)\n';
  v_order :=
    E'    ORDER BY\n' ||
    E'      CASE WHEN p_sort = ''delay_pickup_asc'' THEN CASE WHEN private.rental_pickup_due({start}, {ptime}) THEN 0 ELSE 1 END\n' ||
    E'           WHEN p_sort = ''delay_return_asc'' THEN CASE WHEN private.rental_return_due({end}, {rtime}) THEN 0 ELSE 1 END END ASC,\n' ||
    E'      CASE WHEN p_sort IN (''start_asc'', ''pickup_asc'', ''delay_pickup_asc'') THEN {start}\n' ||
    E'           WHEN p_sort IN (''return_due_asc'', ''delay_return_asc'', ''return_group_asc'') THEN {end} END ASC NULLS LAST,\n' ||
    E'      CASE WHEN p_sort IN (''pickup_asc'', ''delay_pickup_asc'') THEN private.rental_method_rank({pmethod})\n' ||
    E'           WHEN p_sort IN (''delay_return_asc'', ''return_group_asc'') THEN private.rental_method_rank({rmethod}) END ASC,\n' ||
    E'      CASE WHEN p_sort IN (''start_asc'', ''pickup_asc'', ''delay_pickup_asc'') THEN private.rental_time_minutes({ptime}, 1440)\n' ||
    E'           WHEN p_sort IN (''return_due_asc'', ''delay_return_asc'', ''return_group_asc'') THEN private.rental_time_minutes({rtime}, 1080) END ASC,\n' ||
    E'      CASE WHEN p_sort = ''changed_asc'' THEN {chg} END ASC NULLS LAST,\n' ||
    E'      CASE WHEN p_sort = ''changed_desc'' THEN {chg} END DESC NULLS LAST,\n' ||
    E'      CASE WHEN p_sort = ''created_asc'' THEN {created} END ASC,\n' ||
    E'      {created} DESC, {id} DESC\n';

  v_single_where := v_where;
  v_single_where := replace(v_single_where, '{pmethod}', 'rr.pickup_method');
  v_single_where := replace(v_single_where, '{rmethod}', 'rr.return_method');
  v_single_where := replace(v_single_where, '{sent}', 'cs.sent_at');
  v_single_where := replace(v_single_where, '{signed}', 'cs.signed_at');
  v_single_where := replace(v_single_where, '{paid}', 'rr.payment_confirmed_at');

  v_group_where := v_where;
  v_group_where := replace(v_group_where, '{pmethod}', 'g.b_pickup_method');
  v_group_where := replace(v_group_where, '{rmethod}', 'g.b_return_method');
  v_group_where := replace(v_group_where, '{sent}', 'g.b_signing_sent_at');
  v_group_where := replace(v_group_where, '{signed}', 'g.b_customer_signed_at');
  v_group_where := replace(v_group_where, '{paid}', 'g.g_paid_at');

  v_single_order := v_order;
  v_single_order := replace(v_single_order, '{start}', 'rr.start_date');
  v_single_order := replace(v_single_order, '{end}', 'rr.end_date');
  v_single_order := replace(v_single_order, '{ptime}', 'rr.pickup_time');
  v_single_order := replace(v_single_order, '{rtime}', 'rr.return_time');
  v_single_order := replace(v_single_order, '{pmethod}', 'rr.pickup_method');
  v_single_order := replace(v_single_order, '{rmethod}', 'rr.return_method');
  v_single_order := replace(v_single_order, '{chg}', 'CASE WHEN rr.status = ''hold'' THEN COALESCE(rr.approved_at, cs.sent_at, rr.status_changed_at) ELSE rr.status_changed_at END');
  v_single_order := replace(v_single_order, '{created}', 'rr.submitted_at');
  v_single_order := replace(v_single_order, '{id}', 'rr.id');

  v_group_order := v_order;
  v_group_order := replace(v_group_order, '{start}', 'g.b_rental_start');
  v_group_order := replace(v_group_order, '{end}', 'g.b_rental_end');
  v_group_order := replace(v_group_order, '{ptime}', 'g.b_pickup_time');
  v_group_order := replace(v_group_order, '{rtime}', 'g.b_return_time');
  v_group_order := replace(v_group_order, '{pmethod}', 'g.b_pickup_method');
  v_group_order := replace(v_group_order, '{rmethod}', 'g.b_return_method');
  v_group_order := replace(v_group_order, '{chg}', 'CASE WHEN g.g_status = ''hold'' THEN COALESCE(g.b_approved_at, g.b_signing_sent_at, g.b_changed_at) ELSE g.b_changed_at END');
  v_group_order := replace(v_group_order, '{created}', 'g.b_created_at');
  v_group_order := replace(v_group_order, '{id}', 'g.b_rid');

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_s, ''))) / length(v_anchor_s);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#842 patch3 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_s, v_single_where || v_single_order);

  v_cnt := (length(v_new) - length(replace(v_new, v_anchor_g, ''))) / length(v_anchor_g);
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#842 patch4 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, v_anchor_g, v_group_where || v_group_order);

  DROP FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text);
  EXECUTE v_new;
  REVOKE ALL ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.get_rental_list(text, text, date, date, integer, integer, text[], text[], boolean, bigint, boolean, boolean, text, text, text, text[], text[], text) TO service_role;
END
$patch$;
