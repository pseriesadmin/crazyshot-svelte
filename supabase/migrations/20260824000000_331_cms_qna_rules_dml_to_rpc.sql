-- Migration 331: CMS 백오피스 전역 정밀검증 v3 STAGE 1·5에서 발견된 H-01 위반 6건 → RPC 전환
-- Pattern B: SECURITY DEFINER, is_cms_user() 내부 권한체크, JSONB 반환
-- 호출부: locals.supabase.rpc(...) (세션 클라이언트 — is_cms_user()가 auth.uid()에 의존하므로
-- service_role admin 클라이언트로 호출하면 auth.uid()가 NULL이라 항상 거부됨. Migration 262와
-- 동일 제약)
--
-- 대상:
--   ① canned_responses 삭제(qna/+page.server.ts delete) — 이제 manager 이상만 가능하도록
--      app 레벨에서도 hasSettingsAccess 게이트를 함께 추가(STAGE 1 BOUNDARY-3, 기존엔 세션만
--      있으면 partner도 삭제 가능했음 — 같은 파일의 promoteCandidate/deleteCandidateMember와
--      역할 경계 통일)
--   ② synonym_group_members 승급(promoteCandidate)/삭제(deleteCandidateMember)
--   ③ marketing_rules 생성/토글/삭제(promotion/rules) — 토글은 migration 262의 cms_toggle_banner와
--      동일하게 서버측 NOT 반전으로 개선(클라이언트가 보낸 is_active를 신뢰하지 않음)
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

-- ─── 1. cms_delete_canned_response ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_delete_canned_response(
  p_id UUID
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

  DELETE FROM public.canned_responses WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 2. cms_promote_synonym_candidate ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_promote_synonym_candidate(
  p_id UUID
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

  UPDATE public.synonym_group_members
  SET status = 'confirmed'
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 3. cms_delete_synonym_candidate ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_delete_synonym_candidate(
  p_id UUID
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

  DELETE FROM public.synonym_group_members WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 4. cms_create_marketing_rule ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_create_marketing_rule(
  p_name         TEXT,
  p_trigger_type TEXT,
  p_trigger_meta JSONB DEFAULT NULL,
  p_action_type  TEXT DEFAULT NULL,
  p_action_meta  JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  INSERT INTO public.marketing_rules (
    name, trigger_type, trigger_meta, action_type, action_meta, is_active
  ) VALUES (
    p_name, p_trigger_type, p_trigger_meta, p_action_type, p_action_meta, TRUE
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 5. cms_toggle_marketing_rule (서버측 NOT is_active — migration 262 cms_toggle_banner와 동일 원칙) ──
CREATE OR REPLACE FUNCTION public.cms_toggle_marketing_rule(
  p_id UUID
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

  UPDATE public.marketing_rules
  SET is_active = NOT is_active
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ─── 6. cms_delete_marketing_rule ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_delete_marketing_rule(
  p_id UUID
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

  DELETE FROM public.marketing_rules WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.cms_delete_canned_response(UUID);
--   DROP FUNCTION IF EXISTS public.cms_promote_synonym_candidate(UUID);
--   DROP FUNCTION IF EXISTS public.cms_delete_synonym_candidate(UUID);
--   DROP FUNCTION IF EXISTS public.cms_create_marketing_rule(TEXT, TEXT, JSONB, TEXT, JSONB);
--   DROP FUNCTION IF EXISTS public.cms_toggle_marketing_rule(UUID);
--   DROP FUNCTION IF EXISTS public.cms_delete_marketing_rule(UUID);
-- ============================================================
