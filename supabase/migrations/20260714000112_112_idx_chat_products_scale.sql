-- Migration 112: chat_messages·products 규모 대응 인덱스
-- 근거: 200K+ messages/월 세션 조회 + 10K 상품 목록 정렬 최적화.

-- 1. chat_messages: session_id + created_at 복합 (세션별 시간순 메시지 조회)
--    현재 단일 session_id 인덱스 → 복합으로 교체 (sort를 인덱스에서 처리)
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages(session_id, created_at);
DROP INDEX IF EXISTS idx_chat_messages_session_id;

-- 2. chat_sessions: admin_id 인덱스 (RLS policy EXISTS 서브쿼리 최적화)
--    chat_messages RLS: EXISTS (SELECT 1 FROM chat_sessions WHERE admin_id = auth.uid())
--    현재 admin_id에 인덱스 없음 → 메시지 INSERT마다 chat_sessions full scan
CREATE INDEX IF NOT EXISTS idx_chat_sessions_admin_id
  ON chat_sessions(admin_id)
  WHERE admin_id IS NOT NULL;

-- 3. products 목록 쿼리 복합 인덱스 (10,000개 이상 상품에서 CMS 목록 정렬 최적화)
--    load()의 핵심 쿼리: WHERE deleted_at IS NULL AND parent_product_id IS NULL
--    ORDER BY created_at DESC (페이지네이션)
CREATE INDEX IF NOT EXISTS idx_products_list_created
  ON products(created_at DESC)
  WHERE deleted_at IS NULL AND parent_product_id IS NULL;

-- 4. products 카테고리 + created_at 복합 (카테고리 필터 + 정렬 동시)
CREATE INDEX IF NOT EXISTS idx_products_category_created
  ON products(category, created_at DESC)
  WHERE deleted_at IS NULL AND parent_product_id IS NULL;
