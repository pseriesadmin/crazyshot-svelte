-- Migration #493: payment_transactions — pg_cancelled_at 컬럼 추가
-- 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §3
--
-- 목적: 토스페이먼츠 결제취소 응답의 cancels[0].canceledAt 값(PG가 보고하는 취소 시각)을
--   payment_transactions에 별도 컬럼으로 저장한다.
--   기존 cancelled_at(관리자가 DB에서 RPC 실행한 시각)과 분리해 PG 실시간 취소 타임스탬프를
--   기록하는 것이 목적이다.
--
-- 사용처:
--   - RentalDetailPanel "결제정보" 탭 → "취소 환불시간" 행 표시
--   - changeReservation 서버 액션: Toss API 취소 응답에서 cancels[0].canceledAt을 이 컬럼에 기록
--   - updateStatus(예약취소) 서버 액션: 동일하게 Toss 응답 canceledAt 기록
--
-- 기존 cancelled_at(TIMESTAMPTZ): 관리자가 cancel_reservation_payment RPC를 실행한 서버 시각
-- 신규 pg_cancelled_at(TIMESTAMPTZ): PG(토스페이먼츠)가 보고하는 실제 환불 처리 시각
--   → 실제 환불 완료 시각이므로 고객에게 표시할 "환불 처리 시간"의 정본
--   → NULL: Toss API를 통하지 않은 취소(직접 DB 처리), 또는 Toss 응답에 cancels 배열이 없는 경우

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS pg_cancelled_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.payment_transactions.pg_cancelled_at IS
  'Migration #493 — 토스페이먼츠 취소 응답 cancels[0].canceledAt 값.
   PG가 보고하는 환불 처리 완료 시각. NULL = Toss API 취소 없이 DB 직접 처리.
   cancelled_at(관리자 RPC 실행 시각)과 다른 개념 — 고객 표시용 "환불 처리 시간"은 이 컬럼이 정본.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE public.payment_transactions DROP COLUMN IF EXISTS pg_cancelled_at;
-- ============================================================
