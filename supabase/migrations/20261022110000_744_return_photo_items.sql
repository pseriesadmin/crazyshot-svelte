-- Migration #739: 반납 '사진등록 항목' 마스터(CMS 대여관리 설정) — 택배 반납 고객 반납정보 등록 화면의 사진 카드 목록 (2026-10-22, Stephen 지시)
--
-- 목적: 고객 반납정보 등록(택배) 화면에 나오는 사진 카드(본체·구성품·포장)를 관리자가 추가·편집·삭제·순서변경한다.
--  · item_key: 저장 경로·사진 묶음 키(기존 코드 상수 body·accessories·package 를 그대로 시드해 이미 제출된 사진과 이어진다).
--    새 항목은 'p_' + 영문 8자 — 저장 경로 규칙 [a-z_]{1,20} 에 맞추려고 숫자를 쓰지 않는다.
--  · 삭제는 소프트 삭제(deleted_at) — 이미 제출된 사진 묶음의 이름을 계속 풀어 볼 수 있어야 한다.
--  · label 1~50자, 활성 항목 최대 10개. 서버 전용 테이블(RLS 켬·정책 0건·service_role 만 권한, 2026-10-30 신규 테이블 권한 규칙).
--  · 무인함 반납의 사진 항목(무인함·장비)은 고정이라 이 마스터 대상이 아니다.
--
-- ROLLBACK: DROP FUNCTION public.cms_upsert_return_photo_item(uuid, text);
--           DROP FUNCTION public.cms_delete_return_photo_item(uuid);
--           DROP FUNCTION public.cms_reorder_return_photo_items(uuid[]);
--           DROP TABLE public.return_photo_items;

CREATE TABLE IF NOT EXISTS public.return_photo_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key      text        NOT NULL UNIQUE CHECK (item_key ~ '^[a-z_]{1,20}$'),
  label         text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 50),
  display_order integer     NOT NULL DEFAULT 0,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.return_photo_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.return_photo_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_photo_items TO service_role;

INSERT INTO public.return_photo_items (item_key, label, display_order) VALUES
  ('body',        '본체 사진',      1),
  ('accessories', '구성품 사진',    2),
  ('package',     '포장 상태 사진', 3)
ON CONFLICT (item_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cms_upsert_return_photo_item(p_id uuid, p_label text)
RETURNS jsonb
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
  IF v_label IS NOT NULL AND char_length(v_label) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'label_too_long');
  END IF;

  IF p_id IS NULL THEN
    IF v_label IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'label_required');
    END IF;
    SELECT count(*), COALESCE(max(display_order), 0) + 1
      INTO v_active_count, v_next_order
      FROM return_photo_items WHERE deleted_at IS NULL;
    IF v_active_count >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
    END IF;
    INSERT INTO return_photo_items (item_key, label, display_order)
    VALUES ('p_' || substr(translate(md5(gen_random_uuid()::text), '0123456789', 'ghijklmnop'), 1, 8), v_label, v_next_order)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id);
  END IF;

  IF v_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'label_required');
  END IF;
  UPDATE return_photo_items SET label = v_label, updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cms_delete_return_photo_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE return_photo_items SET deleted_at = now(), updated_at = now()
   WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cms_reorder_return_photo_items(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ids_required');
  END IF;
  UPDATE return_photo_items t
     SET display_order = o.ord, updated_at = now()
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE t.id = o.id AND t.deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_upsert_return_photo_item(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_delete_return_photo_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_reorder_return_photo_items(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_upsert_return_photo_item(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_delete_return_photo_item(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_reorder_return_photo_items(uuid[]) TO service_role;
