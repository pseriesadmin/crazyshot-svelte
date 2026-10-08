-- Migration 665: 크레이지챗 접수형(S3) — 접수 기록 테이블 + 관찰 기록 분류 확장 (2026-10-07, Stephen 승인 — GATE B)
--
-- 크레이지챗(채팅 에이전트)은 고객의 "예약 시간 변경 요청"·"연장 문의"를 접수만 하고, 실제 변경은 관리자가 기존 절차로 처리한다.
--   · 에이전트 코드는 이 테이블에만 쓴다(예약·결제·계약 테이블에는 쓰지 않는다 — 승인 우회 불가).
--   · 고객 원문은 저장하지 않는다. 관리자는 message_id로 채팅 원문을 열어 본다. reservation_code는 "본인 예약"으로 확인된 값만 저장한다.
--   · 같은 고객이 같은 종류·같은 예약에 대기(pending) 요청이 있으면 새로 만들지 않는다(부분 UNIQUE).
--   · 처리자·처리 시각은 이 테이블에 남긴다(관리자 감사 로그 확장은 S5, Stephen 확정).
-- 롤백: DROP TABLE public.chat_agent_requests; 관찰 기록 CHECK는 664 정의로 되돌린다(아래 주석).

CREATE TABLE IF NOT EXISTS public.chat_agent_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        uuid        NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  message_id        uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('time_change', 'extend')),
  reservation_code  text,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
  resolved_by       uuid,
  resolved_at       timestamptz,
  -- 대기 중이면 처리 정보 없음 / 처리됐으면 처리 시각 필수
  CONSTRAINT chat_agent_requests_resolved_consistency CHECK ((status = 'pending') = (resolved_at IS NULL))
);

COMMENT ON TABLE public.chat_agent_requests IS
  '크레이지챗 접수 기록(서버 전용). 고객 원문 미저장 — message_id로 채팅 원문 참조. 에이전트는 이 테이블에만 쓰고 예약·결제·계약은 관리자가 처리한다';

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_agent_requests_message
  ON public.chat_agent_requests (message_id);
-- 같은 고객·종류·예약의 대기 요청은 1건만(예약번호 없는 요청은 빈 문자열로 묶는다)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_agent_requests_pending
  ON public.chat_agent_requests (user_id, kind, COALESCE(reservation_code, ''))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_chat_agent_requests_pending_created
  ON public.chat_agent_requests (created_at DESC)
  WHERE status = 'pending';

-- 서버 전용: RLS 켜고 정책 없음 + 일반 역할 권한 제거 (607·608·656·662·664 패턴)
ALTER TABLE public.chat_agent_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_agent_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.chat_agent_requests FROM anon, authenticated;
GRANT ALL ON TABLE public.chat_agent_requests TO service_role;

-- 관찰 기록(664)을 조회형·접수형 공용으로 확장: 분류(intent)와 결과(outcome) 값 추가
ALTER TABLE public.crazychat_query_observations DROP CONSTRAINT IF EXISTS crazychat_query_observations_intent_check;
ALTER TABLE public.crazychat_query_observations
  ADD CONSTRAINT crazychat_query_observations_intent_check
  CHECK (intent IN ('reservation_status', 'return_date', 'doc_status', 'payment_status', 'time_change', 'extend', 'call_agent', 'doc_guide'));

ALTER TABLE public.crazychat_query_observations DROP CONSTRAINT IF EXISTS crazychat_query_observations_outcome_check;
ALTER TABLE public.crazychat_query_observations
  ADD CONSTRAINT crazychat_query_observations_outcome_check
  CHECK (outcome IN ('answered', 'not_found', 'no_data', 'error', 'registered', 'duplicate', 'need_code'));

COMMENT ON TABLE public.crazychat_query_observations IS
  '크레이지챗 조회형·접수형 판정 기록. 고객 원문·예약번호·값 미저장 — chat_messages.id와 분류 코드만. outcome: answered/not_found/no_data/error(조회) · registered(접수)/duplicate(이미 접수됨)/need_code(예약 특정 불가). feedback: 1=정답 0=오답(후속 단계)';

-- rollback:
--   DROP TABLE public.chat_agent_requests;
--   ALTER TABLE public.crazychat_query_observations DROP CONSTRAINT crazychat_query_observations_intent_check,
--     ADD CONSTRAINT crazychat_query_observations_intent_check CHECK (intent IN ('reservation_status','return_date','doc_status','payment_status'));
--   ALTER TABLE public.crazychat_query_observations DROP CONSTRAINT crazychat_query_observations_outcome_check,
--     ADD CONSTRAINT crazychat_query_observations_outcome_check CHECK (outcome IN ('answered','not_found','no_data','error'));
