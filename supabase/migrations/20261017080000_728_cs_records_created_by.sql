-- 728: 상담 메모(cs_records) 등록 관리자 기록
-- 상담 메모가 "단문 메모 목록"이 되면서(2026-10-17) 각 메모를 누가 남겼는지 보여주기 위해 등록 관리자(auth.users.id)를 저장한다.
-- NULL 허용: 기존 메모와 상담 종료 시 자동 저장되는 요약(/api/chat/close)은 등록 관리자 정보가 없다 — 화면은 아이디를 비워 둔다.
-- 관리자 아이디(이메일 앞부분)는 서버가 목록 조회 때 user_profiles에서 붙인다(이 칼럼엔 uuid만 저장).
ALTER TABLE public.cs_records
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cs_records.created_by IS
  '메모를 등록한 관리자(auth.users.id). NULL = 기존 메모·자동 요약 등 등록자 미기록.';

-- ROLLBACK: ALTER TABLE public.cs_records DROP COLUMN IF EXISTS created_by;
