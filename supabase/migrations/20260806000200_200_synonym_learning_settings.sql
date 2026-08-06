-- Migration 200: synonym_learning_settings
-- §E SYN-13: 동의어 학습 파라미터 런타임 튜닝 테이블 (싱글턴 1행)
-- 관리자가 코드 배포 없이 Supabase 대시보드에서 직접 값을 조정할 수 있습니다.
-- 2026-08-06

-- ── 테이블 생성 ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.synonym_learning_settings (
  -- 싱글턴 보장: id = 1 고정 (CHECK 제약으로 다른 값 삽입 불가)
  id                              INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- §E SYN-4/SYN-13: candidate → confirmed 자동 승격 임계값
  -- DB RPC upsert_synonym_member의 p_threshold로 전달됩니다.
  -- 하드코딩 fallback: 3
  promote_threshold               INTEGER     NOT NULL DEFAULT 3
                                              CHECK (promote_threshold >= 1),

  -- §E SYN-12/SYN-13: 길이비례 허용 편집거리 공식의 계수
  -- maxAllowedDistance = floor((min_length - 1) / divisor)
  -- 높을수록 엄격(작은 편집거리 허용), 낮을수록 관대(큰 편집거리 허용)
  -- 하드코딩 fallback: 3
  similarity_edit_distance_divisor INTEGER    NOT NULL DEFAULT 3
                                              CHECK (similarity_edit_distance_divisor >= 1),

  -- §E SYN-11/SYN-13: usage_count 구간별 occurrence 증가폭 정의
  -- 형식: [{"min_usage": N, "increment": M}, ...] (내림차순 정렬 권장)
  -- increment 의미: 한 번 학습 이벤트당 occurrence_count 증가량
  -- 하드코딩 fallback: 3단계 구간 (0→+1 / 10→+2 / 20→+3)
  usage_weight_tiers              JSONB       NOT NULL DEFAULT '[
    {"min_usage": 20, "increment": 3},
    {"min_usage": 10, "increment": 2},
    {"min_usage": 0,  "increment": 1}
  ]'::jsonb,

  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 싱글턴 초기 행 삽입 ─────────────────────────────────────────────────────────

INSERT INTO public.synonym_learning_settings DEFAULT VALUES
ON CONFLICT (id) DO NOTHING;

-- ── RLS: service_role만 접근 가능 ───────────────────────────────────────────────

-- RLS 활성화 — 정책을 별도로 추가하지 않으면 anon/authenticated는 자동 차단됩니다.
-- service_role은 Supabase 설계상 RLS를 우회하므로 별도 정책 불필요.
ALTER TABLE public.synonym_learning_settings ENABLE ROW LEVEL SECURITY;

-- ── 코멘트 ───────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.synonym_learning_settings IS
  '§E SYN-13: 동의어 학습 파라미터 런타임 튜닝 (싱글턴). Supabase 대시보드에서 직접 수정, 코드 배포 불필요. synonymLearning.ts가 60초 TTL 캐시로 읽습니다.';

COMMENT ON COLUMN public.synonym_learning_settings.promote_threshold IS
  '§E SYN-4: candidate → confirmed 자동 승격 임계값. 기본값 3 (3회 관찰 시 승격). RPC upsert_synonym_member p_threshold로 전달됨.';

COMMENT ON COLUMN public.synonym_learning_settings.similarity_edit_distance_divisor IS
  '§E SYN-12: 길이비례 허용 편집거리 공식 계수. maxAllowed = floor((min_length-1) / divisor). 기본값 3 → 4~6자 편집거리1, 7~9자 편집거리2 허용.';

COMMENT ON COLUMN public.synonym_learning_settings.usage_weight_tiers IS
  '§E SYN-11: usage_count 구간별 occurrence 증가폭. [{min_usage: N, increment: M}] 형식, 내림차순 정렬 권장. 기본 3단계.';
