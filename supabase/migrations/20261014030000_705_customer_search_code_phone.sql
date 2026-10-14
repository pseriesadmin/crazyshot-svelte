-- Migration #705: 고객목록 검색 — 회원코드 검색 추가 + 전화번호 하이픈 무관 검색(일반 회원 포함)
--
-- 배경(2026-10-14 Production 조회): get_customer_list의 검색 조건이 이름·이메일·전화(원문 ILIKE)뿐이었다.
--   · 회원코드(CSBC…)는 검색 조건에 없어 찾을 수 없었음.
--   · 일반 회원 전화번호는 숫자만(22명)·하이픈 포함(13명) 형식이 섞여 저장돼, 하이픈 포함으로 입력하면 숫자만 저장된 회원이 안 나왔다
--     (관리대상 등록 인물만 phone_digits로 정규화 비교).
--
-- 수정: 라이브 정의에서 검색 조건 블록 "한 곳"만 정확히 치환한다(다른 부분 무변경, 직전 정의 재작성 금지).
--   ① c_member_code ILIKE 추가
--   ② 입력이 전화번호 모양(숫자·하이픈·공백·괄호·+ 만)일 때만, 저장된 전화번호에서 숫자만 뽑아 부분 일치(영문이 섞인 입력은 숫자 조각이 다른 번호에 우연히 맞는 것을 막기 위해 제외)
--   권한은 CREATE OR REPLACE가 유지(service_role 전용 — #364 정책). 적용 뒤 ACL 확인.
-- 롤백: 아래 치환의 반대(추가한 두 줄 제거).

DO $migration$
DECLARE
  v_def  TEXT;
  v_old  TEXT := $old$        OR c.c_phone ILIKE '%' || p_search || '%'
        OR (c.c_is_managed_person AND v_digits <> '' AND c.c_phone_digits LIKE '%' || v_digits || '%')$old$;
  v_new  TEXT := $new$        OR c.c_phone ILIKE '%' || p_search || '%'
        OR c.c_member_code ILIKE '%' || p_search || '%'
        OR (v_digits <> '' AND p_search ~ '^[0-9+()\s-]+$'
            AND regexp_replace(COALESCE(c.c_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
        OR (c.c_is_managed_person AND v_digits <> '' AND c.c_phone_digits LIKE '%' || v_digits || '%')$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.proname = 'get_customer_list' AND p.pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_customer_list 정의를 찾지 못했습니다';
  END IF;
  -- 이미 적용된 경우(멱등)
  IF position('c.c_member_code ILIKE' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '치환 대상 검색 조건 블록을 라이브 정의에서 찾지 못했습니다(정의가 바뀐 것으로 보임) — 적용 중단';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
