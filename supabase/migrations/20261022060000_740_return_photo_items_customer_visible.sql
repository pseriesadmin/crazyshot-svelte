-- Migration #740: 사진등록 항목에도 '고객검수'(고객 반납정보 등록 화면 노출 여부) 지정 (2026-10-22, Stephen 지시)
-- #739 의 사진등록 항목 마스터에 customer_visible 컬럼을 추가하고 추가·수정 RPC 를 3인자로 교체한다(기존 항목은 모두 노출 = 동작 불변).
-- ROLLBACK: DROP FUNCTION public.cms_upsert_return_photo_item(uuid, text, boolean); (이전 2인자 함수는 #739 본문으로 복원) ALTER TABLE public.return_photo_items DROP COLUMN customer_visible;

ALTER TABLE public.return_photo_items ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS public.cms_upsert_return_photo_item(uuid, text);

CREATE OR REPLACE FUNCTION public.cms_upsert_return_photo_item(
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
    INSERT INTO return_photo_items (item_key, label, customer_visible, display_order)
    VALUES ('p_' || substr(translate(md5(gen_random_uuid()::text), '0123456789', 'ghijklmnop'), 1, 8), v_label, COALESCE(p_customer_visible, true), v_next_order)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id);
  END IF;

  UPDATE return_photo_items
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

REVOKE ALL ON FUNCTION public.cms_upsert_return_photo_item(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_upsert_return_photo_item(uuid, text, boolean) TO service_role;
