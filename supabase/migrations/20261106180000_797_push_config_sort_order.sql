-- Migration #797: 푸시알림 설정(push_notification_config) 고객 알림 목록 순서 — 관리자가 드래그로 바꿀 수 있게 정렬 컬럼 추가 (2026-11-06, Stephen 지시)
--
--  1) sort_order  — 목록 표시 순서(작을수록 위). 기존 행은 지금 화면 순서(= id 순)대로 10 단위로 채워 처음에는 화면이 달라지지 않는다.
--                   새로 추가되는 알림 유형은 sort_order 가 비어 있으면 목록 맨 아래(id 순)에 붙는다(코드가 NULLS LAST).
--  2) reorder_push_notification_config(p_category, p_notify_types[]) — 서버 전용(service_role). 한 분류(category)의 전체 유형을 넘긴 순서대로 다시 번호를 매긴다.
--     화면이 오래돼 유형 목록이 서로 다르면(새 유형 추가·삭제) 아무것도 바꾸지 않고 거절한다(순서가 뒤섞이는 것 방지).
-- 발송 대상·시점·문구에는 영향 없음 — 화면 표시 순서만 바꾼다.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION IF EXISTS public.reorder_push_notification_config(text, text[]); ALTER TABLE public.push_notification_config DROP COLUMN IF EXISTS sort_order;

ALTER TABLE public.push_notification_config ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN public.push_notification_config.sort_order IS '푸시알림 설정 화면 표시 순서(작을수록 위). NULL = 아직 정렬하지 않은 신규 유형(목록 맨 아래, id 순)';

-- 기존 행: 현재 화면 순서(id 순)대로 채운다(분류별로 따로 번호를 매긴다). 이미 값이 있는 행은 건드리지 않는다.
UPDATE public.push_notification_config c
   SET sort_order = r.rn * 10
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY category ORDER BY id) AS rn
      FROM public.push_notification_config
  ) r
 WHERE c.id = r.id
   AND c.sort_order IS NULL;

CREATE OR REPLACE FUNCTION public.reorder_push_notification_config(p_category text, p_notify_types text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text[];
  v_dup_count integer;
BEGIN
  IF p_category IS NULL OR p_category NOT IN ('customer_lifecycle', 'customer_marketing') THEN
    RETURN jsonb_build_object('ok', false, 'error', '알 수 없는 분류입니다.');
  END IF;
  IF p_notify_types IS NULL OR array_length(p_notify_types, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '순서 목록이 비어 있습니다.');
  END IF;

  SELECT count(*) - count(DISTINCT t) INTO v_dup_count FROM unnest(p_notify_types) AS t;
  IF v_dup_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '중복된 알림이 있습니다.');
  END IF;

  SELECT array_agg(notify_type ORDER BY notify_type) INTO v_existing
    FROM public.push_notification_config WHERE category = p_category;

  -- 화면이 본 목록과 DB 의 현재 목록이 다르면(다른 관리자가 추가·삭제) 거절 — 새로고침 후 다시 정렬
  IF v_existing IS DISTINCT FROM (SELECT array_agg(t ORDER BY t) FROM unnest(p_notify_types) AS t) THEN
    RETURN jsonb_build_object('ok', false, 'error', '알림 목록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 정렬해 주세요.');
  END IF;

  UPDATE public.push_notification_config c
     SET sort_order = o.ord * 10,
         updated_at = now()
    FROM (SELECT t AS notify_type, ord FROM unnest(p_notify_types) WITH ORDINALITY AS u(t, ord)) o
   WHERE c.category = p_category
     AND c.notify_type = o.notify_type;

  RETURN jsonb_build_object('ok', true, 'count', array_length(p_notify_types, 1));
END;
$$;

-- 서버 전용: PUBLIC·anon·authenticated 모두 회수 + service_role 명시 부여(rules: service-operations.md §23)
REVOKE ALL ON FUNCTION public.reorder_push_notification_config(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_push_notification_config(text, text[]) TO service_role;
