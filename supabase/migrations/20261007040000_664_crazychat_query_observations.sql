-- Migration 664: 크레이지챗 조회형(S2) 관찰 기록 테이블 (2026-10-07, Stephen 승인 — GATE B)
--
-- 조회형이 "관찰(observe)" 모드일 때 고객에게는 보내지 않고 판정만 기록하고, "켜짐(on)" 모드에서도 같은 기록을 남겨
-- 운영 중 답변률·실패 사유를 확인한다. 고객 질문 원문·예약번호·조회한 값은 저장하지 않는다(메시지 id + 분류 코드만).
--   outcome: answered(답변 가능) / not_found(고객이 말한 예약번호가 본인 목록에 없음) / no_data(조회할 예약·서류 없음) / error(읽기 오류)
-- 롤백: DROP TABLE public.crazychat_query_observations;  (이 테이블이 없어도 조회형 코드는 기록 실패를 무시하고 계속 동작)

CREATE TABLE IF NOT EXISTS public.crazychat_query_observations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  message_id   uuid        NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  mode         text        NOT NULL CHECK (mode IN ('observe', 'on')),
  intent       text        NOT NULL CHECK (intent IN ('reservation_status', 'return_date', 'doc_status', 'payment_status')),
  outcome      text        NOT NULL CHECK (outcome IN ('answered', 'not_found', 'no_data', 'error')),
  group_count  integer     NOT NULL DEFAULT 0 CHECK (group_count >= 0),
  feedback     smallint    CHECK (feedback IN (0, 1)),
  feedback_by  uuid,
  feedback_at  timestamptz
);

COMMENT ON TABLE public.crazychat_query_observations IS
  '크레이지챗 조회형 판정 기록. 고객 원문·예약번호·값 미저장 — chat_messages.id와 분류 코드만. feedback: 1=정답 0=오답(관리자 검토, 후속 단계)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_crazychat_query_observations_message
  ON public.crazychat_query_observations (message_id);
CREATE INDEX IF NOT EXISTS idx_crazychat_query_observations_created
  ON public.crazychat_query_observations (created_at DESC);

-- 서버 전용: RLS 켜고 정책 없음 + 일반 역할 권한 제거 (migration 607·608·656·662 패턴)
ALTER TABLE public.crazychat_query_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crazychat_query_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.crazychat_query_observations FROM anon, authenticated;
GRANT ALL ON TABLE public.crazychat_query_observations TO service_role;
