-- Migration #695: 무인보관함 안내 채팅카드 문구를 "푸시알림 설정의 공통 안내문장"으로 덮어쓰기 (2026-10-11, Stephen 확정)
--
-- 정책: 푸시·문자·채팅카드가 같은 공통 안내문장(CMS 푸시알림 설정 → 무인보관함 이용 안내)을 쓴다. 문장 치환은 앱 서버가 하고,
--   채팅카드는 그 결과 문장을 받아 카드 본문으로 쓴다(DB 함수는 문장을 계산하지 않는다).
-- 방식: send_rental_chat_notification의 공개 시그니처는 바꾸지 않는다(anon·authenticated도 호출 가능한 기존 권한 — 임의 문장 주입을 막기 위해 매개변수를 추가하지 않음).
--   대신 서버 전용 래퍼 send_locker_guide_card(reservation_id, content)가 트랜잭션 로컬 설정 app.locker_guide_content에 문장을 넣고 기존 함수를 호출한다.
--   기존 함수는 locker_guide일 때만 이 설정을 읽어 본문을 대체한다(설정이 없으면 #694 고정 문구 그대로).
-- ROLLBACK: DROP FUNCTION public.send_locker_guide_card(bigint, text); 기존 함수는 -- locker-guide-content-695 마커가 붙은 두 곳(선언·본문 덮어쓰기)만 제거.

DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_cnt int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_rental_chat_notification';
  IF v_def IS NULL THEN RAISE EXCEPTION 'send_rental_chat_notification not found'; END IF;
  IF position('-- locker-guide-content-695' in v_def) > 0 THEN
    RAISE NOTICE '#695 already applied — skip';
    RETURN;
  END IF;
  v_new := v_def;

  v_cnt := (length(v_new) - length(replace(v_new, E'  -- locker-guide-card-694\n', ''))) / length(E'  -- locker-guide-card-694\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#695 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'  -- locker-guide-card-694\n', E'  -- locker-guide-card-694\n  v_content_override TEXT;\n  -- locker-guide-content-695\n');

  v_cnt := (length(v_new) - length(replace(v_new, E'  v_card_type := CASE p_notify_type\n', ''))) / length(E'  v_card_type := CASE p_notify_type\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#695 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'  v_card_type := CASE p_notify_type\n',
    E'  IF p_notify_type = ''locker_guide'' THEN\n    v_content_override := NULLIF(btrim(COALESCE(current_setting(''app.locker_guide_content'', true), '''')), '''');\n    IF v_content_override IS NOT NULL THEN\n      v_content := left(v_content_override, 2000);\n    END IF;\n  END IF;\n\n  v_card_type := CASE p_notify_type\n');

  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.send_locker_guide_card(p_reservation_id bigint, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.locker_guide_content', COALESCE(p_content, ''), true);
  RETURN public.send_rental_chat_notification(p_reservation_id, 'locker_guide');
END;
$$;

REVOKE ALL ON FUNCTION public.send_locker_guide_card(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_locker_guide_card(bigint, text) TO service_role;
