-- 841: 코드조합 카테고리 이동(결합·분리) — CMS /cms/codes 코드조합 탭
--
-- 목적: 이미 만들어진 코드조합(code_mapping_items 의 combo_row_id 묶음)을 다른 카테고리 그룹으로 옮기거나 그룹을 통째로 합친다.
-- 원칙(구조 유지): 코드품번(product_code·code_series)·조합 구성 코드·조합 설정값은 일절 바꾸지 않는다.
--   바뀌는 것은 ① 조합 행의 group_id ② (두 그룹의 카테고리 키가 다를 때) 해당 상품의 products.category 두 가지뿐.
-- 상품 판정: 조합 코드 문자열(대→중→소 순서 합산 대문자 — TS buildComboCategoryCode 와 같은 규칙)이
--   부모 상품의 code_series.category_code 와 같고, 상품의 category 가 출발 그룹 키일 때만 그 부모 + (출발 키를 가진) 자식.
-- 서버(service_role) 전용 — RLS 켜고 정책 0건, anon·authenticated·PUBLIC 권한 없음.
-- 이중 구현 주의: private.combo_category_code ↔ src/lib/utils/comboCategoryCode.ts buildComboCategoryCode — 함께 바꾼다.

CREATE SCHEMA IF NOT EXISTS private;

-- ── 이동 기록(추가 전용) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.code_group_move_log (
  id            bigserial PRIMARY KEY,
  batch_id      uuid        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('move', 'undo')),
  undo_of       uuid,
  combo_row_id  uuid,
  from_group_id uuid        NOT NULL,
  to_group_id   uuid        NOT NULL,
  from_category text,
  to_category   text,
  product_id    uuid,
  actor_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_code_group_move_log_batch ON public.code_group_move_log (batch_id);
CREATE INDEX IF NOT EXISTS idx_code_group_move_log_undo_of ON public.code_group_move_log (undo_of) WHERE undo_of IS NOT NULL;

ALTER TABLE public.code_group_move_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_group_move_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.code_group_move_log TO service_role;
REVOKE ALL ON SEQUENCE public.code_group_move_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.code_group_move_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION private.code_group_move_log_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'code_group_move_log 는 추가 전용입니다 (UPDATE·DELETE·TRUNCATE 불가)';
END $$;
REVOKE ALL ON FUNCTION private.code_group_move_log_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_code_group_move_log_row ON public.code_group_move_log;
CREATE TRIGGER trg_code_group_move_log_row
  BEFORE UPDATE OR DELETE ON public.code_group_move_log
  FOR EACH ROW EXECUTE FUNCTION private.code_group_move_log_guard();
DROP TRIGGER IF EXISTS trg_code_group_move_log_trunc ON public.code_group_move_log;
CREATE TRIGGER trg_code_group_move_log_trunc
  BEFORE TRUNCATE ON public.code_group_move_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.code_group_move_log_guard();

