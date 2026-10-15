-- 717 — 전자계약 자동발행 표준양식 (2026-10-15, Stephen 확정)
-- 예약목록 '승인하기' 실행 시 자동으로 발행·발송할 "단독 표준양식" 1개를 지정한다.
--   · contract_templates.auto_issue_default = true 인 양식은 (삭제되지 않은 것 기준) 최대 1개 — 부분 유일 인덱스로 보장
--   · 지정/해제는 cms_set_auto_issue_template RPC(원자적: 켜면 기존 지정을 먼저 해제) — service_role 전용
--   · 보관(archived)·삭제된 양식은 지정 상태가 자동 해제(트리거) — 표준양식이 보이지 않게 남지 않도록
-- 롤백:
--   DROP TRIGGER IF EXISTS trg_contract_templates_clear_auto_issue ON public.contract_templates;
--   DROP FUNCTION IF EXISTS private.contract_templates_clear_auto_issue();
--   DROP FUNCTION IF EXISTS public.cms_set_auto_issue_template(uuid, boolean);
--   DROP INDEX IF EXISTS public.contract_templates_auto_issue_default_one;
--   ALTER TABLE public.contract_templates DROP COLUMN IF EXISTS auto_issue_default;

ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS auto_issue_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_auto_issue_default_one
  ON public.contract_templates ((true))
  WHERE auto_issue_default AND deleted_at IS NULL;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.contract_templates_clear_auto_issue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.auto_issue_default AND (NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL) THEN
    NEW.auto_issue_default := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_templates_clear_auto_issue ON public.contract_templates;
CREATE TRIGGER trg_contract_templates_clear_auto_issue
  BEFORE INSERT OR UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION private.contract_templates_clear_auto_issue();

CREATE OR REPLACE FUNCTION public.cms_set_auto_issue_template(p_template_id uuid, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_deleted timestamptz;
BEGIN
  SELECT status, deleted_at INTO v_status, v_deleted
    FROM public.contract_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_not_found');
  END IF;

  IF NOT p_on THEN
    UPDATE public.contract_templates SET auto_issue_default = false WHERE id = p_template_id AND auto_issue_default;
    RETURN jsonb_build_object('ok', true, 'on', false);
  END IF;

  IF v_status <> 'active' OR v_deleted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_not_active');
  END IF;

  -- 단독 지정: 다른 양식의 지정을 먼저 해제한 뒤 이 양식을 지정(같은 트랜잭션)
  UPDATE public.contract_templates SET auto_issue_default = false
    WHERE auto_issue_default AND id <> p_template_id;
  UPDATE public.contract_templates SET auto_issue_default = true WHERE id = p_template_id;
  RETURN jsonb_build_object('ok', true, 'on', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_set_auto_issue_template(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_set_auto_issue_template(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_set_auto_issue_template(uuid, boolean) TO service_role;
