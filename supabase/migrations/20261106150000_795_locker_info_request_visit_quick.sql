-- Migration #795: '무인보관함 반납 정보 요청'(return_notice_locker, 단계 키 locker_2h) 발송 대상 변경 (2026-11-06, Stephen 확정)
--
-- 변경 전(#736): 반납 방식이 'locker'(고객이 무인함 반납 선택)인 예약에 반납 일시 3시간 전 1회.
-- 변경 후:
--   · 'locker' 반납 선택 고객에게는 더 이상 보내지 않는다(이 알림은 방문·퀵서비스 예약 전용).
--   · 방문('visit')·퀵서비스('quick') 예약에 반납 시각 1시간 전 ~ 반납 시각 +1시간 안에 1회.
--     단, 관리자가 이 반납용으로 무인함 비밀번호를 이미 저장한 예약은 제외한다
--     (그 예약은 '무인보관함 반납 안내'(locker_return_guide, #787)가 같은 시각에 나간다 — 반납용 발송 대상: return·both·NULL).
--     이미 고객 제출이 있는 예약(has_sub)도 제외한다.
--   · 단계 키는 기존 'locker_2h' 를 재사용한다(return_notice_logs 의 CHECK·스키마 변경 없음 — 방문·퀵 예약은 지금까지 이 키로 기록된 적이 없다).
-- 그대로인 것: 택배류 'courier', 퀵 3시간 전 'quick_5h', 방문 매일 09시 return_remind 크론.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK: #736 본문으로 claim_return_notice_targets 를 CREATE OR REPLACE.

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
            AND EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = rr.id)) AS has_sub,
           -- 관리자가 반납용 무인함 정보를 저장해 둔 예약인지(#787 반납용 발송 대상과 같은 기준: 비밀번호 있음 AND legs 가 return·both·NULL)
           (rr.locker_password IS NOT NULL
            AND (rr.locker_guide_legs IS NULL OR rr.locker_guide_legs IN ('return', 'both'))) AS has_admin_locker
      FROM rental_reservations rr
      JOIN products p ON p.id = rr.product_id
      LEFT JOIN products ppar ON ppar.id = p.parent_product_id
     WHERE rr.status IN ('in_use', 'return_requested')
       AND rr.end_date IS NOT NULL
       AND rr.return_method IN ('epost', 'delivery', 'crazydelivery', 'airport', 'quick', 'visit')
  ),
  due AS (
    -- 한 예약이 여러 단계에 동시에 해당할 수 있다(퀵: 3시간 전 quick_5h 와 1시간 전 locker_2h 창이 겹침) → 단계마다 한 행씩 만든다.
    -- (CASE 하나로 고르면 퀵은 quick_5h 가 먼저 맞아 locker_2h 가 영영 선택되지 않는다.)
    SELECT b.*, s.st
      FROM base b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.rm IN ('epost','delivery','crazydelivery','airport') AND b.rstatus = 'in_use'
                   AND now() >= b.morning_at AND now() < b.morning_at + interval '24 hours' THEN 'courier' END),
        (CASE WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '3 hours' AND now() < b.ret_at + interval '1 hour'
                   AND NOT b.has_sub THEN 'quick_5h' END),
        (CASE WHEN b.rm IN ('visit', 'quick') AND now() >= b.ret_at - interval '1 hour' AND now() < b.ret_at + interval '1 hour'
                   AND NOT b.has_sub AND NOT b.has_admin_locker THEN 'locker_2h' END)
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
