-- Migration #716: 본인증명 미등록·미승인 고객의 예약 신청 허용 (2026-10-15, Stephen 확정)
--
-- 정책 변경: 본인증명·외국인증명 등록/승인은 더 이상 예약 "신청" 단계를 막지 않는다.
--   고객은 서류 없이도 장바구니 담기(draft)·예약신청(hold)·draft→hold 승격이 가능하다.
--   서류 확인은 (1) 채팅카드+SMS+푸시 등록 요청(서버 /api/profile/doc-request)과
--   (2) 관리자 예약 승인 단계(CMS 예약목록 승인 게이트 — 별도 세션에서 진행)에서 이뤄진다.
--
-- 배경: Migration #629(→#630·#632로 갱신)가 rental_reservations 트리거로 서류 승인 전 예약 생성·승격을 서버에서 막았다.
--   이 함수가 DOC_NOT_APPROVED 예외를 던지던 유일한 집행 지점이다.
--
-- 변경 방식: 트리거(trg_require_approved_identity_doc_ins/_upd)와 함수 이름은 그대로 두고 본문만 통과형으로 바꾼다.
--   — 정책을 되돌릴 때 트리거를 다시 만들 필요 없이 함수 본문만 #632로 복원하면 된다.
-- 롤백: supabase/migrations/20261002150000_632_foreign_doc_required_four_types.sql 의
--       CREATE OR REPLACE FUNCTION public.trg_require_approved_identity_doc() 본문을 그대로 재실행.
--
-- 무변경: 트리거 정의, 함수 시그니처·권한(REVOKE FROM PUBLIC/anon/authenticated — 트리거 실행에는 EXECUTE 권한이 필요 없다).
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh).

CREATE OR REPLACE FUNCTION public.trg_require_approved_identity_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 2026-10-15 정책 변경: 서류 등록·승인 여부와 무관하게 예약 신청을 허용한다(위 헤더 참고).
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_require_approved_identity_doc() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_require_approved_identity_doc() FROM anon, authenticated;
