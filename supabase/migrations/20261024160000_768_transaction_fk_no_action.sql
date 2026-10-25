-- Migration #768(구 #765, 번호 충돌로 재번호): 거래 기록 보호 — 예약·주문·구독의 계정 연결을 "계정 삭제 시 같이 삭제(CASCADE)"에서 "삭제 거절(NO ACTION)"로 정렬 (2026-10-24)
--
-- 배경: 2026-10-24 점검에서 Production만 rental_reservations·orders·user_subscriptions → user_profiles 외래키가 ON DELETE CASCADE였다
--       (Stage는 이미 NO ACTION). 계정(auth.users)을 물리 삭제하면 프로필이 지워지며 결제 거래가 없는 예약·주문까지 함께 사라질 수 있었다.
--       법정 보존(5년) 대상 거래 기록은 계정 삭제로 지워지지 않아야 하므로 Stage와 같은 NO ACTION으로 맞춘다. 이미 NO ACTION이면 아무 일도 하지 않는다.
-- 영향: 거래 기록이 있는 계정의 물리 삭제는 거절된다(삭제는 익명 전환 경로로만). 테스트·정리 스크립트는 예약 행을 먼저 지워야 한다.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.user_profiles'::regclass
       AND c.confdeltype = 'c'
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'user_id')]::smallint[]  -- 계정 연결(user_id) 외래키만
       AND c.conrelid::regclass::text IN ('rental_reservations', 'orders', 'user_subscriptions')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE NO ACTION', r.tbl, r.conname);
  END LOOP;
END $$;

-- ── 롤백 ── 같은 방식으로 ON DELETE CASCADE로 다시 만들면 된다(권장하지 않음).
