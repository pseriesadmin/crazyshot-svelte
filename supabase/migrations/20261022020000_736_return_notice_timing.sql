-- Migration #736: 반납 안내 알림 발송 시각 변경 (2026-10-22, Stephen 확정)
--   택배류(epost·delivery·crazydelivery·airport): 반납 마지막 날 18:00 → 반납일 당일 09:00 KST (그날 24시간 안에 1회, 대여중일 때만)
--   퀵서비스: 반납 5시간·2시간·1시간 전 3회 → 반납 일시 3시간 전 1회 (단계 키는 기존 'quick_5h' 재사용, 고객 이미 제출했으면 생략)
--   무인보관함: 반납 2시간 전 → 반납 일시 3시간 전 (단계 키 기존 'locker_2h' 재사용, 고객 이미 제출했으면 생략)
--   방문·미지정: 변경 없음(기존 09시 return_remind 크론)
-- 이미 발송된 (예약, 단계) 기록은 그대로 두며 같은 단계는 다시 선점되지 않는다. 단계 키 이름은 호환을 위해 유지한다.
-- ROLLBACK: #723 본문으로 claim_return_notice_targets 를 CREATE OR REPLACE, push_notification_config 라벨 2건 복구.

CREATE OR REPLACE FUNCTION public.claim_return_notice_targets(p_limit integer DEFAULT 50)
RETURNS TABLE(reservation_id bigint, user_id uuid, stage text, return_method text, product_name text, return_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT rr.id AS rid, rr.user_id AS uid, rr.return_method AS rm, rr.status AS rstatus,
           COALESCE(ppar.name, p.name) AS pname,
           ((rr.end_date::text || ' ' ||
             CASE WHEN rr.return_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN rr.return_time ELSE '18:00' END)::timestamp
            AT TIME ZONE 'Asia/Seoul') AS ret_at,
           ((rr.end_date::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Seoul') AS morning_at,
           (rr.status = 'return_requested'
            AND EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = rr.id)) AS has_sub
      FROM rental_reservations rr
      JOIN products p ON p.id = rr.product_id
      LEFT JOIN products ppar ON ppar.id = p.parent_product_id
     WHERE rr.status IN ('in_use', 'return_requested')
       AND rr.end_date IS NOT NULL
       AND rr.return_method IN ('epost', 'delivery', 'crazydelivery', 'airport', 'quick', 'locker')
  ),
  due AS (
    SELECT b.*,
           CASE
             WHEN b.rm IN ('epost','delivery','crazydelivery','airport') AND b.rstatus = 'in_use'
                  AND now() >= b.morning_at AND now() < b.morning_at + interval '24 hours' THEN 'courier'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '3 hours' AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'quick_5h'
             WHEN b.rm = 'locker' AND now() >= b.ret_at - interval '3 hours' AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'locker_2h'
           END AS st
      FROM base b
  ),
  pick AS (
    SELECT d.* FROM due d
     WHERE d.st IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM return_notice_logs l WHERE l.reservation_id = d.rid AND l.stage = d.st)
     ORDER BY d.ret_at
     LIMIT p_limit
  ),
  ins AS (
    INSERT INTO return_notice_logs (reservation_id, stage)
    SELECT pick.rid, pick.st FROM pick
    ON CONFLICT DO NOTHING
    RETURNING return_notice_logs.reservation_id AS rid2, return_notice_logs.stage AS st2
  )
  SELECT pk.rid, pk.uid, ins.st2, pk.rm, pk.pname, pk.ret_at
    FROM ins JOIN pick pk ON pk.rid = ins.rid2 AND pk.st = ins.st2;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_return_notice_targets(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_return_notice_targets(integer) TO service_role;

UPDATE push_notification_config SET label = '반납 안내(퀵 3시간 전)' WHERE notify_type = 'return_notice_quick_5h';
UPDATE push_notification_config SET label = '반납 안내(무인함 3시간 전)' WHERE notify_type = 'return_notice_locker';
