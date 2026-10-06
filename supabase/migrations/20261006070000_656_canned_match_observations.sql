-- Migration 656: 자동답변 관찰 모드 — 설정 컬럼 + 판정 기록 테이블 (2026-10-06, Stephen 승인)
--
-- 배경: 자동답변(/cms/chat/qna)이 질문 맥락과 무관한 답변을 보내 CS가 늘던 문제로 규칙 판정을 교체하고
--   "이 답변이 맞을 확률" 모델을 얹었다(matchCannedResponse.ts + cannedMatchModel.ts). 실제 고객 트래픽에서
--   오답률을 확인한 뒤 켜기 위해 "관찰 모드"를 둔다: 고객에게는 보내지 않고 판정만 기록한다.
--
-- 1) auto_reply_settings.observe_mode — enabled=false여도 true면 판정을 평가·기록만 하고 발송하지 않는다.
--    enabled=true면 평가·기록(mode='on') 후 모델이 "답변"으로 판정한 것만 실제 발송한다.
-- 2) canned_match_observations — 메시지 1건당 판정 1행. 고객 질문 원문은 저장하지 않는다(message_id로만 참조).
--    features/feedback 컬럼은 이후 단계(관리자 정답/오답 피드백 → 모델 온라인 학습)가 쓴다.
-- 롤백: DROP TABLE public.canned_match_observations; ALTER TABLE public.auto_reply_settings DROP COLUMN observe_mode;

ALTER TABLE public.auto_reply_settings
  ADD COLUMN IF NOT EXISTS observe_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.auto_reply_settings.observe_mode IS
  '관찰 모드: enabled=false여도 true면 자동답변 판정을 평가·기록만 하고 고객에게는 발송하지 않는다';

CREATE TABLE IF NOT EXISTS public.canned_match_observations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  message_id      uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  mode            text        NOT NULL CHECK (mode IN ('observe', 'on')),
  rule_decision   text        NOT NULL CHECK (rule_decision IN ('answer', 'ambiguous', 'no_match')),
  rule_reason     text        NOT NULL,
  model_decision  text        NOT NULL CHECK (model_decision IN ('answer', 'wait')),
  probability     numeric(5,4),
  threshold       numeric(5,4),
  model_version   integer     NOT NULL,
  best_canned_id  uuid        REFERENCES public.canned_responses(id) ON DELETE SET NULL,
  would_send      boolean     NOT NULL,
  top             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  features        jsonb,
  feedback        smallint    CHECK (feedback IN (0, 1)),
  feedback_by     uuid,
  feedback_at     timestamptz
);

COMMENT ON TABLE public.canned_match_observations IS
  '자동답변 판정 기록(관찰 모드·운영 모니터링). 고객 질문 원문 미저장 — chat_messages.id로만 참조. feedback: 1=정답 0=오답(관리자 검토, 이후 단계)';

-- 메시지당 1행(중복 기록 방지) + 최근순 조회
CREATE UNIQUE INDEX IF NOT EXISTS uq_canned_match_observations_message
  ON public.canned_match_observations (message_id);
CREATE INDEX IF NOT EXISTS idx_canned_match_observations_created
  ON public.canned_match_observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canned_match_observations_best
  ON public.canned_match_observations (best_canned_id) WHERE best_canned_id IS NOT NULL;

-- 서비스 서버 전용: RLS 켜고 정책 없음 + 일반 역할 권한 제거 (migration 607·608 패턴)
ALTER TABLE public.canned_match_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canned_match_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.canned_match_observations FROM anon, authenticated;
GRANT ALL ON TABLE public.canned_match_observations TO service_role;
