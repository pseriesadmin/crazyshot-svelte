-- Migration #720: 예약별 계약 특약 사전 등록 (2026-10-15, Stephen 확정)
-- 계약서 발행 전에 그 예약 건만의 특약(항목명·내용 쌍)을 미리 등록해 두면, 전자계약 발행(자동·수동) 때
-- 양식의 '특약사항'(양식 자체 특약 뒤)에 이어 붙는다. 형식은 contracts.specifications 와 같은 [{key,value}] 배열.
-- 서버(service_role) API 로만 읽고 쓴다 — 고객 RLS 정책은 건드리지 않는다. 기존 행은 NULL(= 특약 없음).
-- 롤백: ALTER TABLE rental_reservations DROP COLUMN contract_specifications;
ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS contract_specifications jsonb;
COMMENT ON COLUMN public.rental_reservations.contract_specifications IS
  '계약 발행 전 사전 등록 특약 [{key,value}] — 발행 시 양식 특약 뒤에 이어 붙음(service-operations.md §31)';
