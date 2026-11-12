-- Migration #812: 반납 안내 알림을 "주문(예약코드) 1개당 1번"으로 — 상품이 여러 개여도 상품별로 쪼개 보내지 않는다 (2026-11-12, Stephen 지시)
--
-- 증상: 상품 3개짜리 한 주문(예약 392·393·394)에서 '무인보관함 반납 안내'·'반납 예정 안내'가 상품마다 3번씩 발송됐다(Production 조회로 확인).
-- 원인: 반납 안내 두 크론의 대상 함수가 예약 행(상품 1개 = 예약 1행) 단위로 대상을 뽑고, 중복 방지도 "그 예약 id" 기준이었다.
--   · /api/cron/return-notice → claim_return_notice_targets : (예약, 단계)당 1회 선점
--   · /api/cron/return-remind → get_return_remind_targets   : 예약 행 + "그 예약 id 의 오늘 채팅카드" 유무
-- 변경(두 함수만 교체, 반환 컬럼·권한·크론 코드 불변):
--   1. claim_return_notice_targets
--      · 같은 주문(order_items.order_id) + 같은 반납일 + 같은 단계에서 지금 보낼 예약이 여러 건이면 대표 1건(가장 작은 예약 id)만 반환한다.
--      · 대표를 뽑는 순간 같은 주문의 나머지 "지금 대상" 예약도 return_notice_logs 에 함께 기록해 다시 뽑히지 않게 한다.
--      · 그 주문·반납일의 어느 예약이든 이 단계 기록이 이미 있으면(예: 형제 시각이 달라 늦게 대상이 된 경우) 다시 보내지 않는다.
--      · product_name 은 묶음이면 '대표 상품명 외 N개 상품'(1건이면 기존 그대로).
--      · 주문에 묶이지 않은 예약(order_items 없음)은 자기 id 를 키로 단독 취급 → 기존 동작 그대로.
--   2. get_return_remind_targets
--      · 같은 주문의 대상 예약 중 대표 1건만 반환 + 같은 주문의 어느 예약이든 오늘 return_remind 채팅카드가 이미 있으면 제외한다.
--      · product_name 은 같은 '대표 상품명 외 N개 상품' 규칙.
--   3. release_return_notice_claim — 대표 발송이 실패해 선점을 되돌릴 때 같은 묶음의 형제 기록도 함께 지운다(재시도 보장, sp3 검수 B1).
-- 변경하지 않는 것: 반납 단계·시각 산식(#736·#796), 방식별 대상(택배류/퀵/방문), 두 크론 코드, 채팅카드·푸시·문자 허브.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh).
-- ROLLBACK: claim_return_notice_targets 는 20261106170000_796_locker_reminder_all_visit_quick.sql 본문,
--           get_return_remind_targets 는 20261017030000_723_return_notice_claim_fixes.sql 본문(+ #658 의 부모 상품명 COALESCE 패치,
--           즉 현재 Stage 의 pg_get_functiondef 기준 이 파일 이전 본문)으로 CREATE OR REPLACE.

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
    SELECT rr.id AS rid, rr.user_id AS uid, rr.return_method AS rm, rr.status AS rstatus, rr.end_date AS edate,
           -- 주문 묶음 키: 예약이 속한 주문 id, 주문 연결이 없으면 자기 id(단독 취급)
           COALESCE((SELECT MIN(oi.order_id)::text FROM order_items oi WHERE oi.reservation_id = rr.id),
                    'r' || rr.id::text) AS okey,
           COALESCE(ppar.name, p.name) AS pname,
           ((rr.end_date::text || ' ' ||
             CASE WHEN rr.return_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN rr.return_time ELSE '18:00' END)::timestamp
            AT TIME ZONE 'Asia/Seoul') AS ret_at,
           ((rr.end_date::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Seoul') AS morning_at,
           (rr.status = 'return_requested'
            AND (EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = rr.id)
                 OR EXISTS (SELECT 1 FROM reservation_return_admin_entries e WHERE e.reservation_id = rr.id))) AS has_sub  -- 관리자 대리 등록도 등록으로 본다(2026-11-12, Stephen — 방문 반납 등)
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
  cand AS (
    -- 자기 기록이 없고, 같은 주문·같은 반납일의 형제도 이 단계 기록이 없는 대상만
    SELECT d.* FROM due d
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
    -- 주문·반납일·단계마다 대표 1건(가장 작은 예약 id) + 묶음 건수
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
    -- 대표가 속한 묶음 전체(대표 + 형제)를 한 번에 기록 — 형제가 다시 뽑히지 않게 한다
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

REVOKE ALL ON FUNCTION public.claim_return_notice_targets(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_return_notice_targets(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_return_remind_targets(p_limit integer DEFAULT 100)
RETURNS TABLE(reservation_id bigint, user_id uuid, phone text, product_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT t.rid, t.uid, t.phone,
         CASE WHEN t.cnt > 1 THEN t.pname || ' 외 ' || (t.cnt - 1)::text || '개 상품' ELSE t.pname END
    FROM (
      SELECT DISTINCT ON (g.okey)
             rr.id AS rid, rr.user_id AS uid, up.phone AS phone,
             COALESCE(ppar.name, p.name) AS pname,
             COUNT(*) OVER (PARTITION BY g.okey) AS cnt
        FROM rental_reservations rr
        LEFT JOIN user_profiles up ON up.id = rr.user_id
        LEFT JOIN products p ON p.id = rr.product_id
        LEFT JOIN products ppar ON ppar.id = p.parent_product_id
        CROSS JOIN LATERAL (
          SELECT COALESCE((SELECT MIN(oi.order_id)::text FROM order_items oi WHERE oi.reservation_id = rr.id),
                          'r' || rr.id::text) AS okey
        ) g
       WHERE rr.end_date = CURRENT_DATE
         AND rr.status IN ('in_use', 'return_requested')
         -- 신규 반납 알림 크론(return-notice)이 맡는 방식만 제외 — 그 밖의 방식(방문·미지정·기타 키)은 기존 09시 안내 유지 -- return-notice-723
         AND (rr.return_method IS NULL OR rr.return_method NOT IN ('epost', 'delivery', 'crazydelivery', 'airport', 'quick', 'locker'))
         AND NOT EXISTS (
           -- 오늘 같은 주문의 어느 예약으로든 반납 예정 채팅카드가 이미 나갔으면 제외(대표 1건만 보낸 뒤 형제가 다시 뽑히지 않게)
           SELECT 1
             FROM chat_sessions cs
             JOIN chat_messages cm ON cm.session_id = cs.id
            WHERE cs.user_id = rr.user_id
              AND cm.action_payload->>'type' = 'return_remind'
              AND cm.created_at >= CURRENT_DATE::TIMESTAMPTZ
              AND cm.created_at <  (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ
              AND cm.action_payload->>'action_url' IN (
                SELECT '/account/rental/' || s.id::text || '/history'
                  FROM (SELECT rr.id AS id
                        UNION
                        SELECT oi3.reservation_id
                          FROM order_items oi3
                         WHERE oi3.order_id::text = g.okey AND oi3.reservation_id IS NOT NULL) s)
         )
       ORDER BY g.okey, rr.id
    ) t
   ORDER BY t.rid
   LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_return_remind_targets(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_return_remind_targets(integer) TO service_role;

-- 3. release_return_notice_claim — 대표 발송이 실패해 선점을 되돌릴 때 같은 묶음(같은 주문·같은 반납일·같은 단계)의 형제 기록도 함께 되돌린다.
--    (sp3 검수 B1: 대표 기록만 지우면 형제 기록이 남아 그 주문의 해당 단계 안내가 영구 누락됐다. 대표를 뽑을 때 형제 기록을 같이 남기므로 되돌릴 때도 같이 지운다.
--     형제의 기록은 방금 이 대표를 뽑으며 생긴 것뿐이다 — 이전 발송분이 있었다면 cand 가 대표를 애초에 뽑지 않았다.)
-- ROLLBACK: DELETE FROM return_notice_logs WHERE reservation_id = p_reservation_id AND stage = p_stage; (SQL 함수 본문 1줄, 20261017020000_722 와 동일)
CREATE OR REPLACE FUNCTION public.release_return_notice_claim(p_reservation_id bigint, p_stage text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM return_notice_logs l
   WHERE l.stage = p_stage
     AND (l.reservation_id = p_reservation_id
          OR l.reservation_id IN (
               SELECT oi2.reservation_id
                 FROM order_items oi2
                 JOIN rental_reservations r2 ON r2.id = oi2.reservation_id
                WHERE oi2.reservation_id IS NOT NULL
                  AND oi2.order_id IN (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id)
                  AND r2.end_date = (SELECT r1.end_date FROM rental_reservations r1 WHERE r1.id = p_reservation_id)));
$function$;

REVOKE ALL ON FUNCTION public.release_return_notice_claim(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_return_notice_claim(bigint, text) TO service_role;