-- ── 조합 코드 문자열 (TS buildComboCategoryCode 와 같은 규칙) ──────────
CREATE OR REPLACE FUNCTION private.combo_category_code(p_combo uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT upper(coalesce(string_agg(t.code, '' ORDER BY
           CASE coalesce(t.code_tier::text,
                         CASE coalesce(t.depth, 0) WHEN 0 THEN 'major' WHEN 1 THEN 'middle' ELSE 'minor' END)
             WHEN 'major' THEN 0 WHEN 'middle' THEN 1 ELSE 2 END,
           i.sort_order, i.created_at), ''))
  FROM public.code_mapping_items i
  JOIN public.product_category_codes t ON t.id = i.taxonomy_code_id
  WHERE i.combo_row_id = p_combo
$$;
REVOKE ALL ON FUNCTION private.combo_category_code(uuid) FROM PUBLIC, anon, authenticated;

-- ── 실제 이동 (미리보기·실행 공용 본문) ────────────────────────────────
-- p_moves: [{combo_row_id, from_group_id, to_group_id}, ...]
CREATE OR REPLACE FUNCTION private.move_group_combos_impl(p_moves jsonb, p_actor uuid, p_include_rest boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, private AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  m jsonb;
  v_combo uuid; v_from uuid; v_to uuid;
  v_from_key text; v_to_key text;
  v_from_partner boolean; v_to_partner boolean;
  v_cc text;
  v_parents uuid[]; v_children uuid[]; v_rest uuid[]; v_tos uuid[];
  v_n_combos int := 0; v_n_parents int := 0; v_n_children int := 0; v_n_rest int := 0;
  v_detail jsonb := '[]'::jsonb;
  v_rest_detail jsonb := '[]'::jsonb;
  v_first_combo uuid;
  v_shared_code boolean;
BEGIN
  IF p_moves IS NULL OR jsonb_typeof(p_moves) <> 'array' OR jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'NO_MOVES';
  END IF;
  IF jsonb_array_length(p_moves) > 200 THEN
    RAISE EXCEPTION 'TOO_MANY_MOVES';
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_moves) LOOP
    v_combo := (m->>'combo_row_id')::uuid;
    v_from  := (m->>'from_group_id')::uuid;
    v_to    := (m->>'to_group_id')::uuid;

    IF v_from = v_to THEN RAISE EXCEPTION 'SAME_GROUP'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.code_mapping_items WHERE combo_row_id = v_combo AND group_id = v_from) THEN
      RAISE EXCEPTION 'COMBO_NOT_IN_GROUP';
    END IF;

    SELECT default_category, is_partner_type INTO v_from_key, v_from_partner FROM public.code_mapping_groups WHERE id = v_from;
    IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
    SELECT default_category, is_partner_type INTO v_to_key, v_to_partner FROM public.code_mapping_groups WHERE id = v_to;
    IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
    IF v_from_partner IS DISTINCT FROM v_to_partner THEN RAISE EXCEPTION 'PARTNER_TYPE_MISMATCH'; END IF;

    v_cc := private.combo_category_code(v_combo);

    -- 도착 그룹에 같은 코드 집합 조합이 이미 있으면 거절(중복 조합 방지)
    IF v_cc <> '' AND EXISTS (
      SELECT 1 FROM (SELECT DISTINCT combo_row_id FROM public.code_mapping_items
                      WHERE group_id = v_to AND combo_row_id <> v_combo) x
       WHERE private.combo_category_code(x.combo_row_id) = v_cc
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_COMBO';
    END IF;

    UPDATE public.code_mapping_items SET group_id = v_to WHERE combo_row_id = v_combo AND group_id = v_from;
    v_n_combos := v_n_combos + 1;

    -- 출발 그룹에 같은 코드 문자열의 다른 조합이 남아 있으면 상품이 어느 조합 소속인지 가를 수 없으므로 상품은 옮기지 않는다(조합만 이동)
    v_shared_code := v_cc <> '' AND EXISTS (
      SELECT 1 FROM (SELECT DISTINCT combo_row_id FROM public.code_mapping_items
                      WHERE group_id = v_from AND combo_row_id <> v_combo) y
       WHERE private.combo_category_code(y.combo_row_id) = v_cc
    );

    v_parents := '{}'; v_children := '{}';
    IF NOT v_shared_code AND v_from_key IS DISTINCT FROM v_to_key AND v_cc <> '' THEN
      SELECT coalesce(array_agg(id), '{}') INTO v_parents
        FROM public.products
       WHERE deleted_at IS NULL AND parent_product_id IS NULL
         AND category = v_from_key
         AND upper(code_series->>'category_code') = v_cc;
      IF cardinality(v_parents) > 0 AND v_to_key IS NULL THEN RAISE EXCEPTION 'CATEGORY_KEY_MISSING'; END IF;
      IF cardinality(v_parents) > 0 THEN
        SELECT coalesce(array_agg(id), '{}') INTO v_children
          FROM public.products
         WHERE deleted_at IS NULL AND parent_product_id = ANY(v_parents) AND category = v_from_key;
        UPDATE public.products SET category = v_to_key WHERE id = ANY(v_parents || v_children);
      END IF;
    END IF;

    INSERT INTO public.code_group_move_log (batch_id, kind, combo_row_id, from_group_id, to_group_id, from_category, to_category, product_id, actor_id)
    VALUES (v_batch, 'move', v_combo, v_from, v_to, v_from_key, v_to_key, NULL, p_actor);
    IF cardinality(v_parents || v_children) > 0 THEN
      INSERT INTO public.code_group_move_log (batch_id, kind, combo_row_id, from_group_id, to_group_id, from_category, to_category, product_id, actor_id)
      SELECT v_batch, 'move', v_combo, v_from, v_to, v_from_key, v_to_key, pid, p_actor
        FROM unnest(v_parents || v_children) AS pid;
    END IF;

    v_n_parents  := v_n_parents  + cardinality(v_parents);
    v_n_children := v_n_children + cardinality(v_children);
    v_detail := v_detail || jsonb_build_object(
      'combo_row_id', v_combo, 'code', v_cc, 'from_group_id', v_from, 'to_group_id', v_to,
      'parents', cardinality(v_parents), 'children', cardinality(v_children), 'shared_code', v_shared_code);
  END LOOP;

  -- 통째 결합: 출발 그룹에 조합이 하나도 안 남을 때만, 조합에 안 맞아 남은 상품도 함께 옮긴다
  IF p_include_rest THEN
    FOR v_from IN SELECT DISTINCT (e->>'from_group_id')::uuid FROM jsonb_array_elements(p_moves) e LOOP
      IF EXISTS (SELECT 1 FROM public.code_mapping_items WHERE group_id = v_from) THEN CONTINUE; END IF;

      SELECT array_agg(DISTINCT (e->>'to_group_id')::uuid) INTO v_tos
        FROM jsonb_array_elements(p_moves) e WHERE (e->>'from_group_id')::uuid = v_from;
      IF cardinality(v_tos) <> 1 THEN RAISE EXCEPTION 'REST_TARGET_AMBIGUOUS'; END IF;
      v_to := v_tos[1];

      SELECT default_category INTO v_from_key FROM public.code_mapping_groups WHERE id = v_from;
      SELECT default_category INTO v_to_key   FROM public.code_mapping_groups WHERE id = v_to;
      IF v_from_key IS NULL OR v_from_key IS NOT DISTINCT FROM v_to_key THEN CONTINUE; END IF;

      -- 같은 키를 쓰는 다른 그룹이 있으면 그 그룹 상품까지 끌려가므로 옮기지 않는다
      IF EXISTS (SELECT 1 FROM public.code_mapping_groups WHERE id <> v_from AND default_category = v_from_key) THEN
        v_rest_detail := v_rest_detail || jsonb_build_object('from_group_id', v_from, 'skipped', 'SHARED_KEY');
        CONTINUE;
      END IF;
      IF v_to_key IS NULL THEN RAISE EXCEPTION 'CATEGORY_KEY_MISSING'; END IF;

      SELECT coalesce(array_agg(id), '{}') INTO v_rest
        FROM public.products WHERE deleted_at IS NULL AND category = v_from_key;
      IF cardinality(v_rest) > 0 THEN
        UPDATE public.products SET category = v_to_key WHERE id = ANY(v_rest);
        SELECT (e->>'combo_row_id')::uuid INTO v_first_combo
          FROM jsonb_array_elements(p_moves) e WHERE (e->>'from_group_id')::uuid = v_from LIMIT 1;
        INSERT INTO public.code_group_move_log (batch_id, kind, combo_row_id, from_group_id, to_group_id, from_category, to_category, product_id, actor_id)
        SELECT v_batch, 'move', v_first_combo, v_from, v_to, v_from_key, v_to_key, pid, p_actor FROM unnest(v_rest) AS pid;
      END IF;
      v_n_rest := v_n_rest + cardinality(v_rest);
      v_rest_detail := v_rest_detail || jsonb_build_object('from_group_id', v_from, 'to_group_id', v_to, 'products', cardinality(v_rest));
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch, 'combos', v_n_combos, 'parents', v_n_parents, 'children', v_n_children,
    'rest', v_n_rest, 'detail', v_detail, 'rest_detail', v_rest_detail);
