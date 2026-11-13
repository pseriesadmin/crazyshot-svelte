-- Migration #822: 반납정보 등록요청 타이머 — 방문·퀵·무인보관함 반납 고객에게 반납 시각 N시간 전 '반납정보 등록요청' 발송 (2026-11-13, Stephen 지시)
--
-- 동작: CMS 푸시알림 설정 '반납 접수 요청' 행에서 방식별(방문·퀵·무인함) '반납 시각 N시간 전'(1~24)을 지정하면,
--       그 시각부터(반납 시각 1시간 뒤까지) 아직 반납 기록이 없는 대여중(또는 반납요청) 예약에 등록요청(채팅카드+푸시+문자, 반납등록 화면 링크)을 주문당 1번 보낸다.
--       값이 비어 있으면(NULL) 그 방식은 보내지 않는다. 택배류 반납은 기존대로 [반납 접수] 전환 시 발송 — 이 타이머와 무관.
-- 변경:
--   1) return_notice_logs.stage 허용값에 reg_visit · reg_quick · reg_locker 추가(기존 단계 안내와 키가 달라 서로의 중복 방지에 영향 없음).
--   2) claim_return_register_targets(p_visit_hours, p_quick_hours, p_locker_hours, p_limit) — claim_return_notice_targets(#812)와 같은 반환 모양·같은 주문 묶음 규칙
--      (같은 주문·같은 반납일·같은 단계의 대표 1건만 반환, 형제도 함께 기록, product_name '대표 외 N개 상품').
--      기록이 있는 상품(고객 제출·관리자 대리 등록)·면제(return_record_exempt) 예약은 제외. 반납 시각 형식 오류·없음은 18:00.
--      release_return_notice_claim(#812)이 단계 키로 동작하므로 되돌리기도 그대로 재사용된다.
-- 변경하지 않는 것: claim_return_notice_targets·get_return_remind_targets·기존 단계 안내 전부.
-- 권한: 서버 전용 — REVOKE ALL FROM PUBLIC, anon, authenticated · GRANT service_role.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 코드(크론)보다 먼저 적용한다. 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK(코드를 먼저 되돌린 뒤): DROP FUNCTION IF EXISTS public.claim_return_register_targets(integer, integer, integer, integer);
--   DELETE FROM public.return_notice_logs WHERE stage IN ('reg_visit','reg_quick','reg_locker');
--   ALTER TABLE public.return_notice_logs DROP CONSTRAINT return_notice_logs_stage_check;
--   ALTER TABLE public.return_notice_logs ADD CONSTRAINT return_notice_logs_stage_check CHECK (stage IN ('courier','quick_5h','quick_2h','quick_1h','locker_2h'));

ALTER TABLE public.return_notice_logs DROP CONSTRAINT IF EXISTS return_notice_logs_stage_check;
ALTER TABLE public.return_notice_logs
  ADD CONSTRAINT return_notice_logs_stage_check
  CHECK (stage IN ('courier','quick_5h','quick_2h','quick_1h','locker_2h','reg_visit','reg_quick','reg_locker'));

CREATE OR REPLACE FUNCTION public.claim_return_register_targets(
  p_visit_hours  integer,
  p_quick_hours  integer,
  p_locker_hours integer,
  p_limit        integer DEFAULT 50
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
           CASE rr.return_method WHEN 'visit' THEN p_visit_hours WHEN 'quick' THEN p_quick_hours WHEN 'locker' THEN p_locker_hours END AS hrs
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
    SELECT b.* FROM base b
     WHERE b.hrs IS NOT NULL
       AND now() >= b.ret_at - make_interval(hours => b.hrs)
       AND now() <  b.ret_at + interval '1 hour'
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

REVOKE ALL ON FUNCTION public.claim_return_register_targets(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_return_register_targets(integer, integer, integer, integer) TO service_role;
