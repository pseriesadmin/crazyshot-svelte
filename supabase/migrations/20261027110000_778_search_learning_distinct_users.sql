-- 778_search_learning_distinct_users.sql
-- 검색 학습 승격 기준을 "클릭 횟수"에서 "서로 다른 사용자 수"로 바꾸기 위한 기록 구조 (2026-10-27, Stephen 확정: 2명 이상·식별 불가 비회원은 공용 1명).
--  · product_search_click_actors: (상품, 검색어)를 누른 "사용자"별 클릭 수. 사용자 키 = 회원/익명로그인 user_id, 없으면 세션 's:'||session_id, 둘 다 없으면 공용 'guest'(1명으로 계산).
--  · product_search_stats.click_user_count: (상품, 검색어)를 누른 서로 다른 사용자 수(검색 색인 로더가 이 값으로 승격 판단 — 앱 코드 변경과 함께 배포, DB 먼저 적용).
--  · record_search_click: 기존 동작(클릭 수·search_logs 기록)은 그대로 두고 사용자 기록을 더한다. 고객 브라우저가 호출하므로 anon·authenticated 실행 권한은 CREATE OR REPLACE가 그대로 유지한다.
--  · 기존 클릭은 search_logs(clicked_ids)에서 복원한다(식별 불가는 공용 1명).
-- 권한: 새 테이블은 RLS ON·정책 0건·service_role만(SECURITY DEFINER 함수가 쓴다).
-- 롤백: record_search_click 을 20260714000114 계열 이전 정의(클릭 수만 +1)로 되돌리고 DROP TABLE public.product_search_click_actors; ALTER TABLE public.product_search_stats DROP COLUMN click_user_count;

ALTER TABLE public.product_search_stats
  ADD COLUMN IF NOT EXISTS click_user_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.product_search_click_actors (
  product_id       uuid        NOT NULL,
  search_term      text        NOT NULL,
  actor_key        text        NOT NULL,
  click_count      integer     NOT NULL DEFAULT 1 CHECK (click_count >= 1),
  first_clicked_at timestamptz NOT NULL DEFAULT now(),
  last_clicked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, search_term, actor_key)
);

ALTER TABLE public.product_search_click_actors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_search_click_actors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_search_click_actors TO service_role;

CREATE OR REPLACE FUNCTION public.record_search_click(p_search_log_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_query   TEXT;
  v_user    UUID;
  v_session TEXT;
  v_actor   TEXT;
  v_new     BOOLEAN;
BEGIN
  SELECT query, user_id, session_id INTO v_query, v_user, v_session
  FROM search_logs WHERE id = p_search_log_id;
  IF v_query IS NULL THEN RETURN; END IF;

  v_actor := coalesce(
    v_user::text,
    CASE WHEN v_session IS NOT NULL AND v_session <> '' THEN 's:' || v_session END,
    'guest'
  );

  INSERT INTO product_search_click_actors(product_id, search_term, actor_key)
  VALUES (p_product_id, v_query, v_actor)
  ON CONFLICT (product_id, search_term, actor_key)
  DO UPDATE SET click_count = product_search_click_actors.click_count + 1, last_clicked_at = now()
  RETURNING (xmax = 0) INTO v_new;

  INSERT INTO product_search_stats(product_id, search_term, impression_count, click_count, click_user_count)
  VALUES (p_product_id, v_query, 0, 1, 1)
  ON CONFLICT (product_id, search_term)
  DO UPDATE SET
    click_count      = product_search_stats.click_count + 1,
    click_user_count = product_search_stats.click_user_count + CASE WHEN v_new THEN 1 ELSE 0 END,
    last_updated     = now();

  UPDATE search_logs
  SET clicked_ids = array_append(coalesce(clicked_ids, '{}'), p_product_id)
  WHERE id = p_search_log_id;
END;
$function$;

-- 기존 클릭 복원: search_logs.clicked_ids → 사용자별 기록 → 사용자 수
INSERT INTO public.product_search_click_actors(product_id, search_term, actor_key, click_count, first_clicked_at, last_clicked_at)
SELECT cid, sl.query,
       coalesce(sl.user_id::text, CASE WHEN sl.session_id IS NOT NULL AND sl.session_id <> '' THEN 's:' || sl.session_id END, 'guest'),
       count(*), min(sl.created_at), max(sl.created_at)
FROM public.search_logs sl, unnest(sl.clicked_ids) AS cid
WHERE sl.query IS NOT NULL
GROUP BY cid, sl.query, 3
ON CONFLICT (product_id, search_term, actor_key) DO NOTHING;

UPDATE public.product_search_stats s
SET click_user_count = a.n
FROM (SELECT product_id, search_term, count(*)::int AS n FROM public.product_search_click_actors GROUP BY product_id, search_term) a
WHERE a.product_id = s.product_id AND a.search_term = s.search_term;

-- 로그가 이미 지워져 복원할 수 없는 클릭이 있으면 최소 1명으로 본다(승격을 부풀리지 않는 보수적 값)
UPDATE public.product_search_stats SET click_user_count = 1 WHERE click_count > 0 AND click_user_count = 0;
