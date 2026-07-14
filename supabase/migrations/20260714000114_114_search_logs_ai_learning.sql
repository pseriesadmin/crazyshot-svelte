-- Migration 114: 검색 로그 + AI 학습 누적 테이블
-- 목적: 검색 행동 데이터 누적 → AI 동적 학습 → 검색 랭킹 개인화
-- AI 학습 루프: 검색어 → 클릭 → 전환 → 상품별 score 갱신 → 랭킹 부스트

-- 1. search_logs: 모든 검색 이벤트 원본 기록
CREATE TABLE IF NOT EXISTS search_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null = anonymous
  session_id      TEXT,                     -- 비로그인 세션 추적
  query           TEXT NOT NULL,            -- 검색어 원본
  query_tokens    tsvector,                 -- 파싱된 토큰 (AI 학습용)
  category_filter TEXT,                     -- 카테고리 필터 (있을 경우)
  result_count    INT  DEFAULT 0,           -- 반환된 결과 수
  clicked_ids     UUID[],                   -- 클릭한 product_id 배열
  converted_id    UUID,                     -- 최종 예약/결제한 product_id
  search_rank_snapshot JSONB,               -- 검색 시점 랭킹 스냅샷 (A/B 학습용)
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_user_id
  ON search_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at
  ON search_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_query_trgm
  ON search_logs USING GIN(query gin_trgm_ops);  -- 자동완성·유사 검색어 지원
CREATE INDEX IF NOT EXISTS idx_search_logs_clicked_ids
  ON search_logs USING GIN(clicked_ids);         -- "이 상품을 클릭한 사람의 다른 검색어"

-- 2. product_search_stats: 상품별 검색 성과 집계 (AI 학습 기반 랭킹 소스)
CREATE TABLE IF NOT EXISTS product_search_stats (
  product_id        UUID REFERENCES products(id) ON DELETE CASCADE,
  search_term       TEXT NOT NULL,
  impression_count  BIGINT DEFAULT 0,  -- 검색 결과 노출 수
  click_count       BIGINT DEFAULT 0,  -- 클릭 수
  conversion_count  BIGINT DEFAULT 0,  -- 예약/결제 전환 수
  ctr               FLOAT GENERATED ALWAYS AS
                      (CASE WHEN impression_count > 0 THEN click_count::FLOAT / impression_count ELSE 0 END)
                    STORED,            -- Click-Through Rate (자동 계산)
  last_updated      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (product_id, search_term)
);

CREATE INDEX IF NOT EXISTS idx_pss_product_id
  ON product_search_stats(product_id);
CREATE INDEX IF NOT EXISTS idx_pss_term_ctr
  ON product_search_stats(search_term, ctr DESC);  -- 검색어별 상위 CTR 상품 조회

-- 3. RLS
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_search_stats ENABLE ROW LEVEL SECURITY;

-- search_logs: 본인 로그만 SELECT, INSERT/UPDATE는 SECURITY DEFINER RPC 내부 처리
CREATE POLICY search_logs_user_select ON search_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY search_logs_service_all ON search_logs
  FOR ALL USING (auth.role() = 'service_role');

-- product_search_stats: 읽기 공개 (검색 랭킹 계산용), 수정은 service_role
CREATE POLICY pss_read_all ON product_search_stats
  FOR SELECT USING (true);
CREATE POLICY pss_service_write ON product_search_stats
  FOR ALL USING (auth.role() = 'service_role');
