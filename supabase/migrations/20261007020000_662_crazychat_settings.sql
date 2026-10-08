-- Migration 662: 크레이지챗(채팅 에이전트) 기능 플래그·킬스위치 설정 테이블 (2026-10-07, Stephen 승인 — GATE B)
--
-- 배경: 채팅 자동답변을 '크레이지챗' 에이전트로 확장한다(조회·접수·AI 답변). 새 능력은 전부 이 설정으로 켜고 끈다.
--   · 기본값은 전부 OFF(마스터 agent_enabled=false) — 배포해도 현재 동작(빠른답변 + 대기 안내)은 바뀌지 않는다.
--   · 마스터가 꺼져 있으면 개별 기능이 켜져 있어도 정지(킬스위치) — 해석은 src/lib/server/crazychat/settings.ts.
--   · 기능별 observe=true면 판정만 기록하고 고객에게는 발송하지 않는다(기존 자동답변 observe_mode와 같은 개념).
--
-- 왜 auto_reply_settings에 컬럼을 추가하지 않고 별도 테이블인가:
--   auto_reply_settings는 RLS 정책이 "SELECT USING (true)"(누구나 읽기) + "is_cms_user() 전체 조작"(파트너 포함)이다.
--   에이전트 스위치는 파트너가 직접 바꾸거나 비로그인이 읽을 수 없어야 하므로, 서버 전용(RLS 정책 없음·service_role만)
--   싱글톤 테이블로 분리한다(Migration 607·608·656 패턴). 변경은 매니저 이상 전용 API(후속 단계)로만 한다.
--
-- ai_allowed_categories: AI가 답해도 되는 주제 목록. 빈 배열 = 어떤 주제도 허용 안 함(기본 거부).
--   CHECK로 사람 전용 주제(파손·분실·환불·취소·법적 분쟁·결제 오류·개인정보)를 DB에서도 거부한다(코드와 이중 방어).
--
-- 롤백: DROP TABLE public.crazychat_settings;  (이 테이블을 읽는 코드는 테이블이 없어도 전부 꺼짐으로 처리)

CREATE TABLE IF NOT EXISTS public.crazychat_settings (
  -- 싱글톤: id가 항상 true인 행 1개만 존재할 수 있다
  id                      boolean     PRIMARY KEY DEFAULT true CHECK (id),
  agent_enabled           boolean     NOT NULL DEFAULT false,
  query_enabled           boolean     NOT NULL DEFAULT false,
  query_observe           boolean     NOT NULL DEFAULT false,
  action_enabled          boolean     NOT NULL DEFAULT false,
  action_observe          boolean     NOT NULL DEFAULT false,
  ai_fallback_enabled     boolean     NOT NULL DEFAULT false,
  ai_fallback_observe     boolean     NOT NULL DEFAULT false,
  ai_allowed_categories   text[]      NOT NULL DEFAULT '{}'::text[],
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid,
  CONSTRAINT crazychat_ai_categories_not_human_only CHECK (
    NOT (ai_allowed_categories && ARRAY['damage','cs','lost','refund','cancel','legal','payment_error','personal_info']::text[])
  )
);

COMMENT ON TABLE public.crazychat_settings IS
  '크레이지챗 기능 플래그·킬스위치(싱글톤, 서버 전용). 기본 전부 OFF. 마스터 agent_enabled=false면 개별 기능 전부 정지';
COMMENT ON COLUMN public.crazychat_settings.ai_allowed_categories IS
  'AI 답변 허용 주제 목록(빈 배열=전부 거부). 사람 전용 주제는 CHECK로 저장 불가';

INSERT INTO public.crazychat_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 서비스 서버 전용: RLS 켜고 정책 없음 + 일반 역할 권한 제거
ALTER TABLE public.crazychat_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crazychat_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.crazychat_settings FROM anon, authenticated;
GRANT ALL ON TABLE public.crazychat_settings TO service_role;
