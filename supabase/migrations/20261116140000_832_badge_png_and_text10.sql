-- #832 배지타입 — 원형 이미지 타입에 PNG 등록 허용(SVG 추천) + 텍스트바 문구 최대 10자
-- 적용 순서: Stage(ezyvffjvuwmtuhpxdjrw) → Production(vnbpmvxruyciuuaermyh). 코드보다 먼저 적용한다(코드가 PNG 업로드·10자 입력을 열기 때문).
-- 롤백: 이 파일의 정의를 #828 의 원래 값(문구 1~8자·SVG 만)으로 되돌린다 — 이미 10자 문구나 PNG 이미지로 저장된 배지타입이 있으면 먼저 정리한다.
--
-- 규칙: 이미지 주소는 배지 전용 버킷에 업로드 API 가 저장한 파일(.svg 또는 .png)만 허용(TS isBadgeSvgUrl 과 같은 규칙).
--       PNG 는 서버가 파일 머리(시그니처·IHDR)와 크기를 확인한 뒤에만 저장한다. 버킷 크기 한도(200KB)는 그대로.

-- 1) 버킷 — PNG 허용
UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/svg+xml', 'image/png'] WHERE id = 'badge-icons';

-- 2) 텍스트바 문구 1~10자
ALTER TABLE public.badge_templates DROP CONSTRAINT IF EXISTS badge_templates_text_check;
ALTER TABLE public.badge_templates ADD CONSTRAINT badge_templates_text_check CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 10);

-- 3) 저장 함수 — 이미지 주소 .svg|.png, 문구 1~10자
-- public-callable: cms_save_badge_template — CMS 직원이 세션으로 호출, 함수 안에서 매니저 이상 확인
CREATE OR REPLACE FUNCTION public.cms_save_badge_template(
  p_id         uuid,
  p_kind       text,
  p_name       text,
  p_svg_url    text,
  p_text       text,
  p_bg_color   text,
  p_text_color text DEFAULT '#FFFFFF',
  p_is_active  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_cms_user() OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND cms_role IN ('manager', 'superadmin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_DENIED');
  END IF;

  IF p_kind NOT IN ('image', 'textbar') THEN
    RETURN jsonb_build_object('ok', false, 'error', '배지 형태가 올바르지 않아요');
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', '이름은 1~40자로 입력해 주세요');
  END IF;
  IF p_kind = 'image' AND (p_svg_url IS NULL OR btrim(p_svg_url) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미지를 가져와 주세요');
  END IF;
  -- 배지 전용 버킷에 업로드 API 가 저장한 파일 주소만 허용(외부 주소 삽입 차단 — TS isBadgeSvgUrl 과 같은 규칙)
  IF p_kind = 'image' AND btrim(p_svg_url) !~ '^https://(ezyvffjvuwmtuhpxdjrw|vnbpmvxruyciuuaermyh)\.supabase\.co/storage/v1/object/public/badge-icons/badges/[0-9a-f-]{36}\.(svg|png)$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미지는 가져오기로만 등록할 수 있어요');
  END IF;
  IF p_kind = 'textbar' THEN
    IF p_text IS NULL OR char_length(btrim(p_text)) NOT BETWEEN 1 AND 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', '문구는 1~10자로 입력해 주세요');
    END IF;
    IF p_bg_color IS NULL OR p_bg_color !~ '^#[0-9A-Fa-f]{6}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', '바 색상은 #RRGGBB 형식이어야 해요');
    END IF;
  END IF;
  IF p_text_color IS NULL OR p_text_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '글자 색상은 #RRGGBB 형식이어야 해요');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO badge_templates (kind, name, svg_url, text, bg_color, text_color, is_active, sort_order)
    VALUES (
      p_kind, btrim(p_name),
      CASE WHEN p_kind = 'image' THEN btrim(p_svg_url) END,
      CASE WHEN p_kind = 'textbar' THEN btrim(p_text) END,
      CASE WHEN p_kind = 'textbar' THEN p_bg_color END,
      p_text_color, COALESCE(p_is_active, true),
      COALESCE((SELECT max(sort_order) + 1 FROM badge_templates WHERE deleted_at IS NULL), 0)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE badge_templates SET
      kind = p_kind,
      name = btrim(p_name),
      svg_url = CASE WHEN p_kind = 'image' THEN btrim(p_svg_url) END,
      text = CASE WHEN p_kind = 'textbar' THEN btrim(p_text) END,
      bg_color = CASE WHEN p_kind = 'textbar' THEN p_bg_color END,
      text_color = p_text_color,
      is_active = COALESCE(p_is_active, true),
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.cms_save_badge_template(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_save_badge_template(uuid, text, text, text, text, text, text, boolean) TO authenticated, service_role;
