-- 쿠폰 발행관리 개선 항목 1: 고객 노출용 "쿠폰 이름" 필드 신설
-- 기존 description 컬럼은 라벨만 "내부 메모용 설명"이라 되어있었을 뿐, 실제로는 고객 화면
-- (내정보·장바구니 쿠폰 카드)에 이름으로 그대로 노출되고 있었다. display_name을 신설해
-- 고객 노출 용도를 명확히 분리하고, description은 순수 관리자 메모로 재분배한다.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS display_name TEXT;
