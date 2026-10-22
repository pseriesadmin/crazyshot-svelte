-- Migration #738: 반납 검수 항목 등록(CMS 대여관리 설정) — 반납 필수 체크리스트 마스터 (2026-10-22, Stephen 지시)
--
-- 목적: 대여현황 패널 '검수' 탭과 고객 반납 등록 화면에서 쓸 "반납 필수 체크리스트"를 관리자가 추가·편집·삭제하고,
--   항목마다 '고객검수'(고객 반납 등록 화면 노출 여부)를 지정한다. 이번 단계는 마스터 데이터와 CMS 편집 화면까지이며,
--   고객 반납 화면·검수 탭이 이 테이블을 읽도록 바꾸는 것은 후속 단계다(지금은 코드 상수 RETURN_CHECKLIST_ITEMS 그대로 동작 — 동작 변경 없음).
--
-- 설계:
--  · item_key: 저장값(고객이 제출한 체크리스트에 들어가는 키). 기존 코드 상수 4종(body·accessories·packed·clean)을 그대로 시드해
--    이미 제출된 체크리스트와 키가 이어진다. 새 항목은 'i_' + 난수 8자.
--  · 삭제는 소프트 삭제(deleted_at) — 이미 제출된 체크리스트의 키·문구를 계속 풀어 볼 수 있어야 한다.
--  · label 1~100자(화면 안내와 동일), 활성 항목 최대 20개(서버 집행).
--  · 서버 전용 테이블: RLS 켬·정책 0건·service_role만 권한(2026-10-30 신규 테이블 권한 규칙, security-auth.md). 변경은 서버 전용 RPC만.
--
-- ROLLBACK: DROP FUNCTION public.cms_upsert_return_inspection_item(uuid, text, boolean);
--           DROP FUNCTION public.cms_delete_return_inspection_item(uuid);
--           DROP FUNCTION public.cms_reorder_return_inspection_items(uuid[]);
--           DROP TABLE public.return_inspection_items;

CREATE TABLE IF NOT EXISTS public.return_inspection_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key         text        NOT NULL UNIQUE,
  label            text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  customer_visible boolean     NOT NULL DEFAULT true,
  display_order    integer     NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.return_inspection_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.return_inspection_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_inspection_items TO service_role;

-- 기존 코드 상수(RETURN_CHECKLIST_ITEMS)와 같은 4종 시드 — 키 불변
INSERT INTO public.return_inspection_items (item_key, label, customer_visible, display_order) VALUES
  ('body',        '본체 외관 이상 없음',                    true, 1),
  ('accessories', '구성품(배터리·충전기·케이블 등) 모두 포함', true, 2),
  ('packed',      '완충재로 안전하게 포장함',                 true, 3),
  ('clean',       '렌즈·액정 오염 없음',                     true, 4)
ON CONFLICT (item_key) DO NOTHING;

-- 추가·수정 한 함수: p_id NULL = 추가(라벨 필수, 활성 20개 상한), 값이 있으면 라벨·고객검수 중 넘어온 것만 수정
CREATE OR REPLACE FUNCTION public.cms_upsert_return_inspection_item(
  p_id               uuid,
  p_label            text,
  p_customer_visible boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_active_count integer;
  v_next_order integer;
  v_id uuid;
BEGIN
  IF v_label IS NOT NULL AND char_length(v_label) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'label_too_long');
  END IF;

  IF p_id IS NULL THEN
    IF v_label IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'label_required');
    END IF;
    SELECT count(*), COALESCE(max(display_order), 0) + 1
      INTO v_active_count, v_next_order
      FROM return_inspection_items WHERE deleted_at IS NULL;
    IF v_active_count >= 20 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
    END IF;
    INSERT INTO return_inspection_items (item_key, label, customer_visible, display_order)
    VALUES ('i_' || substr(md5(gen_random_uuid()::text), 1, 8), v_label, COALESCE(p_customer_visible, true), v_next_order)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id);
  END IF;

  UPDATE return_inspection_items
     SET label            = COALESCE(v_label, label),
         customer_visible = COALESCE(p_customer_visible, customer_visible),
         updated_at       = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cms_delete_return_inspection_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE return_inspection_items SET deleted_at = now(), updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cms_reorder_return_inspection_items(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ids_required');
  END IF;
  UPDATE return_inspection_items t
     SET display_order = o.ord, updated_at = now()
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE t.id = o.id AND t.deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_upsert_return_inspection_item(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_delete_return_inspection_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_reorder_return_inspection_items(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_upsert_return_inspection_item(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_delete_return_inspection_item(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_reorder_return_inspection_items(uuid[]) TO service_role;
