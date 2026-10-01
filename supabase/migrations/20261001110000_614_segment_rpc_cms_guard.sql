-- Migration 614 — 세그먼트 RPC 2종에 CMS 직원 가드 추가 (2026-10-01, Stephen 확정: is_cms_user() 기본)
--
-- 배경: get_segment_users는 회원 이름·휴대폰·이메일을 반환하는 SECURITY DEFINER 함수인데 본문에 권한 확인이 없고
--       authenticated 실행 권한이 열려 있어(Migration 272 hotfix가 권한만 복원) 익명 로그인 세션만으로도 고객 연락처를 조회할 수 있었다.
--       get_segment_stats도 같은 구조(집계값 노출).
-- 조치: 두 함수 본문 맨 앞에 is_cms_user() 가드를 추가하고 search_path를 고정한다. 반환 형태·로직은 기존과 동일.
--       호출처는 cms/promotion/segment/+page.server.ts(CMS 로그인 세션) 한 곳뿐이라 정상 접속은 영향 없음.
-- 권한: anon 차단 유지, authenticated 유지(CMS 브라우저 세션 호출 패턴 보존 — 가드가 본문에서 집행됨).

CREATE OR REPLACE FUNCTION public.get_segment_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'forbidden: CMS 권한이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_tracked_users',
      (SELECT COUNT(DISTINCT user_id) FROM user_behavior_events WHERE user_id IS NOT NULL),
    'total_events_7d',
      (SELECT COUNT(*) FROM user_behavior_events WHERE created_at > now() - INTERVAL '7 days'),
    'segments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'segment', segment,
          'count', cnt,
          'avg_score', avg_score
        )
        ORDER BY cnt DESC
      )
      FROM (
        SELECT
          segment,
          COUNT(*) AS cnt,
          ROUND(AVG(score), 1) AS avg_score
        FROM user_segments
        GROUP BY segment
      ) s
    ),
    'last_refresh',
      (SELECT MAX(computed_at) FROM user_segments)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_segment_users(p_segment character varying, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(user_id uuid, full_name text, phone text, email text, score numeric, computed_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'forbidden: CMS 권한이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    us.user_id,
    up.full_name,
    up.phone,
    au.email::TEXT,
    us.score,
    us.computed_at
  FROM user_segments us
  JOIN user_profiles up ON up.id = us.user_id
  LEFT JOIN auth.users au ON au.id = us.user_id
  WHERE us.segment = p_segment
  ORDER BY us.score DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- 권한 명시(CREATE OR REPLACE는 기존 ACL 보존 — 의도 고정): anon 차단, authenticated·service_role 허용
REVOKE ALL ON FUNCTION public.get_segment_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_segment_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_segment_stats() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_segment_users(varchar, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_segment_users(varchar, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_segment_users(varchar, integer, integer) TO authenticated, service_role;

-- ROLLBACK(참고용): Migration 54 정의로 되돌리면 가드가 사라진다(권장하지 않음).
