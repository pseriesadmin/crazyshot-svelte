-- Migration 667: 크레이지챗 AI 답변 폴백(S4) — 관찰 기록 + 정책 요약 문서 (2026-10-07, Stephen 승인 — GATE B)
--
-- AI 폴백은 "검수 완료 빠른답변 + 검수 완료 정책 요약 문서"만 근거로 답변 초안을 만든다.
--   · ai_reply_observations: AI를 호출할 때마다 1행(관찰 모드에서는 고객에게 보내지 않고 이 기록만 남긴다).
--     호출 상한(분당 10·일 200)과 연속 실패 자동 정지는 이 테이블의 최근 기록을 세어 판단한다.
--     호출 전에 'pending' 행을 먼저 만들어 자리를 선점하고(동시 요청·기록 실패에도 상한이 유지되도록), 끝나면 결과로 갱신한다.
--     고객 질문 원문은 저장하지 않는다. AI 초안(draft_text)은 검증을 통과한(answered) 건에만 관리자 검토용으로 600자까지 저장한다.
--   · crazychat_policy_snippets: 관리자가 검수한 정책 요약 조각. reviewed=true인 것만 AI 근거로 쓴다(기본 false).
-- 두 테이블 모두 서버 전용(RLS 켜고 정책 없음 + service_role만). 롤백: DROP TABLE 두 개.

CREATE TABLE IF NOT EXISTS public.ai_reply_observations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  message_id    uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  session_id    uuid        NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  mode          text        NOT NULL CHECK (mode IN ('observe', 'on')),
  outcome       text        NOT NULL CHECK (outcome IN ('pending', 'answered', 'declined', 'invalid', 'error')),
  reason        text,
  category      text,
  source_count  integer     NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  confidence    numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  draft_text    text        CHECK (draft_text IS NULL OR char_length(draft_text) <= 600),
  sent          boolean     NOT NULL DEFAULT false,
  feedback      smallint    CHECK (feedback IN (0, 1)),
  feedback_by   uuid,
  feedback_at   timestamptz
);

COMMENT ON TABLE public.ai_reply_observations IS
  '크레이지챗 AI 폴백 호출 기록(서버 전용). 고객 원문 미저장 — chat_messages.id 참조. outcome: pending(호출 중 — 상한 계수용 자리 선점)/answered(검증 통과 초안)/declined(근거 없음 판단)/invalid(형식·근거·금칙어 검증 실패)/error(호출 실패·시간 초과). sent=true는 고객에게 실제 발송된 것. 호출 상한·연속 실패 정지의 계수 대상';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reply_observations_message ON public.ai_reply_observations (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_reply_observations_created ON public.ai_reply_observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reply_observations_session_created ON public.ai_reply_observations (session_id, created_at DESC);

ALTER TABLE public.ai_reply_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_reply_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_reply_observations FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_reply_observations TO service_role;

CREATE TABLE IF NOT EXISTS public.crazychat_policy_snippets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  content      text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 800),
  category     text        NOT NULL CHECK (char_length(category) BETWEEN 1 AND 40),
  reviewed     boolean     NOT NULL DEFAULT false,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  CONSTRAINT crazychat_policy_snippets_review_consistency CHECK (NOT reviewed OR reviewed_at IS NOT NULL)
);

COMMENT ON TABLE public.crazychat_policy_snippets IS
  '크레이지챗 AI 근거용 정책 요약 조각(서버 전용). reviewed=true(관리자 검수 완료)인 것만 AI가 근거로 쓴다. 기본 false';

ALTER TABLE public.crazychat_policy_snippets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crazychat_policy_snippets FROM PUBLIC;
REVOKE ALL ON TABLE public.crazychat_policy_snippets FROM anon, authenticated;
GRANT ALL ON TABLE public.crazychat_policy_snippets TO service_role;

-- rollback:
--   DROP TABLE public.ai_reply_observations;
--   DROP TABLE public.crazychat_policy_snippets;
