-- Migration 44: admin_invite_tokens.used_by FK → ON DELETE SET NULL
-- 초대링크로 가입한 계정 삭제 시 NO ACTION 제약으로 deleteUser 실패 → SET NULL로 변경

ALTER TABLE public.admin_invite_tokens
  DROP CONSTRAINT admin_invite_tokens_used_by_fkey,
  ADD CONSTRAINT admin_invite_tokens_used_by_fkey
    FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;
