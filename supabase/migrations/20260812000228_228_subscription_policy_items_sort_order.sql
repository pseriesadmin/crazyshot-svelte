-- Migration #228: subscription_policy_items — 순서 변경(드래그 리오더) 지원
--
-- 배경: 마이그레이션 227에서 신설한 정책항목 리스트에 순서 변경 아이콘 버튼(CmsDragList 재사용)
--       요청 — 정렬을 위한 sort_order 컬럼 추가. 기존 행이 있으면 created_at 순으로 백필.

ALTER TABLE subscription_policy_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 기존 행 백필(생성 시점 순서를 유지) — 신규 테이블이라 통상 0건이지만 안전하게 처리
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) - 1 AS rn
  FROM subscription_policy_items
)
UPDATE subscription_policy_items p
SET sort_order = ordered.rn
FROM ordered
WHERE p.id = ordered.id;
