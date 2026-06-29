-- admin_invite_tokens.created_by FK: NO ACTION → ON DELETE SET NULL
-- 원인: auth.users 삭제 시 admin_invite_tokens_created_by_fkey FK 위반으로 계정 삭제 불가
-- 해결: 유저 삭제 시 created_by를 NULL로 자동 설정
ALTER TABLE public.admin_invite_tokens
  DROP CONSTRAINT admin_invite_tokens_created_by_fkey,
  ADD CONSTRAINT admin_invite_tokens_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
