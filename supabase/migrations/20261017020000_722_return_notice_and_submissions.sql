-- Migration #722: 반납 방식별 알림 선점 + 고객 반납 제출(사진·체크리스트·무인함 정보) + 비공개 증빙 버킷 (2026-10-17, 1단계)
--
-- 정책(Stephen 확정, 플랜 ~/.claude/plans/…mossy-lovelace.md):
--   · 택배류: 반납 마지막 날 18:00(KST) 안내 / 퀵: 반납시각 5·2·1시간 전 / 무인함: 2시간 전.
--   · 기존 매일 09시 return_remind는 방문(·방식 미지정)만 남긴다 — 나머지 방식은 이 신규 알림이 대신한다.
--   · 고객 제출(반납요청)은 예약당 최신 1건. 무인함 번호·비밀번호는 CMS 안내용 locker_* 와 별도 저장(덮어쓰기 금지).
--   · 증빙은 비공개 버킷(return-evidence) + 서버가 발급하는 서명 URL로만 열람.
-- 다음 단계(2단계: 검수 승인·완료 알림 이동, 3단계: CS 사전 접수)는 이 마이그레이션에 포함하지 않는다.
-- ROLLBACK: DROP FUNCTION claim_return_notice_targets/release_return_notice_claim/send_return_notice_card;
--           DROP TABLE reservation_return_media, reservation_return_submissions, return_notice_logs;
--           get_return_remind_targets는 방문 한정 줄(-- return-notice-722)만 제거; DELETE FROM storage.buckets WHERE id='return-evidence'(빈 버킷일 때).

-- 1) 단계별 발송 선점 로그 — (예약, 단계)당 1회. 크론이 INSERT … ON CONFLICT DO NOTHING 으로 원자 선점한다.
CREATE TABLE IF NOT EXISTS public.return_notice_logs (
  reservation_id bigint NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  stage          text   NOT NULL CHECK (stage IN ('courier','quick_5h','quick_2h','quick_1h','locker_2h')),
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, stage)
);
ALTER TABLE public.return_notice_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.return_notice_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.return_notice_logs TO service_role;

-- 2) 고객 반납 제출(예약당 최신 1건)
CREATE TABLE IF NOT EXISTS public.reservation_return_submissions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL UNIQUE REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  method         text   NOT NULL,
  checklist      jsonb  NOT NULL DEFAULT '[]'::jsonb,
  locker_number  text,
  locker_password text,
  submitted_by   uuid,
  submitted_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reservation_return_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_return_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_return_submissions TO service_role;