END $$;
REVOKE ALL ON FUNCTION private.move_group_combos_impl(jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ── 공개 진입점 (service_role 전용) ────────────────────────────────────
-- p_dry_run = true 이면 같은 본문을 실행한 뒤 롤백해 건수만 돌려준다(미리보기).
CREATE OR REPLACE FUNCTION public.cms_move_group_combos(
  p_moves jsonb, p_actor uuid, p_include_rest boolean DEFAULT false, p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_dry_run THEN
    BEGIN
      v_result := private.move_group_combos_impl(p_moves, p_actor, p_include_rest);
      RAISE EXCEPTION 'dry_run_rollback';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'dry_run_rollback' THEN RAISE; END IF;
      RETURN v_result || jsonb_build_object('dry_run', true);
    END;
  END IF;
  RETURN private.move_group_combos_impl(p_moves, p_actor, p_include_rest);
END $$;

-- ── 되돌리기 ──────────────────────────────────────────────────────────
-- 조합은 아직 도착 그룹에 있을 때만, 상품은 아직 도착 키일 때만 되돌린다(그 사이 바뀐 것은 건너뛰고 건수로 보고).
CREATE OR REPLACE FUNCTION public.cms_undo_group_move(p_batch uuid, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE
  v_undo uuid := gen_random_uuid();
  r record;
  n int;
  v_combos_back int := 0; v_combos_skipped int := 0;
  v_products_back int := 0; v_products_total int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.code_group_move_log WHERE batch_id = p_batch AND kind = 'move') THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.code_group_move_log WHERE kind = 'undo' AND undo_of = p_batch) THEN
    RAISE EXCEPTION 'ALREADY_UNDONE';
  END IF;

  FOR r IN
    SELECT combo_row_id, from_group_id, to_group_id, from_category, to_category
      FROM public.code_group_move_log
     WHERE batch_id = p_batch AND kind = 'move' AND product_id IS NULL AND combo_row_id IS NOT NULL
     ORDER BY id DESC
  LOOP
    UPDATE public.code_mapping_items SET group_id = r.from_group_id
     WHERE combo_row_id = r.combo_row_id AND group_id = r.to_group_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      v_combos_back := v_combos_back + 1;
      INSERT INTO public.code_group_move_log (batch_id, kind, undo_of, combo_row_id, from_group_id, to_group_id, from_category, to_category, product_id, actor_id)
      VALUES (v_undo, 'undo', p_batch, r.combo_row_id, r.to_group_id, r.from_group_id, r.to_category, r.from_category, NULL, p_actor);
    ELSE
      v_combos_skipped := v_combos_skipped + 1;
    END IF;
  END LOOP;

  SELECT count(DISTINCT product_id) INTO v_products_total
    FROM public.code_group_move_log WHERE batch_id = p_batch AND kind = 'move' AND product_id IS NOT NULL;

  WITH upd AS (
    UPDATE public.products p SET category = l.from_category
      FROM public.code_group_move_log l
     WHERE l.batch_id = p_batch AND l.kind = 'move' AND l.product_id = p.id
       AND p.category IS NOT DISTINCT FROM l.to_category
    RETURNING p.id AS pid, l.combo_row_id, l.from_group_id, l.to_group_id, l.from_category, l.to_category
  ), ins AS (
    INSERT INTO public.code_group_move_log (batch_id, kind, undo_of, combo_row_id, from_group_id, to_group_id, from_category, to_category, product_id, actor_id)
    SELECT v_undo, 'undo', p_batch, combo_row_id, to_group_id, from_group_id, to_category, from_category, pid, p_actor FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO v_products_back FROM ins;

  RETURN jsonb_build_object(
    'batch_id', v_undo, 'combos_back', v_combos_back, 'combos_skipped', v_combos_skipped,
    'products_back', v_products_back, 'products_skipped', greatest(v_products_total - v_products_back, 0));
END $$;

REVOKE ALL ON FUNCTION public.cms_move_group_combos(jsonb, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_undo_group_move(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_move_group_combos(jsonb, uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_undo_group_move(uuid, uuid) TO service_role;
