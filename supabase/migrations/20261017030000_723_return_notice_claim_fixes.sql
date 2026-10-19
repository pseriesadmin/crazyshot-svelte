-- Migration #723: #722 검수(sp3) 보완 — 선점 후보 LIMIT 정합·09시 알림 범위·시각 파싱·courier 상태 (2026-10-17)
--   M-1: 이미 발송한 (예약, 단계)가 LIMIT 슬롯을 차지해 뒤쪽 신규 건이 선점되지 못하던 문제 → 후보 단계에서 return_notice_logs 를 제외한 뒤 LIMIT.
--   M-2: 기존 09시 return_remind 를 "방문·미지정"으로 좁히면 신규 크론이 맡지 않는 방식 키가 양쪽에서 빠질 수 있음 → 신규 크론이 맡는 방식만 제외하는 반대 조건.
--   minor: return_time 범위 검증(25:99 같은 값이 캐스트 예외로 전체 선점을 막던 문제) / courier 단계는 대여중(in_use)만 / 제출 있음 판정은 "반납요청 상태 + 제출 존재".
-- ROLLBACK: #722 본문으로 두 함수를 CREATE OR REPLACE 로 되돌린다.

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
           ((rr.end_date::timestamp + interval '18 hours') AT TIME ZONE 'Asia/Seoul') AS eve_at,
           -- 고객이 이미 반납요청까지 마친 건(제출 존재 + 반납요청 상태). 제출만 있고 전환이 실패한 대여중 건은 계속 안내한다.
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
                  AND now() >= b.eve_at AND now() < b.eve_at + interval '18 hours' THEN 'courier'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '5 hours' AND now() < b.ret_at - interval '2 hours' THEN 'quick_5h'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '2 hours' AND now() < b.ret_at - interval '1 hour'  THEN 'quick_2h'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '1 hour'  AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'quick_1h'
             WHEN b.rm = 'locker' AND now() >= b.ret_at - interval '2 hours' AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'locker_2h'
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

CREATE OR REPLACE FUNCTION public.get_return_remind_targets(p_limit integer DEFAULT 100)
 RETURNS TABLE(reservation_id bigint, user_id uuid, phone text, product_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    rr.id             AS reservation_id,
    rr.user_id,
    up.phone,
    COALESCE(ppar.name, p.name)            AS product_name
  FROM rental_reservations rr
  LEFT JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN products        p  ON p.id  = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id
  WHERE rr.end_date = CURRENT_DATE
    AND rr.status IN ('in_use', 'return_requested')
    -- 신규 반납 알림 크론(return-notice)이 맡는 방식만 제외 — 그 밖의 방식(방문·미지정·기타 키)은 기존 09시 안내 유지 -- return-notice-723
    AND (rr.return_method IS NULL OR rr.return_method NOT IN ('epost', 'delivery', 'crazydelivery', 'airport', 'quick', 'locker'))
    AND NOT EXISTS (
      SELECT 1
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.user_id  = rr.user_id
        AND cm.action_payload->>'type'       = 'return_remind'
        AND cm.action_payload->>'action_url' = '/account/rental/' || rr.id::TEXT || '/history'
        AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
        AND cm.created_at <  (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ
    )
  LIMIT p_limit;
END;
$function$;
