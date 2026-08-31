-- Migration 401 — payment_transactions 환불 실패 추적 컬럼 추가 (2026-08-31)
-- 목적: Toss 결제취소 성공 후 cancel_reservation_payment RPC가 실패한 경우 실패 사실을
--       payment_transactions에 기록해 CMS 관리자가 놓치지 않도록 배지로 노출 가능하게 함.
-- RSV-B-C1: GATE B Q1 확정 설계의 ② 단계 DB 저장 요건
--
-- 주의: 기존 Migration 384의 cancel_reason/cancelled_by와 목적이 완전히 다름 —
--       cancel_reason = 취소 사유(정상 취소), refund_failure_reason = RPC 실패 사유(비정상).

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS refund_failed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_failure_reason TEXT;

-- 이미 적용된 경우 멱등 처리 — 컬럼이 이미 있으면 ADD COLUMN IF NOT EXISTS이 무시됨.
