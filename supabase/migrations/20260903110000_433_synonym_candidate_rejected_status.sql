-- Migration 433: NLSearch C안 — 동의어 후보 "거부(rejected)" 상태 도입
--
-- 배경(2026-09-03): 지금까지 후보 거부는 synonym_group_members 행을 하드 DELETE하는
-- cms_delete_synonym_candidate 하나뿐이었다. 학습 경로(이중언어 병기패턴·재검색행동학습·
-- 빠른답변 발신학습)가 전부 upsert_synonym_member RPC로 수렴하는데, 이 RPC는 삭제된
-- 행이 있었다는 사실을 전혀 모르므로 같은 오탐 후보가 다음 관찰 때 그대로 재등록된다.
-- 관리자가 "이 매핑은 틀렸다"고 한 번 판단해도 그 판단이 영구히 기억되지 않는 셈이다.
--
-- 수정: status CHECK에 'rejected' 추가 + upsert_synonym_member가 기존 상태 'rejected'를
-- 최우선으로 보존(재관찰돼도 절대 candidate/confirmed로 되돌아가지 않음)하도록 CASE 분기
-- 순서만 조정. cms_reject_synonym_candidate RPC 신규(cms_promote_synonym_candidate와 동일
-- 패턴) — CMS "거부" 버튼이 하드 DELETE 대신 이 RPC를 호출하도록 앱코드도 함께 변경.

-- 1. status CHECK 제약 확장
ALTER TABLE public.synonym_group_members
  DROP CONSTRAINT synonym_group_members_status_check;
ALTER TABLE public.synonym_group_members
  ADD CONSTRAINT synonym_group_members_status_check
  CHECK (status = ANY (ARRAY['candidate'::text, 'confirmed'::text, 'rejected'::text]));

-- 2. upsert_synonym_member — rejected 상태를 재관찰로부터 보호(최우선 CASE 분기)
CREATE OR REPLACE FUNCTION public.upsert_synonym_member(
  p_group_id  uuid,
  p_term      text,
  p_threshold integer DEFAULT 3,
  p_source    text DEFAULT 'learned'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF p_source NOT IN ('seed', 'learned', 'cross_lingual_pattern', 'query_reformulation') THEN
    p_source := 'learned';
  END IF;

  INSERT INTO public.synonym_group_members
    (group_id, term, source, status, occurrence_count)
  VALUES
    (p_group_id, p_term, p_source, 'candidate', 1)
  ON CONFLICT (group_id, term) DO UPDATE SET
    occurrence_count  = synonym_group_members.occurrence_count + 1,
    last_observed_at  = now(),
    status = CASE
      -- 관리자가 명시적으로 거부한 조합은 재관찰돼도 절대 되살아나지 않는다(신규 최우선 분기)
      WHEN synonym_group_members.status = 'rejected' THEN 'rejected'
      WHEN synonym_group_members.status = 'confirmed' THEN 'confirmed'
      WHEN (synonym_group_members.occurrence_count + 1) >= p_threshold THEN 'confirmed'
      ELSE synonym_group_members.status
    END;
END;
$function$;

-- 3. cms_reject_synonym_candidate — cms_promote_synonym_candidate와 동일 패턴
CREATE OR REPLACE FUNCTION public.cms_reject_synonym_candidate(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.synonym_group_members
  SET status = 'rejected'
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.cms_reject_synonym_candidate IS
  'NLSearch C안: 동의어 후보를 하드 삭제하지 않고 status=rejected로 영구 보존 — upsert_synonym_member가
  이 상태를 최우선 보존해 같은 오탐 후보가 재학습으로 되살아나지 않게 한다.';
