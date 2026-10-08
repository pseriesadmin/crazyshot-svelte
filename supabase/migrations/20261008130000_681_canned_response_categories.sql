-- Migration #681: 빠른답변 분류 설정 — 분류 목록을 DB로 옮겨 관리자가 추가·수정할 수 있게 한다
-- 2026-10-08 | Stephen 지시("빠른 답변 분류를 더 넓힐 수 있게 설정 기능 추가")
-- TDD: src/__tests__/utils/cannedCategories.test.ts · src/__tests__/server/cannedCategoriesServer.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- ① canned_response_categories: 기본(시스템) 6개 + 관리자가 추가한 분류. human_only = 민감 분류(자동답변이 나가면 상담원 알림).
-- ② canned_responses.category CHECK(고정 6개)를 FK로 교체 — 기존 값은 모두 시드 6개 안에 있다. 분류 키는 변경·삭제 시 RESTRICT/CASCADE로 보호.
-- 서버 전용 테이블: RLS 활성화 + 정책 없음, service_role만 접근(화면은 서버 API/로더를 통해서만 읽는다).
-- ROLLBACK: ALTER TABLE canned_responses DROP CONSTRAINT canned_responses_category_fk;
--           (추가 분류를 쓰는 행이 있으면 먼저 general로 되돌린 뒤) ADD CONSTRAINT canned_responses_category_check CHECK (category IN ('return','payment','reservation','damage','general','cs'));
--           DROP TABLE canned_response_categories;

CREATE TABLE IF NOT EXISTS public.canned_response_categories (
  value       VARCHAR(30) PRIMARY KEY,
  label       VARCHAR(30) NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 10),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  human_only  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.canned_response_categories (value, label, sort_order, is_system, is_active, human_only) VALUES
  ('return',      '반납', 1, true, true, false),
  ('payment',     '결제', 2, true, true, false),
  ('reservation', '예약', 3, true, true, false),
  ('damage',      '파손', 4, true, true, true),
  ('general',     '기타', 5, true, true, false),
  ('cs',          'CS',   6, true, true, true)
ON CONFLICT (value) DO NOTHING;

-- 같은 이름(공백·대소문자 무시) 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS canned_response_categories_label_uniq
  ON public.canned_response_categories (lower(regexp_replace(label, '\s+', '', 'g')));

ALTER TABLE public.canned_response_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canned_response_categories FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.canned_response_categories TO service_role;

ALTER TABLE public.canned_responses DROP CONSTRAINT IF EXISTS canned_responses_category_check;
ALTER TABLE public.canned_responses
  ADD CONSTRAINT canned_responses_category_fk
  FOREIGN KEY (category) REFERENCES public.canned_response_categories (value) ON UPDATE CASCADE ON DELETE RESTRICT;

COMMENT ON TABLE public.canned_response_categories IS '빠른답변 분류(기본 6 + 관리자 추가). 서버 전용.';
