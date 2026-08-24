-- Migration 332: CMS 백오피스 전역 정밀검증 v3 STAGE 6에서 발견된 서명·직인 기본값 지정
-- 비원자적 UPDATE 결함 수정
--
-- 배경: /cms/set/signature setDefault 액션이 "기존 기본값 해제" + "신규 기본값 지정" 2개의
-- 독립 UPDATE를 트랜잭션 없이 순차 실행하고, 두 UPDATE의 에러도 전혀 확인하지 않았다(silent
-- fail). 첫 UPDATE 성공 후 두 번째가 실패하면 그 admin_id·asset_type 조합에 기본값이 하나도
--없는 상태로 남을 수 있다. 단일 RPC(SECURITY DEFINER, is_cms_user() 게이트)로 묶어 원자성을
-- 보장하고 에러를 호출부에 반환한다.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

CREATE OR REPLACE FUNCTION public.cms_set_default_signature_asset(
  p_asset_id   UUID,
  p_asset_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cms_signature_assets
    WHERE id = p_asset_id AND admin_id = auth.uid() AND asset_type = p_asset_type
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '자산을 찾을 수 없습니다.');
  END IF;

  UPDATE public.cms_signature_assets
  SET is_default = FALSE
  WHERE admin_id = auth.uid() AND asset_type = p_asset_type;

  UPDATE public.cms_signature_assets
  SET is_default = TRUE
  WHERE id = p_asset_id AND admin_id = auth.uid();

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- ROLLBACK: DROP FUNCTION IF EXISTS public.cms_set_default_signature_asset(UUID, TEXT);
-- ============================================================
