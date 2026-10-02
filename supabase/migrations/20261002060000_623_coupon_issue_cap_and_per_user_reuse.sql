-- Migration 623 — 쿠폰 "총 발행 개수" + "1인당 사용 횟수" 재정의 (2026-10-02, Stephen 확정)
--
-- 정책
--  ① 총 발행 개수 = coupons.total_usage_limit (컬럼명은 그대로, 의미만 "발행 개수"로 확정)
--     · 0/NULL = 무제한. N = 이 쿠폰이 N명에게 발급되면 이후 모든 배포 경로(수동 지급·자동배포·기타)가 자동 중단.
--     · user_coupons BEFORE INSERT 트리거가 한도 초과 행을 조용히 건너뛴다(에러 없음) — 배포 함수들은 건드리지 않고도 일관되게 적용.
--     · 한도를 이미 발급된 수보다 낮춰도 기존 보유분은 유지, 신규 발급만 막힌다.
--     · 수동 지급 사전조회/결과는 'limit_reached' 상태로 초과분을 알린다.
--     · 장바구니에서 이 값으로 쿠폰을 숨기던 기존 필터(누적 사용 횟수 비교)는 앱 코드에서 제거(발행 개수 ≠ 사용 횟수).
--  ② 1인당 사용 횟수 = coupons.per_user_limit
--     · 0 = 무제한(매번 사용 가능), N = 한 사용자가 N번까지 사용, NULL = 과거 기본 1회. 기본값 1은 기존 동작 그대로(ALREADY_USED).
--     · 한 사용자는 같은 쿠폰을 1장만 보유하므로(UNIQUE(user_id, coupon_id)) 그 1행의 used_count로 횟수를 센다.
--       private._validate_and_consume_coupon이 used_at이 있어도 한도 미소진이면 재사용을 허용한다.
--
-- 구현 방식: 현행 함수 정의를 적용 시점에 읽어 해당 구문만 앵커 치환(멱등, 앵커 불일치 시 중단) — 다른 세션이 같은 함수를 바꿔도 덮어쓰지 않는다.

-- ── 0) 컬럼 설명 ──────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.coupons.total_usage_limit IS '총 발행 개수 — 0/NULL=무제한, N=N명에게 발급되면 배포 중단(user_coupons INSERT 트리거). 컬럼명은 과거 호환을 위해 유지.';
COMMENT ON COLUMN public.coupons.per_user_limit    IS '1인당 사용 횟수 — 0=무제한(매번 사용 가능), N=한 사용자가 N번까지, 기본 1. 보유 쿠폰 1행의 used_count로 센다.';

-- ── 1) 총 발행 개수 — 발급 한도 트리거 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.user_coupons_enforce_issue_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cap    INT;
  v_issued INT;
BEGIN
  SELECT total_usage_limit INTO v_cap FROM coupons WHERE id = NEW.coupon_id;
  IF v_cap IS NULL OR v_cap <= 0 THEN
    RETURN NEW;  -- 무제한 — 추가 비용 없음
  END IF;

  -- 이미 보유 중인 사용자의 재삽입은 한도 계산 대상이 아니다(UNIQUE/ON CONFLICT가 처리)
  IF EXISTS (SELECT 1 FROM user_coupons WHERE user_id = NEW.user_id AND coupon_id = NEW.coupon_id) THEN
    RETURN NEW;
  END IF;

  -- 같은 쿠폰의 동시 발급을 직렬화(키 공유 잠금과 충돌하지 않는 NO KEY UPDATE)
  PERFORM 1 FROM coupons WHERE id = NEW.coupon_id FOR NO KEY UPDATE;

  SELECT count(*) INTO v_issued FROM user_coupons WHERE coupon_id = NEW.coupon_id;
  IF v_issued >= v_cap THEN
    RETURN NULL;  -- 한도 도달: 이 행만 조용히 건너뜀
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION private.user_coupons_enforce_issue_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_coupons_issue_cap ON public.user_coupons;
CREATE TRIGGER trg_user_coupons_issue_cap
  BEFORE INSERT ON public.user_coupons
  FOR EACH ROW EXECUTE FUNCTION private.user_coupons_enforce_issue_cap();

-- ── 2) 앵커 치환 도우미(이 세션 한정) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.rep_once(src text, a text, b text, label text)
RETURNS text
LANGUAGE plpgsql
AS $f$
DECLARE
  n int;
BEGIN
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Migration 623 anchor mismatch (%): % 회 발견', label, n;
  END IF;
  RETURN replace(src, a, b);
END;
$f$;