-- 3) 제출 증빙(사진·영상) — 항목별(item_key) 정렬
CREATE TABLE IF NOT EXISTS public.reservation_return_media (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id  bigint NOT NULL REFERENCES public.reservation_return_submissions(id) ON DELETE CASCADE,
  reservation_id bigint NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  item_key       text   NOT NULL,
  storage_path   text   NOT NULL,
  kind           text   NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video')),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservation_return_media_submission_idx ON public.reservation_return_media (submission_id, sort_order);
ALTER TABLE public.reservation_return_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_return_media FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_return_media TO service_role;

-- 4) 비공개 증빙 버킷(사진·영상). storage.objects 정책은 만들지 않는다 — 업로드·열람 모두 서버(서비스 롤) 경유.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'return-evidence', 'return-evidence', false, 104857600,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- 5) 방식별 알림 대상 선점 — 반납 시각(end_date + return_time, KST)과 return_method 로 단계를 산출하고 한 번에 선점한다.
--    제출이 이미 있으면 courier·quick_1h·locker_2h 는 보내지 않는다(고객이 이미 행동함). quick_5h·quick_2h 는 제출 여부와 무관.
--    return_time 이 비었거나 형식이 틀리면 18:00 으로 본다. 단계 창이 지나면(크론 지연) 해당 단계는 건너뛴다.
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
    SELECT rr.id AS rid, rr.user_id AS uid, rr.return_method AS rm,
           COALESCE(ppar.name, p.name) AS pname,
           ((rr.end_date::text || ' ' ||
             CASE WHEN rr.return_time ~ '^[0-9]{1,2}:[0-9]{2}$' THEN rr.return_time ELSE '18:00' END)::timestamp
            AT TIME ZONE 'Asia/Seoul') AS ret_at,
           ((rr.end_date::timestamp + interval '18 hours') AT TIME ZONE 'Asia/Seoul') AS eve_at,
           EXISTS (SELECT 1 FROM reservation_return_submissions s WHERE s.reservation_id = rr.id) AS has_sub
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
             WHEN b.rm IN ('epost','delivery','crazydelivery','airport')
                  AND now() >= b.eve_at AND now() < b.eve_at + interval '18 hours' AND NOT b.has_sub THEN 'courier'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '5 hours' AND now() < b.ret_at - interval '2 hours' THEN 'quick_5h'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '2 hours' AND now() < b.ret_at - interval '1 hour'  THEN 'quick_2h'
             WHEN b.rm = 'quick' AND now() >= b.ret_at - interval '1 hour'  AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'quick_1h'
             WHEN b.rm = 'locker' AND now() >= b.ret_at - interval '2 hours' AND now() < b.ret_at + interval '1 hour' AND NOT b.has_sub THEN 'locker_2h'
           END AS st
      FROM base b
  ),
  pick AS (
    SELECT * FROM due WHERE st IS NOT NULL ORDER BY ret_at LIMIT p_limit
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

-- 전달에 실패한 건의 선점을 되돌려 다음 크론(10분 뒤)에서 재시도한다.
CREATE OR REPLACE FUNCTION public.release_return_notice_claim(p_reservation_id bigint, p_stage text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM return_notice_logs WHERE reservation_id = p_reservation_id AND stage = p_stage;
$$;

-- 6) 방식별 안내 채팅카드 — 서버가 조립한 문장·버튼을 그대로 카드로 남긴다(공개 RPC 시그니처는 건드리지 않음, 임의 문장 주입 방지를 위해 service_role 전용).
--    카드 타입은 기존 RESERVATION_STATUS_CARD(버튼 라벨·이동 주소 지원)를 재사용해 ActionCard 변경이 필요 없다.
CREATE OR REPLACE FUNCTION public.send_return_notice_card(
  p_reservation_id bigint, p_notify_type text, p_content text, p_button_label text, p_action_url text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    uuid;
  v_product    text;
  v_end_date   date;
  v_code       text;
  v_session_id uuid;
BEGIN
  SELECT rr.user_id, COALESCE(ppar.name, p.name), rr.end_date::date,
         COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::text, 5, '0'))
    INTO v_user_id, v_product, v_end_date, v_code
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id
    LEFT JOIN products ppar ON ppar.id = p.parent_product_id
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  v_session_id := public.find_or_create_general_chat_session(v_user_id, p_reservation_id);

  INSERT INTO chat_messages (session_id, sender_type, message_type, content, action_payload, is_read)
  VALUES (
    v_session_id, 'admin', 'action_card', left(p_content, 2000),
    jsonb_build_object(
      'type',            'RESERVATION_STATUS_CARD',
      'notify_type',     p_notify_type,
      'reservation_id',  p_reservation_id::text,
      'reservation_no',  v_code,
      'product_name',    v_product,
      'return_deadline', v_end_date::text,
      'action_url',      p_action_url,
      'button_label',    p_button_label
    ),
    false
  );

  UPDATE chat_sessions SET updated_at = now() WHERE id = v_session_id;
  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$$;

-- 7) 서버 전용 함수 권한 — anon·authenticated 실행 불가, service_role 만(GATE: has_function_privilege 로 확인)
REVOKE ALL ON FUNCTION public.claim_return_notice_targets(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_return_notice_claim(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_return_notice_card(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_return_notice_targets(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_return_notice_claim(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_return_notice_card(bigint, text, text, text, text) TO service_role;

-- 8) 기존 매일 09시 반납 예정 알림은 방문(·방식 미지정)만 — 나머지 방식은 위 신규 알림이 대신한다. (라이브 정의 그대로 + 방식 조건 1줄)
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
    AND (rr.return_method IS NULL OR rr.return_method = 'visit') -- return-notice-722
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

-- 9) CMS 푸시알림 설정에 5개 유형 등록(켜짐 기본, 기존 행 미변경)
INSERT INTO push_notification_config (category, notify_type, label, push_enabled) VALUES
  ('customer_lifecycle', 'return_notice_courier',  '반납 안내(택배)',          true),
  ('customer_lifecycle', 'return_notice_quick_5h', '반납 안내(퀵 5시간 전)',   true),
  ('customer_lifecycle', 'return_notice_quick_2h', '반납 준비 요청(퀵 2시간 전)', true),
  ('customer_lifecycle', 'return_notice_quick_1h', '반납 재촉(퀵 1시간 전)',   true),
  ('customer_lifecycle', 'return_notice_locker',   '반납 안내(무인함 2시간 전)', true)
ON CONFLICT (notify_type) DO NOTHING;
