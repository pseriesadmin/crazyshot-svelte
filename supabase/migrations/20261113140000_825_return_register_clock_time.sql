-- Migration #825: 반납정보 등록요청 발송 시간을 '반납일 당일 HH:MM'으로 (2026-11-13, Stephen 확정)
--
-- 변경 이유: 푸시알림 설정 '반납정보 등록요청' 행의 발송 시간을 다른 타이머와 같은 시·분 선택(표준 시간설정 UI)으로 통일 —
--           값의 의미가 '반납 시각 N시간 전'(#822)에서 '반납일 당일 지정 시각(KST 01:00~24:00, 10분 단위, 24:00=당일 23:50)'으로 바뀐다.
-- 변경: claim_return_register_clock_targets(p_visit_minutes, p_quick_minutes, p_locker_minutes, p_limit) 신설.
--   #822 의 claim_return_register_targets 와 같은 대상·같은 반환 모양·같은 주문 묶음 규칙('대표 외 N개 상품', 주문·반납일·단계당 1회, 형제 기록, release_return_notice_claim 재사용).
--   발송 시점만 다르다 — 반납일 당일 지정 시각(분)이 지났고(1시간 이내) 반납 시각 1시간 뒤를 넘지 않았을 때. 값이 NULL 인 방식은 보내지 않는다.
--   기록이 있는 상품(고객 제출·관리자 대리 등록)·면제(return_record_exempt) 예약은 제외. 반납 시각 형식 오류·없음은 18:00.
-- 변경하지 않는 것: #822 의 claim_return_register_targets(옛 'N시간 전' 함수 — 더 이상 호출하지 않지만 배포 순서 사고를 막기 위해 남겨 둔다. 정리는 이후 별도 마이그레이션),
--   claim_return_notice_targets, return_notice_logs 단계 허용값.
-- 권한: 서버 전용 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드(크론)보다 먼저 적용한다. 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION IF EXISTS public.claim_return_register_clock_targets(integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_return_register_clock_targets(
  p_visit_minutes  integer,
  p_quick_minutes  integer,
  p_locker_minutes integer,
  p_limit          integer DEFAULT 50
)
RETURNS TABLE(reservation_id bigint, user_id uuid, stage text, return_method text, product_name text, return_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT rr.id AS rid, rr.user_id AS uid, rr.return_method AS rm, rr.end_date AS edate,
           COALESCE((SELECT MIN(oi.order_id)::text FROM order_items oi WHERE oi.reservation_id = rr.id),
                    'r' || rr.id::text) AS okey,
           COALESCE(ppar.name, p.name) AS pname,
           ((rr.end_date::text || ' ' ||
             CASE WHEN rr.return_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN rr.return_time ELSE '18:00' END)::timestamp
            AT TIME ZONE 'Asia/Seoul') AS ret_at,
           CASE rr.return_method WHEN 'visit' THEN 'reg_visit' WHEN 'quick' THEN 'reg_quick' WHEN 'locker' THEN 'reg_locker' END AS st,
           CASE rr.return_method WHEN 'visit' THEN p_visit_minutes WHEN 'quick' THEN p_quick_minutes WHEN 'locker' THEN p_locker_minutes END AS mins
      FROM rental_reservations rr
      JOIN products p ON p.id = rr.product_id
      LEFT JOIN products ppar ON ppar.id = p.parent_product_id
     WHERE rr.status IN ('in_use', 'return_requested')
       AND rr.end_date IS NOT NULL
       AND rr.return_method IN ('visit', 'quick', 'locker')
       AND rr.return_record_exempt = false
       AND NOT EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = rr.id)
       AND NOT EXISTS (SELECT 1 FROM reservation_return_admin_entries e WHERE e.reservation_id = rr.id)
  ),
  due AS (
    SELECT b.*, ((b.edate::timestamp + make_interval(mins => b.mins)) AT TIME ZONE 'Asia/Seoul') AS due_at
      FROM base b
     WHERE b.mins IS NOT NULL
  ),
  ready AS (
    SELECT d.* FROM due d
     WHERE now() >= d.due_at
       AND now() <  d.due_at + interval '1 hour'
       AND now() <  d.ret_at + interval '1 hour'
  ),
  cand AS (
    -- 자기 기록이 없고, 같은 주문·같은 반납일의 형제도 이 단계 기록이 없는 대상만
    SELECT d.* FROM ready d
     WHERE NOT EXISTS (
       SELECT 1 FROM return_notice_logs l
        WHERE l.stage = d.st
          AND (l.reservation_id = d.rid
               OR l.reservation_id IN (
                    SELECT oi2.reservation_id FROM order_items oi2
                      JOIN rental_reservations r2 ON r2.id = oi2.reservation_id
                     WHERE oi2.order_id::text = d.okey AND r2.end_date = d.edate)))
  ),
  rep AS (
    SELECT DISTINCT ON (c.okey, c.edate, c.st) c.*,
           COUNT(*) OVER (PARTITION BY c.okey, c.edate, c.st) AS cnt
      FROM cand c
     ORDER BY c.okey, c.edate, c.st, c.rid
  ),
  pick AS (
    SELECT r.* FROM rep r
     ORDER BY r.ret_at
     LIMIT p_limit
  ),
  ins AS (
    INSERT INTO return_notice_logs (reservation_id, stage)
    SELECT c.rid, c.st FROM cand c
      JOIN pick pk ON pk.okey = c.okey AND pk.edate = c.edate AND pk.st = c.st
    ON CONFLICT DO NOTHING
    RETURNING return_notice_logs.reservation_id AS rid2, return_notice_logs.stage AS st2
  )
  SELECT pk.rid, pk.uid, ins.st2, pk.rm,
         CASE WHEN pk.cnt > 1 THEN pk.pname || ' 외 ' || (pk.cnt - 1)::text || '개 상품' ELSE pk.pname END,
         pk.ret_at
    FROM ins JOIN pick pk ON pk.rid = ins.rid2 AND pk.st = ins.st2;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_return_register_clock_targets(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_return_register_clock_targets(integer, integer, integer, integer) TO service_role;
