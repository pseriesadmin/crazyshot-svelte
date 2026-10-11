-- Migration #694: 무인보관함 이용 안내 채팅카드 문구 — 함 번호·반납 시각·중앙현관 비밀번호 추가 (2026-10-11, Stephen 지시)
--
-- 변경 전: "{상품명} 무인보관함 이용 비밀번호는 '*8821'입니다." / 반납기한: 2026-10-10
-- 변경 후: "{상품명} 무인보관함 이용 1번함 비밀번호는 '*8821'입니다.\n중앙현관 비밀번호: 0418*" / 반납기한: 2026-10-10 14:00(고객이 예약에 설정한 시각)
--   · 함 번호가 없는 옛 저장분은 "1번함" 부분 없이 기존 문구 형태 유지
--   · 중앙현관 비밀번호는 cms_settings['locker_entrance_password'].password 에서 읽는다(CMS 푸시알림 설정 화면에서 수정). 값이 없으면 그 줄을 넣지 않는다.
--   · 반납 시각은 locker_guide 카드에만 붙인다(다른 알림의 반납기한 표기는 그대로)
--
-- 방식: 라이브 함수 정의에서 정확히 일치하는 5곳만 치환하는 줄 패치(전체 재작성 금지 — #674 교훈). 각 치환은 정확히 1회 일치해야 하며, 이미 적용된 경우(마커) 건너뛴다.
-- ROLLBACK: 이 패치 이전 정의로 복원 — 아래 5곳의 문자열을 역치환(또는 Migration 직전 정의로 CREATE OR REPLACE).

DO $patch$
DECLARE
  v_def  text;
  v_new  text;
  v_cnt  int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_rental_chat_notification';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'send_rental_chat_notification not found';
  END IF;

  IF position('-- locker-guide-card-694' in v_def) > 0 THEN
    RAISE NOTICE '#694 already applied — skip';
    RETURN;
  END IF;

  v_new := v_def;

  -- ① 선언 추가
  v_cnt := (length(v_new) - length(replace(v_new, E'  v_locker_password TEXT;\n', ''))) / length(E'  v_locker_password TEXT;\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#694 patch1 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'  v_locker_password TEXT;\n',
    E'  v_locker_password TEXT;\n  v_locker_number  TEXT;\n  v_return_time    TEXT;\n  v_entrance       TEXT;\n  -- locker-guide-card-694\n');

  -- ② 조회 컬럼 추가
  v_cnt := (length(v_new) - length(replace(v_new, E'    rr.locker_password\n  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password\n', ''))) / length(E'    rr.locker_password\n  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#694 patch2 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'    rr.locker_password\n  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password\n',
    E'    rr.locker_password,\n    rr.locker_number,\n    rr.return_time\n  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password, v_locker_number, v_return_time\n');

  -- ③ 중앙현관 비밀번호 조회(문구 계산 직전)
  v_cnt := (length(v_new) - length(replace(v_new, E'  v_content := CASE p_notify_type\n', ''))) / length(E'  v_content := CASE p_notify_type\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#694 patch3 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'  v_content := CASE p_notify_type\n',
    E'  IF p_notify_type = ''locker_guide'' THEN\n    SELECT NULLIF(btrim(value->>''password''), '''') INTO v_entrance FROM cms_settings WHERE key = ''locker_entrance_password'';\n  END IF;\n\n  v_content := CASE p_notify_type\n');

  -- ④ 카드 문구
  v_cnt := (length(v_new) - length(replace(v_new, E'THEN v_product || '' 무인보관함 이용 비밀번호는 '''''' || COALESCE(v_locker_password, '''') || ''''''입니다.''\n', ''))) / length(E'THEN v_product || '' 무인보관함 이용 비밀번호는 '''''' || COALESCE(v_locker_password, '''') || ''''''입니다.''\n');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#694 patch4 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'THEN v_product || '' 무인보관함 이용 비밀번호는 '''''' || COALESCE(v_locker_password, '''') || ''''''입니다.''\n',
    E'THEN v_product || '' 무인보관함 이용 '' || CASE WHEN NULLIF(btrim(COALESCE(v_locker_number, '''')), '''') IS NOT NULL THEN btrim(v_locker_number) || ''번함 '' ELSE '''' END || ''비밀번호는 '''''' || COALESCE(v_locker_password, '''') || ''''''입니다.'' || CASE WHEN v_entrance IS NOT NULL THEN E''\\n중앙현관 비밀번호: '' || v_entrance ELSE '''' END\n');

  -- ⑤ 반납기한에 시각 포함(locker_guide 카드만)
  v_cnt := (length(v_new) - length(replace(v_new, E'''return_deadline'', v_end_date::TEXT', ''))) / length(E'''return_deadline'', v_end_date::TEXT');
  IF v_cnt <> 1 THEN RAISE EXCEPTION '#694 patch5 mismatch (%)', v_cnt; END IF;
  v_new := replace(v_new, E'''return_deadline'', v_end_date::TEXT',
    E'''return_deadline'', CASE WHEN p_notify_type = ''locker_guide'' AND NULLIF(btrim(COALESCE(v_return_time, '''')), '''') IS NOT NULL THEN v_end_date::TEXT || '' '' || btrim(v_return_time) ELSE v_end_date::TEXT END');

  EXECUTE v_new;
END
$patch$;