-- ── 3) 1인당 사용 횟수 — 사용 판정(_validate_and_consume_coupon) ───────────────────────
DO $do$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('private._validate_and_consume_coupon(uuid,bigint,uuid)'::regprocedure);
  IF position('Migration 623' in v_def) > 0 THEN RETURN; END IF;

  v_def := pg_temp.rep_once(v_def,
    $a$    uc.used_at,
    uc.first_viewed_at,$a$,
    $b$    uc.used_at,
    uc.used_count,
    uc.first_viewed_at,$b$,
    'consume.select');

  v_def := pg_temp.rep_once(v_def,
    $a$  IF v_uc.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;$a$,
    $b$  -- 1인당 사용 횟수(per_user_limit) — 0=무제한, N=N번까지, NULL=과거 기본 1회 (Migration 623)
  IF v_uc.used_at IS NOT NULL
     AND COALESCE(v_uc.per_user_limit, 1) > 0
     AND GREATEST(COALESCE(v_uc.used_count, 0), 1) >= COALESCE(v_uc.per_user_limit, 1)
  THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN COALESCE(v_uc.per_user_limit, 1) = 1 THEN 'ALREADY_USED' ELSE 'PER_USER_LIMIT_EXCEEDED' END);
  END IF;$b$,
    'consume.used_check');

  v_def := pg_temp.rep_once(v_def,
    $a$  IF COALESCE(v_uc.per_user_limit, 0) > 0 THEN
    SELECT count(*) INTO v_used_count_by_user
    FROM user_coupons
    WHERE user_id = p_user_id
      AND coupon_id = v_uc.coupon_id
      AND used_at IS NOT NULL;

    IF v_used_count_by_user >= v_uc.per_user_limit THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PER_USER_LIMIT_EXCEEDED');
    END IF;
  END IF;
$a$,
    $b$  -- (1인당 사용 횟수 판정은 위 ①-a로 이동 — Migration 623)
$b$,
    'consume.per_user_block');

  EXECUTE v_def;
END
$do$;

-- ── 4) 총 발행 개수 — 수동 지급 결과에 limit_reached 상태 추가(distribute_coupon) ──────────
DO $do$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.distribute_coupon(uuid,text,jsonb,uuid)'::regprocedure);
  IF position('limit_reached' in v_def) > 0 THEN RETURN; END IF;

  v_def := pg_temp.rep_once(v_def,
    $a$ELSE 'already_held'$a$,
    $b$WHEN NOT EXISTS (SELECT 1 FROM user_coupons uc
                                  WHERE uc.user_id = u.uid AND uc.coupon_id = p_coupon_id) THEN 'limit_reached'
                 ELSE 'already_held'$b$,
    'distribute.status');

  EXECUTE v_def;
END
$do$;

-- ── 5) 총 발행 개수 — 수동 지급 사전조회에 limit_reached 반영(preview_distribute_coupon) ────
DO $do$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.preview_distribute_coupon(uuid,uuid[])'::regprocedure);
  IF position('limit_reached' in v_def) > 0 THEN RETURN; END IF;

  v_def := pg_temp.rep_once(v_def,
    $a$  v_limit   INT;
  v_results JSONB;$a$,
    $b$  v_limit   INT;
  v_cap     INT;
  v_issued  INT;
  v_results JSONB;$b$,
    'preview.declare');

  v_def := pg_temp.rep_once(v_def,
    $a$  SELECT per_user_limit INTO v_limit$a$,
    $b$  SELECT per_user_limit, total_usage_limit INTO v_limit, v_cap$b$,
    'preview.select');

  v_def := pg_temp.rep_once(v_def,
    $a$  RETURN jsonb_build_object('ok', true, 'per_user_limit', v_limit, 'results', v_results);$a$,
    $b$  -- 총 발행 개수(Migration 623): 남은 개수만큼만 will_issue, 초과분은 limit_reached
  IF v_cap IS NOT NULL AND v_cap > 0 THEN
    SELECT count(*) INTO v_issued FROM user_coupons WHERE coupon_id = p_coupon_id;
    SELECT COALESCE(jsonb_agg(
             CASE WHEN e.item->>'status' = 'will_issue' AND e.running > GREATEST(v_cap - v_issued, 0)
                  THEN jsonb_set(e.item, '{status}', '"limit_reached"')
                  ELSE e.item END
             ORDER BY e.ord), '[]'::jsonb)
      INTO v_results
    FROM (
      SELECT t.item, t.ord,
             count(*) FILTER (WHERE t.item->>'status' = 'will_issue') OVER (ORDER BY t.ord) AS running
        FROM jsonb_array_elements(v_results) WITH ORDINALITY AS t(item, ord)
    ) e;
  END IF;

  RETURN jsonb_build_object('ok', true, 'per_user_limit', v_limit, 'issue_limit', v_cap, 'results', v_results);$b$,
    'preview.return');

  EXECUTE v_def;
END
$do$;

-- ROLLBACK(참고용): DROP TRIGGER trg_user_coupons_issue_cap ON public.user_coupons; DROP FUNCTION private.user_coupons_enforce_issue_cap();
--   세 함수는 이전 정의(Migration 616/기존)로 되돌린다.
