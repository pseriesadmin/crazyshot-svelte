-- Migration #767(구 #764, 번호 충돌로 재번호): 법정 보존 기간 만료 도래 리포트 + 관리자 알림 대기열 (2026-10-24)
--
-- 정책 정본: .claude/plan/회원 삭제·탈퇴 정책 및 익명 전환 구현 계획(2026-10-24).md
--   · 익명 전환된 계정의 거래 기록(예약·주문·결제)은 5년, 상담 기록은 3년 보존(실서버 개인정보처리방침)
--   · 만료가 도래해도 자동으로 지우지 않는다 — 내부 타이머가 도래 목록을 계산해 관리자에게 알리고, CMS 리포트 화면에서 사람이 확인한다
--   · 기준일: 그 계정의 가장 최근 거래(예약·주문·결제) 생성일 +5년 / 가장 최근 상담 활동일 +3년 (모든 기록이 만료된 시점)
--   · 90일 이내 도래 예정('soon')도 함께 보여 준다

CREATE OR REPLACE FUNCTION public.cms_retention_report(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id           uuid,
  member_code       text,
  purged_at         timestamptz,
  reservation_count bigint,
  last_txn_at       timestamptz,
  txn_expires_at    timestamptz,
  txn_state         text,
  last_chat_at      timestamptz,
  chat_expires_at   timestamptz,
  chat_state        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.member_code, s.withdrawal_purged_at, s.cnt,
         s.last_txn, s.last_txn + INTERVAL '5 years',
         CASE WHEN s.last_txn IS NULL THEN NULL
              WHEN s.last_txn + INTERVAL '5 years' <= now() THEN 'due'
              WHEN s.last_txn + INTERVAL '5 years' <= now() + INTERVAL '90 days' THEN 'soon'
              ELSE 'keep' END,
         s.last_chat, s.last_chat + INTERVAL '3 years',
         CASE WHEN s.last_chat IS NULL THEN NULL
              WHEN s.last_chat + INTERVAL '3 years' <= now() THEN 'due'
              WHEN s.last_chat + INTERVAL '3 years' <= now() + INTERVAL '90 days' THEN 'soon'
              ELSE 'keep' END
  FROM (
    SELECT up.id, up.member_code, up.withdrawal_purged_at,
           t.cnt, t.last_txn, c.last_chat
      FROM user_profiles up
      LEFT JOIN LATERAL (
        SELECT (SELECT count(*) FROM rental_reservations WHERE user_id = up.id) AS cnt,
               greatest(
                 (SELECT max(created_at) FROM rental_reservations   WHERE user_id = up.id),
                 (SELECT max(created_at) FROM orders                WHERE user_id = up.id),
                 (SELECT max(created_at) FROM payment_transactions  WHERE user_id = up.id)
               ) AS last_txn
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT max(COALESCE(last_message_at, created_at)) AS last_chat FROM chat_sessions WHERE user_id = up.id
      ) c ON true
     WHERE up.withdrawal_status = 'purged'
       AND (p_user_id IS NULL OR up.id = p_user_id)
  ) s
  WHERE s.last_txn IS NOT NULL OR s.last_chat IS NOT NULL
  ORDER BY LEAST(s.last_txn + INTERVAL '5 years', s.last_chat + INTERVAL '3 years') NULLS LAST;
$$;

-- 관리자 알림 대기열 — 같은 (계정, 종류)는 한 번만 알린다
CREATE TABLE IF NOT EXISTS public.retention_expiry_alerts (
  user_id    uuid        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('transaction', 'chat')),
  alerted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
ALTER TABLE public.retention_expiry_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retention_expiry_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.retention_expiry_alerts TO service_role;

-- 만료가 도래했고(due) 아직 알리지 않은 건
CREATE OR REPLACE FUNCTION public.cms_retention_new_due()
RETURNS TABLE (user_id uuid, kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.user_id, 'transaction'::text
    FROM cms_retention_report() r
   WHERE r.txn_state = 'due'
     AND NOT EXISTS (SELECT 1 FROM retention_expiry_alerts a WHERE a.user_id = r.user_id AND a.kind = 'transaction')
  UNION ALL
  SELECT r.user_id, 'chat'::text
    FROM cms_retention_report() r
   WHERE r.chat_state = 'due'
     AND NOT EXISTS (SELECT 1 FROM retention_expiry_alerts a WHERE a.user_id = r.user_id AND a.kind = 'chat');
$$;

REVOKE ALL ON FUNCTION public.cms_retention_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_retention_report(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cms_retention_new_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_retention_new_due() TO service_role;

-- ── 롤백 ──
-- DROP FUNCTION public.cms_retention_new_due(); DROP FUNCTION public.cms_retention_report(uuid); DROP TABLE public.retention_expiry_alerts;
