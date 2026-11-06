-- Migration #796: '무인보관함 반납 안내'(return_notice_locker, 단계 키 locker_2h) 리마인드 대상 확정 (2026-11-06, Stephen 교통정리)
--
-- #795 대비 변경: "관리자가 반납용 무인함 정보를 저장한 예약 제외(NOT has_admin_locker)" 조건을 제거한다.
--   · 이 알림은 방문·퀵서비스 모든 예약에 반납 시각 1시간 전 1회 가는 '무인함 반납도 가능' 리마인드다(이미 반납정보를 제출한 건만 제외).
--   · 관리자가 저장한 번호+비밀번호를 보내는 알림은 별도: '무인보관함 반납정보 제공안내'(locker_return_guide, #787 로직 그대로 — 이 마이그레이션이 건드리지 않는다).
-- 그대로인 것: 택배류 courier, 퀵 3시간 전 quick_5h, 무인함('locker') 반납 선택 고객 발송 중단(#795), 단계 키 locker_2h 재사용.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). Production 은 #795 → #796 순서로 적용한다.
-- ROLLBACK: #795 본문으로 claim_return_notice_targets 를 CREATE OR REPLACE.

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
       AND rr.return_method IN ('epost', 'delivery', 'crazydelivery', 'airport', 'quick', 'visit')
  ),
  due AS (
    -- 한 예약이 여러 단계에 동시에 해당할 수 있다(퀵: quick_5h 와 locker_2h) → 단계마다 한 행씩 만든다.
    SELECT b.*, s.st
      FROM base b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.rm IN ('epost','delivery','crazydelivery','airport') AND b.rstatus = 'in_use'
                   AND now() >= b.morning_at AND now() < b.morning_at + interval '24 hours' THEN 'courier' END),
        (CASE WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '3 hours' AND now() < b.ret_at + interval '1 hour'
                   AND NOT b.has_sub THEN 'quick_5h' END),
        (CASE WHEN b.rm IN ('visit', 'quick') AND now() >= b.ret_at - interval '1 hour' AND now() < b.ret_at + interval '1 hour'
                   AND NOT b.has_sub THEN 'locker_2h' END)
      ) AS s(st)
     WHERE s.st IS NOT NULL
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
