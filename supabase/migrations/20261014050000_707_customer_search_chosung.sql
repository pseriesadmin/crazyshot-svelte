-- Migration #707: 고객목록 검색 — 한글 초성 검색 추가(이름)
--
-- 배경(2026-10-14): 고객목록 검색(get_customer_list)은 이름·이메일·전화·회원코드를 단순 문자열 비교로 찾아, 'ㅎㄱㄷ' 같은 초성으로는 찾을 수 없었다.
--   (자체 검색엔진·NLSearch는 상품·크레이지로그·빠른답변 전용이라 고객목록에는 연결돼 있지 않다.)
--
-- 수정: 라이브 정의에서 #705가 넣은 회원코드 조건 줄 "한 곳" 뒤에 초성 조건을 추가한다(그 밖은 무변경).
--   · 검색어가 한글 자음(ㄱ-ㅎ)과 공백뿐일 때만 적용 — 일반 검색어에는 영향 없음.
--   · 기존 DB 함수 public.hangul_chosung(Migration 354)을 재사용. 이름의 초성과 검색어에서 공백을 모두 걷어낸 뒤 부분 일치
--     (상품 검색의 한계였던 "공백 없는 초성 vs 공백 있는 이름" 불일치를 여기서는 피한다).
--   권한은 CREATE OR REPLACE가 유지(service_role 전용 — #364 정책). 적용 뒤 ACL 확인.
-- 롤백: 추가한 초성 조건 두 줄을 제거(#705 정의로 복귀).

DO $migration$
DECLARE
  v_def  TEXT;
  v_old  TEXT := $old$        OR c.c_member_code ILIKE '%' || p_search || '%'$old$;
  v_new  TEXT := $new$        OR c.c_member_code ILIKE '%' || p_search || '%'
        OR (p_search ~ '^[ㄱ-ㅎ ]+$' AND btrim(p_search) <> ''
            AND replace(public.hangul_chosung(COALESCE(c.c_name, '')), ' ', '')
                LIKE '%' || replace(p_search, ' ', '') || '%')$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.proname = 'get_customer_list' AND p.pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_customer_list 정의를 찾지 못했습니다';
  END IF;
  -- 이미 적용된 경우(멱등)
  IF position('public.hangul_chosung(COALESCE(c.c_name' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '#705 검색 조건 블록을 라이브 정의에서 찾지 못했습니다(정의가 바뀐 것으로 보임) — 적용 중단';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
