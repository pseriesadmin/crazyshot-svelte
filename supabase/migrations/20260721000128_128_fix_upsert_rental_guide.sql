-- Migration #128: upsert_rental_guide UPDATE WHERE 절 누락 수정
-- 원인: PostgREST는 WHERE 없는 UPDATE를 안전장치로 차단함

CREATE OR REPLACE FUNCTION public.upsert_rental_guide(p_guide_text TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF length(p_guide_text) > 1000 THEN
    RAISE EXCEPTION 'guide_text exceeds 1000 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM rental_guide_settings LIMIT 1) THEN
    UPDATE rental_guide_settings
    SET guide_text = p_guide_text
    WHERE id IS NOT NULL;
  ELSE
    INSERT INTO rental_guide_settings (guide_text) VALUES (p_guide_text);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_guide(TEXT) TO authenticated;

-- ROLLBACK (수동 실행):
-- CREATE OR REPLACE FUNCTION public.upsert_rental_guide(p_guide_text TEXT)
-- ... (127 파일의 원본 함수로 복원)
